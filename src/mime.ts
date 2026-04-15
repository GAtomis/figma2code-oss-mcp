import { basename, extname } from "node:path";

const EXT_TO_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

const MIME_TO_EXT: Record<string, string> = {
  "image/svg+xml": ".svg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/x-icon": ".ico"
};

export function normalizeMimeType(contentType?: string): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const base = contentType.split(";")[0]?.trim().toLowerCase();
  if (!base) {
    return undefined;
  }

  if (base === "doc/svg") {
    return "image/svg+xml";
  }

  return base;
}

export function extensionFromMimeType(contentType?: string): string | undefined {
  const normalized = normalizeMimeType(contentType);
  if (!normalized) {
    return undefined;
  }

  return MIME_TO_EXT[normalized];
}

export function mimeTypeFromFileName(fileName?: string): string | undefined {
  if (!fileName) {
    return undefined;
  }

  const ext = extname(fileName).toLowerCase();
  return EXT_TO_MIME[ext];
}

export function fileNameFromSourceUrl(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const fromPath = basename(url.pathname || "");
    if (fromPath && fromPath !== "/") {
      return decodeURIComponent(fromPath);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function ensureFileNameWithExtension(fileName: string, contentType?: string): string {
  const currentExt = extname(fileName);
  if (currentExt) {
    return fileName;
  }

  const ext = extensionFromMimeType(contentType);
  if (!ext) {
    return fileName;
  }

  return `${fileName}${ext}`;
}

export function buildUploadContentType(contentType?: string): string | undefined {
  const normalized = normalizeMimeType(contentType);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "image/svg+xml") {
    return "image/svg+xml; charset=utf-8";
  }

  return normalized;
}
