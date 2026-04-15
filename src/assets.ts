import { fileNameFromSourceUrl, mimeTypeFromFileName, normalizeMimeType } from "./mime.js";

export interface AssetInput {
  sourceUrl?: string;
  base64Data?: string;
  fileName?: string;
  contentType?: string;
  folder?: string;
}

export interface ResolvedAsset {
  bytes: Buffer;
  fileName?: string;
  contentType?: string;
  folder?: string;
}

export interface ResolveAssetOptions {
  retries?: number;
}

function fromDataUrl(dataUrl: string): { contentType?: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { data: dataUrl };
  }

  return {
    contentType: match[1],
    data: match[2]
  };
}

export function sourceKeyOfAsset(input: AssetInput): string {
  if (input.sourceUrl) {
    return input.sourceUrl;
  }

  if (input.base64Data) {
    return `base64:${input.fileName || "asset"}:${input.base64Data.slice(0, 32)}`;
  }

  return input.fileName || "unknown-asset";
}

export function extractAssetRefsFromCode(code: string): string[] {
  const refs = new Set<string>();

  const attrRegex = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(code))) {
    const value = attrMatch[1];
    if (/^(https?:\/\/|data:)/i.test(value)) {
      refs.add(value);
    }
  }

  const cssUrlRegex = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let cssMatch: RegExpExecArray | null;
  while ((cssMatch = cssUrlRegex.exec(code))) {
    const value = cssMatch[1];
    if (/^(https?:\/\/|data:)/i.test(value)) {
      refs.add(value);
    }
  }

  return Array.from(refs);
}

export async function resolveAssetInput(input: AssetInput, options: ResolveAssetOptions = {}): Promise<ResolvedAsset> {
  if (input.base64Data) {
    const parsed = fromDataUrl(input.base64Data);
    const fileName = input.fileName;
    const contentType = normalizeMimeType(input.contentType || parsed.contentType || mimeTypeFromFileName(fileName));

    return {
      bytes: Buffer.from(parsed.data, "base64"),
      fileName,
      contentType,
      folder: input.folder
    };
  }

  if (input.sourceUrl) {
    const retries = options.retries ?? 2;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      response = await fetch(input.sourceUrl);
      if (response.ok) {
        break;
      }

      if (attempt === retries) {
        break;
      }
    }

    if (!response) {
      throw new Error(`Failed to fetch sourceUrl: ${input.sourceUrl}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch sourceUrl: ${input.sourceUrl}, status=${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const fileName = input.fileName || fileNameFromSourceUrl(input.sourceUrl);
    const contentType = normalizeMimeType(
      input.contentType || response.headers.get("content-type") || mimeTypeFromFileName(fileName)
    );

    return {
      bytes,
      fileName,
      contentType,
      folder: input.folder
    };
  }

  throw new Error("Either sourceUrl or base64Data is required");
}

export function rewriteAssetUrls(code: string, mapping: Record<string, string>): string {
  let next = code;
  for (const [from, to] of Object.entries(mapping)) {
    if (!from) {
      continue;
    }

    next = next.split(from).join(to);
  }
  return next;
}
