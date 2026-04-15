export type UploadProvider = "oss" | "http";

export interface OssConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export interface HttpUploadConfig {
  url: string;
  fileField: string;
  responseFilePathField: string;
  responseSuccessField?: string;
  responseSuccessValue?: string;
  headers: Record<string, string>;
  staticForm: Record<string, string>;
}

export interface AppConfig {
  uploadProvider: UploadProvider;
  oss?: OssConfig;
  http?: HttpUploadConfig;
  cdnBaseUrl?: string;
  defaultPrefix: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseRecordEnv(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON object`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be JSON object`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = String(value);
  }
  return out;
}

export function loadConfig(): AppConfig {
  const provider = (process.env.UPLOAD_PROVIDER || "oss").toLowerCase() as UploadProvider;

  if (provider === "http") {
    return {
      uploadProvider: "http",
      http: {
        url: requiredEnv("HTTP_UPLOAD_URL"),
        fileField: process.env.HTTP_UPLOAD_FILE_FIELD || "file",
        responseFilePathField: process.env.HTTP_UPLOAD_RESPONSE_FILE_PATH_FIELD || "data.filePath",
        responseSuccessField: process.env.HTTP_UPLOAD_RESPONSE_SUCCESS_FIELD,
        responseSuccessValue: process.env.HTTP_UPLOAD_RESPONSE_SUCCESS_VALUE,
        headers: parseRecordEnv("HTTP_UPLOAD_HEADERS_JSON"),
        staticForm: parseRecordEnv("HTTP_UPLOAD_FORM_JSON")
      },
      cdnBaseUrl: process.env.CDN_BASE_URL,
      defaultPrefix: process.env.OSS_DEFAULT_PREFIX || "figma-assets"
    };
  }

  return {
    uploadProvider: "oss",
    oss: {
      region: requiredEnv("OSS_REGION"),
      bucket: requiredEnv("OSS_BUCKET"),
      accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
      accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET")
    },
    cdnBaseUrl: process.env.CDN_BASE_URL,
    defaultPrefix: process.env.OSS_DEFAULT_PREFIX || "figma-assets"
  };
}
