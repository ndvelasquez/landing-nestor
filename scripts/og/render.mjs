// Renders the OG image for /work/zendesk-workflow-repair (1200x630) and a
// 375 px-wide downscale for the OB-09 check.
// Usage: PLAYWRIGHT=<path to playwright/index.mjs> node scripts/og/render.mjs [check-dir]
// Playwright is not a dependency of this repo; on Nestor's machine it lives in
// C:/Proyectos_IA/career-ops/node_modules/playwright/index.mjs (the default).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pw = process.env.PLAYWRIGHT || 'C:/Proyectos_IA/career-ops/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const here = dirname(fileURLToPath(import.meta.url));
const html = resolve(here, 'zendesk-workflow-repair.html');
const out = resolve(here, '../../public/work/og-zendesk-workflow-repair.png');
const checkDir = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
console.log('wrote', out);

// Smallest rendered text on the canvas, and what it becomes at 375 px wide.
const min = await page.evaluate(() => {
  let m = Infinity;
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    m = Math.min(m, parseFloat(getComputedStyle(el).fontSize));
  }
  return m;
});
console.log(`smallest text: ${min.toFixed(1)} px on 1200 -> ${(min * 375 / 1200).toFixed(1)} px at 375`);

if (checkDir) {
  const small = await browser.newPage({ viewport: { width: 375, height: 197 } });
  await small.setContent(`<body style="margin:0"><img src="data:image/png;base64,${(await import('node:fs')).readFileSync(out).toString('base64')}" style="width:375px;display:block"></body>`);
  const p = resolve(checkDir, 'og-zendesk-workflow-repair-375.png');
  await small.screenshot({ path: p });
  console.log('wrote', p);
}
await browser.close();
