import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 200) {
    throw new Error("Password must be between 8 and 200 characters");
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function parseStored(stored: string): { salt: Buffer; hash: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [scheme, n, r, p, saltHex, hashHex] = parts;
  if (scheme !== "scrypt" || !n || !r || !p || !saltHex || !hashHex) return null;
  if (Number(n) !== N || Number(r) !== R || Number(p) !== P) return null;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return null;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  if (salt.length < 16 || hash.length !== KEYLEN) return null;
  return { salt, hash };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length < 1 || password.length > 200) return false;
  const parsed = parseStored(stored);
  const salt = parsed?.salt ?? Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const expected = parsed?.hash ?? Buffer.alloc(KEYLEN, 1);
  const actual = await derive(password, salt);
  if (actual.length !== expected.length) return false;
  const matches = timingSafeEqual(actual, expected);
  return parsed !== null && matches;
}
