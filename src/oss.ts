import OSS from "ali-oss";
import { extname } from "node:path";
import { AppConfig } from "./config.js";
import { sha1Hex } from "./hash.js";
import { buildUploadContentType, extensionFromMimeType, normalizeMimeType } from "./mime.js";
import { withRetry } from "./retry.js";

export interface UploadInput {
  bytes: Buffer;
  fileName?: string;
  contentType?: string;
  folder?: string;
}

export interface UploadResult {
  objectKey: string;
  cdnUrl: string;
  etag?: string;
  size: number;
  mimeType?: string;
  cached?: boolean;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/svg+xml": ".svg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/x-icon": ".ico"
};

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

function inferExtension(fileName?: string, contentType?: string): string {
  if (fileName) {
    const ext = extname(fileName);
    if (ext) return ext;
  }

  const fromMime = extensionFromMimeType(contentType);
  if (fromMime) {
    return fromMime;
  }

  const normalized = normalizeMimeType(contentType);
  if (normalized && MIME_TO_EXT[normalized]) {
    return MIME_TO_EXT[normalized];
  }

  return ".bin";
}

function makeObjectKey(prefix: string, folder: string | undefined, bytes: Buffer, ext: string): string {
  const digest = sha1Hex(bytes);
  const shardA = digest.slice(0, 2);
  const shardB = digest.slice(2, 4);
  const allParts = [prefix, folder, shardA, shardB].filter(Boolean).map((part) => normalizeFolder(part!));
  return `${allParts.join("/")}/${digest}${ext}`;
}

function makeCdnUrl(config: AppConfig, objectKey: string): string {
  if (config.cdnBaseUrl) {
    return `${config.cdnBaseUrl.replace(/\/+$/, "")}/${objectKey}`;
  }

  if (!config.oss) {
    throw new Error("OSS config is missing");
  }

  return `https://${config.oss.bucket}.${config.oss.region}.aliyuncs.com/${objectKey}`;
}

export class OssUploader {
  private readonly client: OSS;
  private readonly uploadCache = new Map<string, UploadResult>();

  constructor(private readonly config: AppConfig) {
    if (!config.oss) {
      throw new Error("OSS config is missing");
    }

    this.client = new OSS({
      region: config.oss.region,
      bucket: config.oss.bucket,
      accessKeyId: config.oss.accessKeyId,
      accessKeySecret: config.oss.accessKeySecret
    });
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const uploadContentType = buildUploadContentType(input.contentType);
    const ext = inferExtension(input.fileName, uploadContentType);
    const objectKey = makeObjectKey(this.config.defaultPrefix, input.folder, input.bytes, ext);

    const hit = this.uploadCache.get(objectKey);
    if (hit) {
      return { ...hit, cached: true };
    }

    const headers: Record<string, string> = {};
    if (uploadContentType) {
      headers["Content-Type"] = uploadContentType;
    }

    let existsContentType: string | undefined;

    const exists = await withRetry(async () => {
      try {
        const head = await this.client.head(objectKey);
        const headHeaders = (head.res?.headers || {}) as Record<string, string | undefined>;
        existsContentType = normalizeMimeType(headHeaders["content-type"] || headHeaders["Content-Type"]);
        return true;
      } catch {
        return false;
      }
    });

    let responseHeaders: Record<string, string | undefined> = {};
    const expectedType = normalizeMimeType(uploadContentType);
    const needsMetadataFix = Boolean(exists && expectedType && existsContentType && existsContentType !== expectedType);

    if (!exists || needsMetadataFix) {
      const result = await withRetry(() => this.client.put(objectKey, input.bytes, { headers }), {
        retries: 2,
        minDelayMs: 300
      });
      responseHeaders = (result.res?.headers || {}) as Record<string, string | undefined>;
    }

    const output: UploadResult = {
      objectKey,
      cdnUrl: makeCdnUrl(this.config, objectKey),
      etag: responseHeaders.etag,
      size: input.bytes.byteLength,
      mimeType: uploadContentType,
      cached: exists && !needsMetadataFix
    };

    this.uploadCache.set(objectKey, output);
    return output;
  }
}
