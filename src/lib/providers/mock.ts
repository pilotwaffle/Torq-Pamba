import { portraitInner, type PortraitSpec } from "@/lib/avatars/portrait";
import type { ClipRequest, ClipResult, ImageResult } from "./types";
import { ProviderRefusedError } from "./types";

const refusedOnce = new Set<string>();

const SETTINGS = ["kitchen", "street", "desk"] as const;
type Setting = (typeof SETTINGS)[number];

const DEFAULT_PORTRAIT: PortraitSpec = {
  skin: "#C68642",
  hair: "#241910",
  hairStyle: "bun",
  shirt: "#3E6B52",
  background: "#E7EFEA",
  eye: "#241C18",
};

export function resetMockRefusals(): void {
  refusedOnce.clear();
}

function hue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeSvg(value: string): string {
  if (value.startsWith("<svg")) return value;
  if (!value.startsWith("data:image/svg+xml")) return "";
  const comma = value.indexOf(",");
  if (comma < 0) return "";
  try {
    return decodeURIComponent(value.slice(comma + 1));
  } catch {
    return "";
  }
}

function portraitMarkup(value: string | undefined): string {
  const raw = value ? decodeSvg(value) : "";
  if (raw) {
    const match = raw.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
    const inner = (match?.[1] ?? "").replace(/<rect\b[^>]*\bwidth="160"[^>]*\bheight="200"[^>]*\/>/g, "");
    if (inner.trim() && !/<script/i.test(inner)) return inner;
  }
  return portraitInner(DEFAULT_PORTRAIT);
}

function settingShapes(setting: Setting): string {
  if (setting === "kitchen") {
    return `<rect width="360" height="250" fill="#F6D7B0"/>
      <rect x="24" y="72" width="108" height="78" rx="4" fill="#F7F1E6"/>
      <rect x="32" y="80" width="92" height="54" fill="#C5D8E8"/>
      <rect x="74" y="80" width="6" height="54" fill="#E7D3B0"/>
      <rect x="32" y="104" width="92" height="6" fill="#E7D3B0"/>
      <rect x="196" y="64" width="140" height="40" rx="3" fill="#8C5A3C"/>
      <rect x="204" y="72" width="56" height="22" rx="2" fill="#A56B49"/>
      <rect x="268" y="72" width="56" height="22" rx="2" fill="#A56B49"/>
      <rect y="250" width="360" height="220" fill="#F4E4D0"/>
      <rect x="36" y="392" width="26" height="76" rx="6" fill="#F4F7F2"/>
      <rect x="42" y="378" width="14" height="18" rx="3" fill="#3E6B52"/>
      <rect y="468" width="360" height="16" fill="#E7D3A1"/>
      <rect y="484" width="360" height="156" fill="#C4A27A"/>`;
  }
  if (setting === "street") {
    return `<rect x="0" y="168" width="84" height="312" fill="#D9D3CB"/>
      <rect x="12" y="188" width="16" height="22" fill="#E7EEF4"/>
      <rect x="36" y="188" width="16" height="22" fill="#E7EEF4"/>
      <rect x="12" y="222" width="16" height="22" fill="#E7EEF4"/>
      <rect x="36" y="222" width="16" height="22" fill="#E7EEF4"/>
      <rect x="96" y="214" width="70" height="266" fill="#C3BEB6"/>
      <rect x="108" y="232" width="18" height="24" fill="#E7EEF4"/>
      <rect x="134" y="232" width="18" height="24" fill="#E7EEF4"/>
      <rect x="176" y="140" width="96" height="340" fill="#E4E0D8"/>
      <rect x="190" y="162" width="22" height="28" fill="#C9D7E6"/>
      <rect x="222" y="162" width="22" height="28" fill="#C9D7E6"/>
      <rect x="190" y="204" width="22" height="28" fill="#C9D7E6"/>
      <rect x="222" y="204" width="22" height="28" fill="#C9D7E6"/>
      <rect x="282" y="196" width="78" height="284" fill="#B7C3CE"/>
      <rect y="470" width="360" height="54" fill="#C5CBD1"/>
      <rect y="524" width="360" height="116" fill="#3E4650"/>
      <rect y="556" width="360" height="8" fill="#E6C56A"/>`;
  }
  return `<rect x="28" y="64" width="132" height="88" rx="4" fill="#F7FBFD"/>
    <rect x="36" y="72" width="116" height="72" fill="#B9D4EA"/>
    <rect x="90" y="72" width="6" height="72" fill="#F7FBFD"/>
    <rect x="36" y="104" width="116" height="6" fill="#F7FBFD"/>
    <rect y="468" width="360" height="16" fill="#E4D2B4"/>
    <rect y="484" width="360" height="156" fill="#8D6A45"/>
    <rect x="248" y="400" width="72" height="50" rx="3" fill="#2C333A"/>
    <rect x="254" y="406" width="60" height="38" fill="#9FD0EA"/>
    <rect x="232" y="450" width="104" height="8" rx="2" fill="#3A4046"/>`;
}

