import { AppConfig } from "./config.js";
import { HttpUploader } from "./http-uploader.js";
import { OssUploader, UploadInput, UploadResult } from "./oss.js";

export interface AssetUploader {
  upload(input: UploadInput): Promise<UploadResult>;
}

export function createUploader(config: AppConfig): AssetUploader {
  if (config.uploadProvider === "http") {
    return new HttpUploader(config);
  }

  return new OssUploader(config);
}
