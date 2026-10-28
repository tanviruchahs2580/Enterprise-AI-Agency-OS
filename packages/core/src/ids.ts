import { createHash, randomUUID } from "node:crypto";

import { AppError } from "./errors.js";

export const newId = (): string => randomUUID();

export const newRequestId = (): string => `req_${randomUUID()}`;

export function newCode(prefix: string, seq: number): string {
  if (typeof prefix !== "string") {
    throw AppError.validation("Code prefix must be a string");
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw AppError.validation(
      "Code prefix must start with a letter and contain only letters, digits, underscore, or hyphen",
    );
  }
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw AppError.validation("Code sequence must be a non-negative safe integer");
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export function shortHash(input: string, len = 16): string {
  if (typeof input !== "string") {
    throw AppError.validation("shortHash input must be a string");
  }
  if (!Number.isInteger(len) || len < 1 || len > 64) {
    throw AppError.validation("shortHash length must be an integer between 1 and 64");
  }
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, len);
}
