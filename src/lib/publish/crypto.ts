import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * OAuth tokens are sealed with AES-256-GCM before they touch the database.
 * TOKEN_ENCRYPTION_KEY is 32 bytes as 64 hex chars or base64. Production
 * refuses to run without it; development and tests use a labeled dev key.
 */

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

const DEV_KEY = createHash("sha256").update("torq-pamba-dev-only-token-key (never use in production)").digest();

export function tokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) {
    if (env.NODE_ENV === "production") {
      throw new TokenKeyError("TOKEN_ENCRYPTION_KEY is not set. Refusing to store OAuth tokens in production.");
    }
    return DEV_KEY;
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** Stored in `publishing_connections.token_key_version`. Bump it when TOKEN_ENCRYPTION_KEY rotates. */
export const TOKEN_KEY_VERSION = 1;

export function sealToken(plain: string, key = tokenKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function openToken(sealed: string, key = tokenKey()): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new TokenKeyError("Unrecognized sealed token");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenKeyError("Sealed token failed authentication");
  }
}
