/**
 * capture-flipbooks — renders every generated effect through the REAL
 * Phaser interpreter on the REAL cat sprite (stage scale 1.4) and captures
 * an 8-frame flipbook per effect, plus a catalog manifest, into
 * tools/effects-game/. The review page animates the frames client-side,
 * so what Tim reviews is pixel-identical to the game renderer.
 *
 * Build first: npx vite build --config vite.config.mjs
 * Then: node capture-flipbooks.mjs
 */
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const here = import.meta.dirname;
const repoRoot = path.resolve(here, '../../..');
const dist = path.resolve(here, 'dist');
// Snapshot copy of the game atlas — dist/client/assets churns mid-run.
const gameAssets = path.resolve(here, '../dressing-room/assets-snapshot');
const outRoot = path.resolve(repoRoot, 'tools/effects-game');
const framesDir = path.join(outRoot, 'frames');
await mkdir(framesDir, { recursive: true });

const FRAMES = 8;
const FRAME_GAP_MS = 170;
// Crop around the cat at (240,320): wide enough for the ±63px lane budget
// plus stagelight/lightning verticals.
const CLIP = { x: 118, y: 88, width: 244, height: 330 };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const candidates = [path.join(dist, url)];
  if (url.startsWith('/assets/')) candidates.push(path.join(gameAssets, url.slice('/assets/'.length)));
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
      return;
    } catch { /* next */ }
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));

const metas = await page.evaluate(() =>
  window.__scan.ids().map((id) => {
    return { id };
  }),
);
// Pull full catalog metadata (name/category/rarity) from the page bundle.
const catalog = await page.evaluate(() => window.__catalog ?? null);
if (!catalog) {
  console.error('page did not expose __catalog — rebuild the harness');
  process.exit(1);
}

console.log(`capturing ${metas.length} effects × ${FRAMES} frames`);
let done = 0;
for (const { id } of metas) {
  const err = await page.evaluate((i) => window.__scan.start(i), id);
  if (err) {
    console.log(`SKIP ${id}: ${err}`);
    continue;
  }
  // Let spawning effects (pulses, weather) reach steady state.
  await new Promise((r) => setTimeout(r, 500));
  for (let f = 0; f < FRAMES; f++) {
    await page.screenshot({
      path: path.join(framesDir, `${id}_${f}.jpg`),
      type: 'jpeg',
      quality: 72,
      clip: CLIP,
    });
    await new Promise((r) => setTimeout(r, FRAME_GAP_MS));
  }
  await page.evaluate(() => window.__scan.stop());
  done++;
  if (done % 50 === 0) console.log(`${done}/${metas.length}`);
}

await writeFile(
  path.join(outRoot, 'catalog.json'),
  JSON.stringify({ frames: FRAMES, frameGapMs: FRAME_GAP_MS, effects: catalog }, null, 1),
);
console.log(`done: ${done} effects captured → ${framesDir}`);
await browser.close();
server.close();