export function mockFrameSvg(
  providerId: string,
  prompt: string,
  options?: { sceneIndex?: number; portraitSvg?: string },
): string {
  const index = options?.sceneIndex ?? hue(providerId + prompt) % 3;
  const setting = SETTINGS[((index % 3) + 3) % 3] ?? "kitchen";
  const label = escapeXml(`Scene ${index + 1} · ${providerId}`);
  const chipWidth = Math.min(328, Math.max(96, Math.round(label.length * 6.4 + 22)));
  const gradientId = `bg${setting}${providerId.replace(/[^a-z0-9]/gi, "")}${index}`;
  const stops =
    setting === "kitchen"
      ? ["#F8E2C8", "#E7B98A"]
      : setting === "street"
        ? ["#D5E9F8", "#9BB6CC"]
        : ["#E7EEF4", "#C5D0DA"];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" role="img" data-setting="${setting}">
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${stops[0]}"/>
        <stop offset="1" stop-color="${stops[1]}"/>
      </linearGradient>
    </defs>
    <rect width="360" height="640" fill="url(#${gradientId})"/>
    ${settingShapes(setting)}
    <ellipse cx="180" cy="476" rx="58" ry="8" fill="#000" fill-opacity="0.12"/>
    <g transform="translate(96,252) scale(1.08)">
      <svg width="160" height="200" viewBox="0 0 160 200" overflow="hidden">
        <defs><clipPath id="${gradientId}clip"><rect width="160" height="200"/></clipPath></defs>
        <g clip-path="url(#${gradientId}clip)">${portraitMarkup(options?.portraitSvg)}</g>
      </svg>
    </g>
    <g transform="translate(16,148)">
      <rect width="${chipWidth}" height="26" rx="13" fill="#111827" fill-opacity="0.72"/>
      <text x="12" y="17" fill="#ffffff" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>
    </g>
  </svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function assertNotRefused(providerId: string, req: ClipRequest): void {
  if (req.prompt.includes("[refuse-all]")) {
    throw new ProviderRefusedError(providerId, "Safety filter refused the prompt");
  }
  if (!req.prompt.includes("[refuse]")) return;
  const key = req.sceneId ?? req.prompt;
  if (refusedOnce.has(key)) return;
  refusedOnce.add(key);
  throw new ProviderRefusedError(providerId, "Safety filter refused the prompt");
}

export async function mockGenerateClip(
  providerId: string,
  pricePerSecondUsd: number,
  req: ClipRequest,
): Promise<ClipResult> {
  assertNotRefused(providerId, req);
  return {
    providerId,
    durationS: req.durationS,
    frameUrls: [
      svgDataUrl(
        mockFrameSvg(providerId, req.prompt, {
          sceneIndex: req.sceneIndex,
          portraitSvg: req.portraitSvg,
        }),
      ),
    ],
    costUsd: pricePerSecondUsd * req.durationS,
  };
}

export async function mockGenerateImage(providerId: string, pricePerImageUsd: number, prompt: string): Promise<ImageResult> {
  if (prompt.includes("[refuse]")) throw new ProviderRefusedError(providerId, "Safety filter refused the prompt");
  return {
    providerId,
    url: svgDataUrl(mockFrameSvg(providerId, prompt)),
    costUsd: pricePerImageUsd,
  };
}
