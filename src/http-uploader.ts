import { AppConfig } from "./config.js";
import { randomUUID } from "node:crypto";
import { sha1Hex } from "./hash.js";
import { buildUploadContentType, ensureFileNameWithExtension, extensionFromMimeType, normalizeMimeType } from "./mime.js";
import { withRetry } from "./retry.js";
import { UploadInput, UploadResult } from "./oss.js";

function getByPath(source: unknown, path: string): unknown {
  const keys = path.split(".").filter(Boolean);
  let current: unknown = source;
  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeUrl(url: string): string {
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return url;
}

export class HttpUploader {
  private readonly uploadCache = new Map<string, UploadResult>();

  constructor(private readonly config: AppConfig) {}

  async upload(input: UploadInput): Promise<UploadResult> {
    if (!this.config.http) {
      throw new Error("HTTP upload config is missing");
    }

    const digest = sha1Hex(input.bytes);
    const normalizedMime = normalizeMimeType(input.contentType);
    const ext = extensionFromMimeType(normalizedMime);
    const objectKey = `${this.config.defaultPrefix}/${digest}${ext || ""}`;
    const hit = this.uploadCache.get(objectKey);
    if (hit) {
      return { ...hit, cached: true };
    }

    const uploadContentType = buildUploadContentType(normalizedMime || "application/octet-stream") || "application/octet-stream";
    const blob = new Blob([new Uint8Array(input.bytes)], {
      type: uploadContentType
    });

    const form = new FormData();
    const rawFileName = input.fileName || `${digest}`;
    const fileName = ensureFileNameWithExtension(rawFileName, normalizedMime || uploadContentType) || `${digest}.bin`;
    form.append(this.config.http.fileField, blob, fileName);

    // Match qq uploader style fields from the provided curl sample.
    const qqUuid = randomUUID().toUpperCase();
    const autoFields: Record<string, string> = {
      qqfilename: fileName,
      qqfile: fileName,
      qqpartindex: "0",
      qqtotalparts: "1",
      qqtotalfilesize: String(input.bytes.byteLength),
      qquuid: qqUuid
    };

    const mergedFormFields: Record<string, string> = {
      ...autoFields,
      ...this.config.http.staticForm
    };

    if (normalizeMimeType(uploadContentType) === "image/svg+xml") {
      // Prevent some gateways from converting svg into non-standard document mime types.
      mergedFormFields.autoConvert = "false";
    }

    for (const [key, value] of Object.entries(mergedFormFields)) {
      form.append(key, value);
    }

    const requestHeaders: Record<string, string> = { ...this.config.http.headers };
    // Let fetch set multipart boundary automatically.
    delete requestHeaders["Content-Type"];
    delete requestHeaders["content-type"];

    const response = await withRetry(
      () =>
        fetch(this.config.http!.url, {
          method: "POST",
          headers: requestHeaders,
          body: form
        }),
      { retries: 2, minDelayMs: 300 }
    );

    if (!response.ok) {
      throw new Error(`HTTP upload failed with status ${response.status}`);
    }

    const json = (await response.json()) as unknown;

    if (this.config.http.responseSuccessField && this.config.http.responseSuccessValue) {
      const current = getByPath(json, this.config.http.responseSuccessField);
      if (String(current) !== this.config.http.responseSuccessValue) {
        throw new Error(
          `Upload response success check failed: ${this.config.http.responseSuccessField}=${String(current)}`
        );
      }
    }

    const filePathRaw = getByPath(json, this.config.http.responseFilePathField);
    if (!filePathRaw) {
      throw new Error(`Cannot find response path: ${this.config.http.responseFilePathField}`);
    }

    const cdnUrl = normalizeUrl(String(filePathRaw));

    if (normalizeMimeType(uploadContentType) === "image/svg+xml") {
      const head = await withRetry(
        () =>
          fetch(cdnUrl, {
            method: "HEAD"
          }),
        { retries: 1, minDelayMs: 200 }
      );

      if (head.ok) {
        const responseType = normalizeMimeType(head.headers.get("content-type") || undefined);
        if (responseType !== "image/svg+xml") {
          throw new Error(
            `Uploaded SVG has invalid CDN content-type: ${responseType || "unknown"}, expected image/svg+xml`
          );
        }
      }
    }

    const output: UploadResult = {
      objectKey,
      cdnUrl,
      size: input.bytes.byteLength,
      mimeType: uploadContentType,
      cached: false
    };

    this.uploadCache.set(objectKey, output);
    return output;
  }
}
