/**
 * summary-coins driver — serves the built harness and screenshots the
 * summary panel's coin-reward line in each valve state:
 *   normal      — plain "+N COINS" (green)
 *   decay       — "+N COINS · REPLAY ×0.5" (amber)
 *   budget      — "+N COINS · REDUCED (DAILY LIMIT)" (amber)
 *   decay+budget— both chips
 *   ownshow     — "YOUR OWN SHOW · NO COINS" (grey)
 *   none        — no breakdown (line hidden)
 *
 * Build first:  npx vite build --config vite.config.mjs
 * Then:         node shoot.mjs
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve(import.meta.dirname, 'dist');
const outDir = path.resolve(import.meta.dirname, 'out');
await mkdir(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(path.join(dist, url));
    res.writeHead(200, { 'content-type': MIME[path.extname(url)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const base = {
  tier: 'perfect',
  tierBase: 300,
  skillBonus: 100,
  fullCombo: false,
  fullPerfect: false,
  multiplier: 1.25,
  decayRate: 1,
  budgetReduced: false,
  ownShow: false,
  final: 500,
};

const STATES = {
  normal: { ...base, final: 500 },
  decay: { ...base, decayRate: 0.5, final: 250 },
  budget: { ...base, budgetReduced: true, final: 110 },
  'decay-budget': { ...base, decayRate: 0.25, budgetReduced: true, final: 62 },
  ownshow: { ...base, ownShow: true, final: 0 },
  none: null,
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', String(e)));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));

const canvas = page.locator('canvas');
for (const [name, breakdown] of Object.entries(STATES)) {
  await page.evaluate((b) => window.__setBreakdown(b), breakdown);
  await new Promise((r) => setTimeout(r, 150));
  await canvas.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`shot ${name}.png`);
}

await browser.close();
server.close();
console.log('done');
