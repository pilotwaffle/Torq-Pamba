export const DEMO_COMPANY = "Northwind Cold Brew";

export const DEMO_DESCRIPTION =
  "Northwind Cold Brew cans smooth, low-acid coffee for busy days. Friendly bottles for commuters and remote workers.";

export const DEMO_OG_DESCRIPTION =
  "Smooth cold brew from Northwind, made for people on the move.";

export const DEMO_WHAT_THEY_DO =
  "We brew smooth cold coffee and can it so your morning stays easy. We are glad you are here. Grab a bottle, enjoy the first sip, and head into a day that feels welcome.";

export const DEMO_PRODUCTS = [
  "Oat-milk cold brew",
  "Classic black cold brew",
  "Vanilla draft latte",
] as const;

export const DEMO_AUDIENCE = "Made for busy commuters and remote workers";

export function ogMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">
  <title>Northwind Cold Brew</title>
  <rect width="64" height="64" rx="12" fill="#1C1410"/>
  <rect x="18" y="28" width="22" height="16" rx="3" fill="#F3E6D0"/>
  <path d="M40 32h5a5 5 0 0 1 0 10h-5" fill="none" stroke="#C4A574" stroke-width="2"/>
  <path d="M24 24c.6 2 .6 2 0 4M29 22c.6 2 .6 2 0 4M34 24c.6 2 .6 2 0 4" fill="none" stroke="#C4A574" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;
}

export function canSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 96" role="img">
  <title>Oat-milk cold brew can</title>
  <rect x="14" y="8" width="36" height="80" rx="8" fill="#1C1410"/>
  <rect x="14" y="28" width="36" height="22" fill="#C4A574"/>
  <text x="32" y="43" text-anchor="middle" font-size="8" font-family="sans-serif" fill="#1C1410">NW</text>
  <rect x="18" y="6" width="28" height="6" rx="2" fill="#8A8175"/>
</svg>`;
}

/** HTML document mirroring the /demo-site page, for the offline extractor. */
export function demoSiteHtml(pageUrl = "http://localhost:3000/demo-site"): string {
  const origin = new URL(pageUrl).origin;
  const products = DEMO_PRODUCTS.map((product) => `    <li>${product}</li>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${DEMO_COMPANY}</title>
  <meta name="description" content="${DEMO_DESCRIPTION}">
  <meta property="og:title" content="${DEMO_COMPANY}">
  <meta property="og:description" content="${DEMO_OG_DESCRIPTION}">
  <meta property="og:site_name" content="${DEMO_COMPANY}">
  <meta property="og:image" content="${origin}/demo-site/og.svg">
</head>
<body>
  <header>
    <img src="/demo-site/og.svg" alt="Northwind Cold Brew logo" width="48" height="48">
    <p>Cold brew, canned for the commute</p>
  </header>
  <main>
    <h1>${DEMO_COMPANY}</h1>
    <p>Smooth coffee that waits in the fridge, not in a line.</p>
    <h2>What we do</h2>
    <p>${DEMO_WHAT_THEY_DO}</p>
    <h2>Products</h2>
    <ul>
${products}
    </ul>
    <p>${DEMO_AUDIENCE}</p>
    <img src="/demo-site/can.svg" alt="Oat-milk cold brew can" width="72" height="112">
  </main>
</body>
</html>`;
}
