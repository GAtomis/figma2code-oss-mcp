# figma2code-oss-mcp

MCP server for Figma-to-code workflows with asset upload and URL rewriting.

- Upload image/icon assets to OSS or custom HTTP upload API
- Return CDN URLs and rewrite generated frontend code in one call
- Support resilient SVG handling with probe + inline fallback
- Integrate with Codex/other MCP clients through STDIO

> Chinese docs: [简体中文.md](README.zh-CN.md)

## Features

- One-shot pipeline with `process_code_assets`
- Provider mode:
	- `oss`: direct upload to Aliyun OSS
	- `http`: custom multipart upload endpoint
- Deterministic object key based on content hash
- Retry support for fetch/upload
- SVG reliability hardening:
	- MIME normalization to `image/svg+xml; charset=utf-8`
	- renderability probe (HEAD + GET)
	- fallback modes: `none`, `inline`, `always-inline`

## Requirements

- Node.js 20+
- npm or pnpm

## Install

```bash
npm install
```

## Configure

Copy template and edit values:

```bash
cp .env.example .env
```

### Upload Provider

- `UPLOAD_PROVIDER=oss` for Aliyun OSS
- `UPLOAD_PROVIDER=http` for custom upload API

### Common Notes

- In `http` mode, `HTTP_UPLOAD_RESPONSE_FILE_PATH_FIELD` defines where CDN URL is read from the JSON response, e.g. `data.filePath`.
- Static multipart fields can be passed via `HTTP_UPLOAD_FORM_JSON`.

## Run

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## MCP Client Configuration (Codex Example)

Use STDIO mode:

- command: `node`
- args: `dist/server.js`
- cwd: project root

Example JSON:

```json
{
	"mcpServers": {
		"figma2oss": {
			"command": "node",
			"args": ["dist/server.js"],
			"cwd": "/absolute/path/to/figma2code-oss-mcp"
		}
	}
}
```

## Skill Integration

This server is designed to work well with a Figma asset-export skill such as `$figma2oss`.

Recommended composition:

1. Use `$figma` to inspect the target node and collect asset URLs from the Figma MCP response.
2. Use `$figma2oss` to upload publishable assets through this MCP server.
3. If the task also includes code generation, pass the generated code to `process_code_assets` and use `rewrittenCode` as the final result.

Prompt examples:

- `Use $figma2oss to upload the icons from this selected Figma node and return the CDN mapping.`
- `Use $figma $figma2oss to inspect this frame, export the publishable assets, and return source-to-CDN URLs.`
- `Use $figma2oss with svgFallbackMode=always-inline so SVG stays inline and PNG goes to CDN.`

Recommended MCP usage pattern from a skill:

- Prefer tools exposed under an MCP service name containing `figma2oss`.
- If the Figma response returns localhost asset URLs, pass those URLs directly to `upload_asset`, `batch_upload_assets`, or `process_code_assets`.
- If SVG should never be uploaded, call `process_code_assets` with `svgFallbackMode=always-inline`.

## MCP Service Naming Convention

To keep skill prompts, MCP config, and runtime behavior aligned, follow these naming rules:

- Use a stable service id that matches the responsibility of the server.
- For this project, the recommended MCP service id is `figma2oss`.
- Keep the service id consistent across:
	- MCP client config
	- skill documentation
	- agent default prompts
	- troubleshooting docs

Recommended:

- service id: `figma2oss`
- skill name: `$figma2oss`
- prompt wording: `prefer MCP tools whose service name contains figma2oss`

If you rename the MCP service:

1. Update the MCP client config.
2. Update any skill docs or agent prompts that mention the old server id.
3. If your automation depends on exact tool prefixes, update those references too.
4. Prefer keeping a backward-compatible alias during migration if multiple users or agents already depend on the old name.

## Tools

### `upload_asset`

Upload one asset.

Input:

- `sourceUrl` or `base64Data` (one required)
- `fileName` (optional)
- `contentType` (optional)
- `folder` (optional)

### `batch_upload_assets`

Upload multiple assets and return mapping.

Input:

- `assets`: array of upload entries

Output includes:

- `uploads`
- `failures`
- `mapping` (`source -> finalUrl`)

### `rewrite_code_asset_urls`

Rewrite code by provided mapping.

Input:

- `code`
- `mapping`

Output:

- `rewrittenCode`

### `process_code_assets`

End-to-end pipeline: extract refs -> upload -> rewrite code.

Input:

- `code` (required)
- `assets` (optional)
- `folder` (optional)
- `extractFromCode` (optional, default `true`)
- `retries` (optional, default `2`, max `5`)
- `svgFallbackMode` (optional, default `inline`)
	- `none`: keep CDN URL even if SVG probe fails
	- `inline`: fallback to inline SVG only when probe fails
	- `always-inline`: never upload SVG; always inline

Output includes:

- `uploads`
- `failures`
- `mapping`
- `rewrittenCode`

Each `uploads` item includes:

- `source`
- `cdnUrl`
- `finalUrl`
- `renderMode` (`direct-url`, `inline-svg`, `inline-svg-no-upload`)
- `fallbackReason` (when fallback happened)

## Typical Figma Workflow

1. Use Figma MCP to generate initial frontend code.
2. Call `process_code_assets` with generated code.
3. Use returned `rewrittenCode` as final output.

## Troubleshooting

### 1) `initialize response` handshake failure

Use `node dist/server.js` in MCP config, not `pnpm dev`, to avoid startup banner noise on STDIO.

### 2) Unknown MCP server name

Ensure exact server id in client config and prompt, for example `figma2oss`.

If your skill or prompt prefers a service name containing `figma2oss`, but the client config still registers the server under another id, tool selection may fail or become inconsistent.

### 3) SVG appears broken in browser

Prefer `svgFallbackMode=inline` or `always-inline`. This avoids relying on non-standard CDN SVG response headers.

### 4) `.env` not loaded in MCP host

This server loads `.env` relative to server file location, but keep `cwd` at project root for best compatibility.

## Security Notes

- Do not commit secrets in `.env`
- Avoid logging AK/SK or upload endpoint credentials
- Validate your upload endpoint access policy before public deployment
