# figma2code-oss-mcp

英文文档: [README.md](README.md)

用于 Figma 还原代码场景的 MCP 服务，负责资源上传与代码地址改写。

- 支持上传图片/icon 到 OSS 或自定义 HTTP 上传接口
- 支持一键流程：提取资源 -> 上传 -> 改写代码
- 支持 SVG 可渲染探测与自动降级
- 可通过 STDIO 接入 Codex 等 MCP 客户端

## 功能概览

- `process_code_assets` 一次调用完成全流程
- 上传后返回 `mapping` 与 `rewrittenCode`
- 上传模式：
  - `oss`：直传阿里云 OSS
  - `http`：调用你的 multipart 上传接口
- SVG 稳定性策略：
  - 标准 MIME 归一化
  - HEAD/GET 可渲染探测
  - 降级模式：`none` / `inline` / `always-inline`

## 环境要求

- Node.js 20+
- npm 或 pnpm

## 安装

```bash
npm install
```

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

根据你的场景编辑 `.env`：

- `UPLOAD_PROVIDER=oss`：走 OSS
- `UPLOAD_PROVIDER=http`：走自定义上传接口

### HTTP 模式关键项

- `HTTP_UPLOAD_URL`：上传地址
- `HTTP_UPLOAD_RESPONSE_FILE_PATH_FIELD`：返回 JSON 中 CDN 地址字段路径，例如 `data.filePath`
- `HTTP_UPLOAD_FORM_JSON`：固定 multipart 字段

## 启动

开发模式：

```bash
npm run dev
```

构建运行：

```bash
npm run build
npm start
```

## 在 Codex 中接入 MCP

建议使用 STDIO：

- 启动命令：`node`
- 参数：`dist/server.js`
- 工作目录：项目根目录

示例配置：

```json
{
  "mcpServers": {
    "figma2oss": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/绝对路径/figma2code-oss-mcp"
    }
  }
}
```

## 与 skill 配合调用

这个服务就是为 `$figma2oss` 这类 Figma 资源发布 skill 设计的，推荐和 `$figma` 一起配合使用。

推荐调用链路：

1. 用 `$figma` 读取目标节点，拿到 Figma MCP 返回的资源 URL 或资源数据。
2. 用 `$figma2oss` 调这个 MCP 服务上传可发布资源。
3. 如果任务还包括代码落地，再把代码交给 `process_code_assets`，使用返回的 `rewrittenCode` 作为最终结果。

提示词示例：

- `Use $figma2oss to upload the icons from this selected Figma node and return the CDN mapping.`
- `Use $figma $figma2oss to inspect this frame, export the publishable assets, and return source-to-CDN URLs.`
- `Use $figma2oss with svgFallbackMode=always-inline so SVG stays inline and PNG goes to CDN.`

skill 侧推荐约定：

- 优先选择服务名包含 `figma2oss` 的 MCP 工具。
- 如果 Figma 返回的是 localhost 资源 URL，直接把这些 URL 传给 `upload_asset`、`batch_upload_assets` 或 `process_code_assets`。
- 如果希望 SVG 永远不上传，直接调用 `process_code_assets` 并传 `svgFallbackMode=always-inline`。

## MCP 服务建立规范

为了让 skill、MCP 配置和运行时行为保持一致，建议按下面的规范建立服务：

- 服务名要稳定，并且直接表达职责。
- 这个项目推荐统一使用 `figma2oss` 作为 MCP 服务名。
- 以下位置尽量保持同名：
  - MCP 客户端配置中的服务 id
  - skill 文档里的默认服务名
  - agent 默认 prompt
  - README / 故障排查文档

推荐组合：

- 服务名：`figma2oss`
- skill 名：`$figma2oss`
- prompt 描述：`prefer MCP tools whose service name contains figma2oss`

如果你后续改了 MCP 服务名，至少同步以下几处：

1. MCP 客户端配置。
2. skill 文档和 agent 默认 prompt。
3. 任何依赖旧工具前缀的自动化逻辑。
4. 如果已有多人或多 agent 在用旧名字，迁移期最好保留一个兼容别名。

## 工具说明

### `upload_asset`

上传单个资源。

入参：

- `sourceUrl` 或 `base64Data`（二选一）
- `fileName`（可选）
- `contentType`（可选）
- `folder`（可选）

### `batch_upload_assets`

批量上传资源。

入参：

- `assets`：资源数组

返回：

- `uploads`
- `failures`
- `mapping`（`source -> finalUrl`）

### `rewrite_code_asset_urls`

按映射关系替换代码中的资源地址。

入参：

- `code`
- `mapping`

返回：

- `rewrittenCode`

### `process_code_assets`

端到端一键工具。

入参：

- `code`（必填）
- `assets`（可选）
- `folder`（可选）
- `extractFromCode`（可选，默认 `true`）
- `retries`（可选，默认 `2`，最大 `5`）
- `svgFallbackMode`（可选，默认 `inline`）
  - `none`：SVG 探测失败也保持 CDN 地址
  - `inline`：仅在 SVG 不可渲染时降级为内联
  - `always-inline`：SVG 一律不上传，直接内联

返回：

- `uploads`
- `failures`
- `mapping`
- `rewrittenCode`

其中 `uploads` 单项包含：

- `source`
- `cdnUrl`
- `finalUrl`
- `renderMode`（`direct-url` / `inline-svg` / `inline-svg-no-upload`）
- `fallbackReason`（发生降级时出现）

## 与 Figma MCP 配合流程

1. 用 Figma MCP 获取页面代码。
2. 把代码交给 `process_code_assets`。
3. 使用返回的 `rewrittenCode` 作为最终代码输出。

## 常见问题

### 1. 初始化握手失败（initialize response）

MCP 配置里优先用 `node dist/server.js`，不要用 `pnpm dev`，避免 stdout 启动日志影响握手。

### 2. 提示 unknown MCP server

检查 MCP 名称是否与调用时完全一致，例如统一用 `figma2oss`。

如果 skill 或 prompt 里要求优先匹配服务名包含 `figma2oss` 的工具，但客户端配置里仍然注册成别的名字，就可能出现匹配不到或行为不一致。

### 3. SVG 外链能下载但浏览器显示破图

使用 `svgFallbackMode=inline` 或 `always-inline`，避免依赖 CDN 的非标准 SVG 响应头。

### 4. `.env` 未生效

本服务会按 server 文件位置加载 `.env`，但仍建议 MCP 工作目录指向项目根目录。

## 安全建议

- 不要提交 `.env`
- 不要在日志中打印密钥
- 上线前确认上传接口权限与限流策略
