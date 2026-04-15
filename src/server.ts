import { config as loadDotenv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import {
  extractAssetRefsFromCode,
  resolveAssetInput,
  rewriteAssetUrls,
  sourceKeyOfAsset,
  type AssetInput
} from "./assets.js";
import { mimeTypeFromFileName, normalizeMimeType } from "./mime.js";
import { AssetUploader, createUploader } from "./uploader.js";
import { withRetry } from "./retry.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(moduleDir, "..");
loadDotenv({ path: join(projectRoot, ".env") });

interface UploadAssetArgs extends AssetInput {}

interface BatchUploadAssetsArgs {
  assets: AssetInput[];
}

interface RewriteCodeAssetUrlsArgs {
  code: string;
  mapping: Record<string, string>;
}

interface ProcessCodeAssetsArgs {
  code: string;
  assets?: AssetInput[];
  folder?: string;
  extractFromCode?: boolean;
  retries?: number;
  svgFallbackMode?: "none" | "inline" | "always-inline";
}

type SvgFallbackMode = "none" | "inline" | "always-inline";

type UploadRenderMode = "direct-url" | "inline-svg" | "inline-svg-no-upload";

interface UploadOneAssetResult {
  source: string;
  cdnUrl: string;
  finalUrl: string;
  objectKey: string;
  cached?: boolean;
  size: number;
  mimeType?: string;
  renderMode: UploadRenderMode;
  fallbackReason?: string;
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

const TOOL_UPLOAD_ASSET = "upload_asset";
const TOOL_BATCH_UPLOAD_ASSETS = "batch_upload_assets";
const TOOL_REWRITE_CODE_ASSET_URLS = "rewrite_code_asset_urls";
const TOOL_PROCESS_CODE_ASSETS = "process_code_assets";

function isSvgAsset(contentType: string | undefined, fileName: string | undefined, source: string): boolean {
  if (normalizeMimeType(contentType) === "image/svg+xml") {
    return true;
  }

  if (mimeTypeFromFileName(fileName) === "image/svg+xml") {
    return true;
  }

  return /\.svg(?:$|\?|#)/i.test(source);
}

function inlineSvgDataUrlFromBytes(bytes: Buffer): string {
  const content = bytes.toString("utf8");
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(content)}`;
}

async function verifySvgRenderable(url: string): Promise<{ ok: boolean; reason?: string }> {
  const headResponse = await withRetry(() => fetch(url, { method: "HEAD" }), { retries: 1, minDelayMs: 200 });
  if (!headResponse.ok) {
    return { ok: false, reason: `svg-head-status-${headResponse.status}` };
  }

  const headType = normalizeMimeType(headResponse.headers.get("content-type") || undefined);
  if (headType !== "image/svg+xml") {
    return { ok: false, reason: `svg-head-content-type-${headType || "unknown"}` };
  }

  const getResponse = await withRetry(() => fetch(url, { method: "GET" }), { retries: 1, minDelayMs: 200 });
  if (!getResponse.ok) {
    return { ok: false, reason: `svg-get-status-${getResponse.status}` };
  }

  const bodyType = normalizeMimeType(getResponse.headers.get("content-type") || undefined);
  if (bodyType !== "image/svg+xml") {
    return { ok: false, reason: `svg-get-content-type-${bodyType || "unknown"}` };
  }

  const content = await getResponse.text();
  if (!/<svg[\s>]/i.test(content)) {
    return { ok: false, reason: "svg-get-body-missing-svg-tag" };
  }

  return { ok: true };
}

async function uploadOneAsset(
  uploader: AssetUploader,
  asset: AssetInput,
  retries: number,
  svgFallbackMode: SvgFallbackMode
): Promise<UploadOneAssetResult> {
  const source = sourceKeyOfAsset(asset);
  const resolved = await withRetry(() => resolveAssetInput(asset, { retries }), { retries, minDelayMs: 250 });
  const isSvg = isSvgAsset(resolved.contentType, resolved.fileName, source);

  if (svgFallbackMode === "always-inline" && isSvg) {
    const inlineUrl = inlineSvgDataUrlFromBytes(resolved.bytes);
    return {
      source,
      cdnUrl: inlineUrl,
      finalUrl: inlineUrl,
      objectKey: `inline-svg:${source}`,
      cached: false,
      size: resolved.bytes.byteLength,
      mimeType: resolved.contentType,
      renderMode: "inline-svg-no-upload",
      fallbackReason: "svg-always-inline-mode"
    };
  }

  const uploaded = await withRetry(() => uploader.upload(resolved), { retries, minDelayMs: 250 });

  let finalUrl = uploaded.cdnUrl;
  let renderMode: UploadRenderMode = "direct-url";
  let fallbackReason: string | undefined;

  if (isSvgAsset(uploaded.mimeType || resolved.contentType, resolved.fileName, source)) {
    let probeOk = true;
    let probeReason: string | undefined;
    try {
      const probe = await verifySvgRenderable(uploaded.cdnUrl);
      probeOk = probe.ok;
      probeReason = probe.reason;
    } catch (error) {
      probeOk = false;
      probeReason = error instanceof Error ? error.message : String(error);
    }

    if (!probeOk && svgFallbackMode === "inline") {
      finalUrl = inlineSvgDataUrlFromBytes(resolved.bytes);
      renderMode = "inline-svg";
      fallbackReason = probeReason;
    }
  }

  return {
    source,
    cdnUrl: uploaded.cdnUrl,
    finalUrl,
    objectKey: uploaded.objectKey,
    cached: uploaded.cached,
    size: uploaded.size,
    mimeType: uploaded.mimeType,
    renderMode,
    fallbackReason
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const uploader = createUploader(config);

  const server = new Server(
    {
      name: "figma-asset-cdn-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: TOOL_UPLOAD_ASSET,
          description: "Upload a single Figma image/icon to OSS and return CDN URL",
          inputSchema: {
            type: "object",
            properties: {
              sourceUrl: { type: "string", description: "Remote URL of the asset" },
              base64Data: { type: "string", description: "Base64 string or data URL" },
              fileName: { type: "string" },
              contentType: { type: "string" },
              folder: { type: "string", description: "Custom folder under prefix" }
            }
          }
        },
        {
          name: TOOL_BATCH_UPLOAD_ASSETS,
          description: "Batch upload multiple assets to OSS and return source to CDN mapping",
          inputSchema: {
            type: "object",
            properties: {
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sourceUrl: { type: "string" },
                    base64Data: { type: "string" },
                    fileName: { type: "string" },
                    contentType: { type: "string" },
                    folder: { type: "string" }
                  }
                }
              }
            },
            required: ["assets"]
          }
        },
        {
          name: TOOL_REWRITE_CODE_ASSET_URLS,
          description: "Rewrite asset URLs in generated frontend code to CDN URLs",
          inputSchema: {
            type: "object",
            properties: {
              code: { type: "string" },
              mapping: {
                type: "object",
                additionalProperties: { type: "string" }
              }
            },
            required: ["code", "mapping"]
          }
        },
        {
          name: TOOL_PROCESS_CODE_ASSETS,
          description:
            "End-to-end pipeline: extract assets from code, upload to OSS CDN, and return rewritten code",
          inputSchema: {
            type: "object",
            properties: {
              code: { type: "string" },
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sourceUrl: { type: "string" },
                    base64Data: { type: "string" },
                    fileName: { type: "string" },
                    contentType: { type: "string" },
                    folder: { type: "string" }
                  }
                }
              },
              folder: { type: "string" },
              extractFromCode: { type: "boolean" },
              retries: { type: "number" },
              svgFallbackMode: {
                type: "string",
                enum: ["none", "inline", "always-inline"],
                description:
                  "SVG handling mode: none=keep CDN URL, inline=fallback to inline only when CDN not renderable, always-inline=skip upload and inline SVG directly"
              }
            },
            required: ["code"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    if (name === TOOL_UPLOAD_ASSET) {
      const typed = args as UploadAssetArgs;
      const resolved = await resolveAssetInput(typed);
      const uploaded = await uploader.upload(resolved);
      return textResult(uploaded);
    }

    if (name === TOOL_BATCH_UPLOAD_ASSETS) {
      const typed = args as unknown as BatchUploadAssetsArgs;
      const items = typed.assets || [];
      const uploads: UploadOneAssetResult[] = [];
      const failures: Array<{ source: string; error: string }> = [];

      for (const asset of items) {
        try {
          uploads.push(await uploadOneAsset(uploader, asset, 2, "none"));
        } catch (error) {
          failures.push({
            source: sourceKeyOfAsset(asset),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const mapping: Record<string, string> = {};
      for (const item of uploads) {
        mapping[item.source] = item.finalUrl;
      }

      return textResult({ uploads, failures, mapping });
    }

    if (name === TOOL_REWRITE_CODE_ASSET_URLS) {
      const typed = args as unknown as RewriteCodeAssetUrlsArgs;
      const rewritten = rewriteAssetUrls(typed.code, typed.mapping);
      return textResult({ rewrittenCode: rewritten });
    }

    if (name === TOOL_PROCESS_CODE_ASSETS) {
      const typed = args as unknown as ProcessCodeAssetsArgs;
      const retries = Math.max(0, Math.min(typed.retries ?? 2, 5));
      const svgFallbackMode: SvgFallbackMode =
        typed.svgFallbackMode === "none"
          ? "none"
          : typed.svgFallbackMode === "always-inline"
            ? "always-inline"
            : "inline";
      const aggregate = new Map<string, AssetInput>();

      for (const asset of typed.assets || []) {
        const withDefaultFolder = {
          ...asset,
          folder: asset.folder || typed.folder
        };
        aggregate.set(sourceKeyOfAsset(withDefaultFolder), withDefaultFolder);
      }

      if (typed.extractFromCode !== false) {
        for (const ref of extractAssetRefsFromCode(typed.code)) {
          if (!aggregate.has(ref)) {
            if (ref.startsWith("data:")) {
              aggregate.set(ref, { base64Data: ref, folder: typed.folder });
            } else {
              aggregate.set(ref, { sourceUrl: ref, folder: typed.folder });
            }
          }
        }
      }

      const uploads: UploadOneAssetResult[] = [];
      const failures: Array<{ source: string; error: string }> = [];

      for (const asset of aggregate.values()) {
        try {
          uploads.push(await uploadOneAsset(uploader, asset, retries, svgFallbackMode));
        } catch (error) {
          failures.push({
            source: sourceKeyOfAsset(asset),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const mapping: Record<string, string> = {};
      for (const item of uploads) {
        mapping[item.source] = item.finalUrl;
      }

      const rewrittenCode = rewriteAssetUrls(typed.code, mapping);
      return textResult({
        uploads,
        failures,
        mapping,
        rewrittenCode
      });
    }

    throw new Error(`Unknown tool name: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
