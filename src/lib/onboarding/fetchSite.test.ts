import { describe, expect, it } from "vitest";
import { fetchSite, isPrivateIp } from "./fetchSite";

const production = { NODE_ENV: "production", ALLOW_LOCAL_ONBOARDING: "" };

function htmlResponse(body = "<html><title>Ok</title></html>", status = 200, headers?: HeadersInit) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function mustNotFetch(): Promise<Response> {
  return Promise.reject(new Error("should not fetch"));
}

describe("private IP guard", () => {
  it("classifies private and public addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("172.15.255.255")).toBe(false);
    expect(isPrivateIp("172.16.0.0")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("100.64.1.1")).toBe(true);
    expect(isPrivateIp("100.128.0.1")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks private targets in production, including DNS and redirects", async () => {
    const blocked = [
      "http://127.0.0.1/demo-site",
      "http://10.0.0.5/",
      "http://192.168.1.20/a",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://localhost/demo-site",
      "http://2130706433/",
      "ftp://example.com/file",
    ];
    for (const url of blocked) {
      await expect(fetchSite(url, { env: production, fetchImpl: mustNotFetch })).rejects.toThrow(/private|http/i);
    }

    await expect(
      fetchSite("http://rebind.test/admin", {
        env: production,
        lookupHost: async () => ["10.1.1.1"],
        fetchImpl: mustNotFetch,
      }),
    ).rejects.toThrow(/private/i);

    await expect(
      fetchSite("https://public.test/start", {
        env: production,
        lookupHost: async (host) => (host === "public.test" ? ["93.184.216.34"] : ["127.0.0.1"]),
        fetchImpl: async (input) => {
          if (String(input).includes("public.test")) {
            return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
          }
          throw new Error("followed private redirect");
        },
      }),
    ).rejects.toThrow(/private/i);
  });

  it("allows private addresses outside production and when local onboarding is enabled", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return htmlResponse();
    };
    await fetchSite("http://127.0.0.1/demo-site", { env: { NODE_ENV: "development" }, fetchImpl });
    await fetchSite("http://127.0.0.1/demo-site", {
      env: { NODE_ENV: "production", ALLOW_LOCAL_ONBOARDING: "1" },
      fetchImpl,
    });
    expect(seen).toHaveLength(2);
  });

  it("fetches public hosts and enforces the size cap", async () => {
    const ok = await fetchSite("https://example.com/page", {
      env: production,
      lookupHost: async () => ["93.184.216.34"],
      fetchImpl: async () => htmlResponse("<html><title>Example</title></html>"),
    });
    expect(ok.html).toContain("Example");
    expect(ok.url).toBe("https://example.com/page");

    await expect(
      fetchSite("http://8.8.8.8/", {
        env: production,
        lookupHost: async () => {
          throw new Error("literal addresses should not be resolved");
        },
        fetchImpl: async () => htmlResponse(),
      }),
    ).resolves.toMatchObject({ html: expect.stringContaining("Ok") });

    await expect(
      fetchSite("https://example.com/big", {
        env: production,
        maxBytes: 16,
        lookupHost: async () => ["1.1.1.1"],
        fetchImpl: async () => htmlResponse("0123456789abcdefghij"),
      }),
    ).rejects.toThrow(/larger/i);
  });
});
