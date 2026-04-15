# figma2code-oss-mcp

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
    "asset-cdn": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/绝对路径/figma2code-oss-mcp"
    }
  }
}
```

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

检查 MCP 名称是否与调用时完全一致，例如统一用 `asset-cdn`。

### 3. SVG 外链能下载但浏览器显示破图

使用 `svgFallbackMode=inline` 或 `always-inline`，避免依赖 CDN 的非标准 SVG 响应头。

### 4. `.env` 未生效

本服务会按 server 文件位置加载 `.env`，但仍建议 MCP 工作目录指向项目根目录。

## 安全建议

- 不要提交 `.env`
- 不要在日志中打印密钥
- 上线前确认上传接口权限与限流策略
