import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const FETCH_TIMEOUT_MS = 8_000;
export const FETCH_MAX_BYTES = Math.floor(1.5 * 1024 * 1024);
const MAX_REDIRECTS = 4;

const PRIVATE_MESSAGE =
  "That address is private or local. Onboarding can only fetch public websites.";

export class FetchSiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchSiteError";
  }
}

export type FetchEnv = {
  NODE_ENV?: string;
  ALLOW_LOCAL_ONBOARDING?: string;
};

export type FetchSiteOptions = {
  env?: FetchEnv;
  lookupHost?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

type IpClass = "name" | "public" | "private";

export function localOnboardingAllowed(env: FetchEnv = process.env): boolean {
  if (env.ALLOW_LOCAL_ONBOARDING === "1") return true;
  return env.NODE_ENV !== "production";
}

export function isPrivateIp(address: string): boolean {
  const ip = canonicalIp(address.trim().toLowerCase());
  if (!ip || ip === "invalid") return false;
  return ip.includes(":") ? isPrivateV6(ip) : isPrivateV4(ip);
}

export async function assertFetchableUrl(raw: string, options: FetchSiteOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchSiteError("Enter a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchSiteError("Only http and https URLs can be analyzed");
  }
  if (!url.hostname) throw new FetchSiteError("Enter a valid http or https URL");
  url.username = "";
  url.password = "";
  url.hash = "";

  if (localOnboardingAllowed(options.env ?? process.env)) return url;

  const kind = classifyHost(url.hostname);
  if (kind === "private") throw new FetchSiteError(PRIVATE_MESSAGE);
  if (kind === "public") return url;

  let addresses: string[];
  try {
    addresses = await (options.lookupHost ?? defaultLookup)(url.hostname);
  } catch {
    throw new FetchSiteError("Could not resolve that host");
  }
  if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address))) {
    throw new FetchSiteError(PRIVATE_MESSAGE);
  }
  return url;
}

export async function fetchSite(
  raw: string,
  options: FetchSiteOptions = {},
): Promise<{ url: string; html: string }> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = await assertFetchableUrl(raw, options);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Torq-Pamba/onboarding",
        },
      });
    } catch (error) {
      if (isTimeout(error)) throw new FetchSiteError("The page took longer than 8 seconds");
      throw new FetchSiteError("Could not reach the website");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new FetchSiteError("The website returned a redirect without a location");
      if (hop === MAX_REDIRECTS) throw new FetchSiteError("The website redirected too many times");
      current = await assertFetchableUrl(new URL(location, current).toString(), options);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      throw new FetchSiteError(`The website returned ${response.status}`);
    }

    const type = response.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      await response.body?.cancel();
      throw new FetchSiteError("The page is not HTML");
    }

    const html = await readLimited(response, maxBytes);
    if (!html.trim()) throw new FetchSiteError("The page was empty");
    return { url: current.toString(), html };
  }

  throw new FetchSiteError("The website redirected too many times");
}

function classifyHost(hostname: string): IpClass {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isLocalHostname(host)) return "private";
  const ip = canonicalIp(host);
  if (ip === null) return "name";
  if (ip === "invalid" || isPrivateIp(ip)) return "private";
  return "public";
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host === "localhost.localdomain") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function canonicalIp(host: string): string | null | "invalid" {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = bare.match(/^(?:::ffff:|.*:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return canonicalIp(mapped[1]);
  if (bare.includes(":")) return isIP(bare) === 6 ? bare : "invalid";
  if (/^0x[0-9a-f]+$/.test(bare)) return integerToIpv4(Number(bare)) ?? "invalid";
  if (/^\d+$/.test(bare)) return integerToIpv4(Number(bare)) ?? "invalid";

  const parts = bare.split(".");
  if (parts.every((part) => /^\d+$/.test(part))) {
    if (parts.some((part) => part.length > 1 && part.startsWith("0"))) return "invalid";
    if (parts.length === 4 && parts.every((part) => Number(part) <= 255)) {
      return parts.map((part) => String(Number(part))).join(".");
    }
    return "invalid";
  }
  return null;
}

function integerToIpv4(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const blocks: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return blocks.some(([base, bits]) => inCidr(value, base, bits));
}

function ipv4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split(".").map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function inCidr(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

function isPrivateV6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) {
    const v4 = value.slice("::ffff:".length);
    return isIP(v4) === 4 ? isPrivateV4(v4) : true;
  }
  const bytes = ipv6Bytes(value);
  if (!bytes) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xff) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  return false;
}

function ipv6Bytes(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  const parts = tail === null ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    const n = Number.parseInt(part, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new FetchSiteError(tooLarge(maxBytes));
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > maxBytes) throw new FetchSiteError(tooLarge(maxBytes));
    return text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new FetchSiteError(tooLarge(maxBytes));
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function tooLarge(maxBytes: number): string {
  if (maxBytes === FETCH_MAX_BYTES) return "The page is larger than 1.5MB";
  return `The page is larger than ${maxBytes} bytes`;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
