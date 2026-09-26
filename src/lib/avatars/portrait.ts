export const HAIR_STYLES = ["short", "bun", "bob", "curly", "buzz", "long", "waves", "pixie"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export type PortraitSpec = {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  background: string;
  eye: string;
};

export const SCENE_NAMES = ["kitchen", "street", "desk"] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export function portraitSvg(spec: PortraitSpec, label: string, seed = ""): string {
  const seedAttr = seed ? ` data-seed="${xml(seed)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200" role="img" aria-label="${xml(label)}"${seedAttr}>${portraitBody(spec, true)}</svg>`;
}

/** Portrait shapes without the card backdrop, for compositing into a scene. */
export function portraitInner(spec: PortraitSpec): string {
  return portraitBody(spec, false);
}

export function sceneSvg(spec: PortraitSpec, scene: SceneName, label: string, seed = ""): string {
  const seedAttr = seed ? ` data-seed="${xml(seed)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${xml(`${label} in the ${scene}`)}"${seedAttr}>${sceneBackground(scene)}<g transform="translate(188,8) scale(0.82)">${portraitBody(spec, false)}</g></svg>`;
}

export function sceneFrames(spec: PortraitSpec, label: string, seed = ""): { name: string; startFrame: string }[] {
  return SCENE_NAMES.map((name) => ({
    name,
    startFrame: svgDataUrl(sceneSvg(spec, name, label, seed)),
  }));
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function portraitBody(spec: PortraitSpec, backdrop: boolean): string {
  const lip = luminance(spec.skin) < 140 ? "#E7B2A4" : "#7A4038";
  const backdropRect = backdrop
    ? `<rect width="160" height="200" rx="18" fill="${spec.background}"/>`
    : "";
  return `${backdropRect}
    ${hairBack(spec)}
    <ellipse cx="80" cy="198" rx="72" ry="44" fill="${spec.shirt}"/>
    <rect x="68" y="116" width="24" height="28" rx="8" fill="${spec.skin}"/>
    <circle cx="80" cy="90" r="34" fill="${spec.skin}"/>
    ${hairFront(spec)}
    <circle cx="68" cy="90" r="2.6" fill="${spec.eye}"/>
    <circle cx="94" cy="90" r="2.6" fill="${spec.eye}"/>
    <path d="M70 106q10 9 22 0" fill="none" stroke="${lip}" stroke-width="1.8" stroke-linecap="round"/>`;
}

function hairBack(spec: PortraitSpec): string {
  const color = spec.hair;
  switch (spec.hairStyle) {
    case "bun":
      return `<circle cx="80" cy="48" r="16" fill="${color}"/>`;
    case "bob":
      return `<path d="M44 96c-2 30 10 46 24 36 2-18-8-24-8-46zM116 96c2 30-10 46-24 36-2-18 8-24 8-46z" fill="${color}"/>`;
    case "curly":
      return [
        [54, 62],
        [80, 46],
        [106, 62],
        [46, 86],
        [114, 86],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="14" fill="${color}"/>`)
        .join("");
    case "long":
      return `<path d="M50 78c-10 48-6 86 12 92 6-28 2-52 6-84zM110 78c10 48 6 86-12 92-6-28-2-52-6-84z" fill="${color}"/>`;
    case "waves":
      return `<path d="M48 80c-8 40 2 64 10 80 8-22 2-42 8-72zM112 80c8 40-2 64-10 80-8-22-2-42-8-72z" fill="${color}"/>`;
    default:
      return "";
  }
}

function hairFront(spec: PortraitSpec): string {
  const color = spec.hair;
  switch (spec.hairStyle) {
    case "short":
      return `<path d="M48 84c8-38 56-38 64 0-8 10-20 2-32 2s-24 8-32-2z" fill="${color}"/>`;
    case "bob":
      return `<path d="M50 82c8-32 52-32 60 0-6 8-54 8-60 0z" fill="${color}"/>`;
    case "bun":
      return `<path d="M52 78c10-28 46-28 56 0-8 6-48 6-56 0z" fill="${color}"/>`;
    case "curly":
      return `<path d="M54 76c8-20 44-20 52 0-10 4-42 4-52 0z" fill="${color}"/>`;
    case "buzz":
      return `<path d="M54 80c8-22 44-22 52 0-8 4-44 4-52 0z" fill="${color}"/>`;
    case "long":
    case "waves":
      return `<path d="M52 80c10-30 46-30 56 0-8 8-48 8-56 0z" fill="${color}"/>`;
    case "pixie":
      return `<path d="M50 86c6-36 64-30 66 4-18 2-30-10-42-6-8 6-20 8-24 2z" fill="${color}"/>`;
    default:
      return "";
  }
}

function sceneBackground(scene: SceneName): string {
  if (scene === "kitchen") {
    return `<rect width="320" height="180" fill="#F4E7D4"/>
      <rect width="320" height="46" fill="#8D5A3A"/>
      <rect y="46" width="320" height="8" fill="#E7D3A1"/>
      <rect x="18" y="10" width="36" height="24" rx="2" fill="#C9D7E6"/>
      <rect y="128" width="320" height="52" fill="#C7A27A"/>`;
  }
  if (scene === "street") {
    return `<rect width="320" height="180" fill="#CFE3F2"/>
      <rect x="16" y="36" width="48" height="92" fill="#D9D3CB"/>
      <rect x="72" y="52" width="40" height="76" fill="#C3BEB6"/>
      <rect y="124" width="320" height="56" fill="#4E555C"/>
      <rect y="148" width="320" height="6" fill="#E6C56A"/>`;
  }
  return `<rect width="320" height="180" fill="#E7ECF1"/>
    <rect x="24" y="28" width="70" height="46" rx="2" fill="#2C333A"/>
    <rect x="30" y="34" width="58" height="34" fill="#B9D6EA"/>
    <rect y="124" width="320" height="56" fill="#8B6A45"/>`;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r + g + b) / 3;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
