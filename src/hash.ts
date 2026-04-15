import { createHash } from "node:crypto";

export function sha1Hex(input: Buffer): string {
  return createHash("sha1").update(input).digest("hex");
}
