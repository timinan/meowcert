/**
 * fx-scan measure — renders each generated effect and reports its pixel
 * bounding box, sorted by footprint, so oversized effects are identified
 * empirically. Sprite sits at (240,320) scale 1.4 (~90px wide).
 * Lane budget (80px design pitch, 1.4 stage scale): ~±63px from center.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve(import.meta.dirname, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try { const b = await readFile(path.join(dist, url)); res.writeHead(200, {'content-type': MIME[path.extname(url)] ?? 'application/octet-stream'}); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => window.__scan.baseline());
const ids = await page.evaluate(() => window.__scan.ids());

const CX = 240;
const results = [];
for (const id of ids) {
  const err = await page.evaluate((i) => window.__scan.start(i), id);
  if (err) { await page.evaluate(() => window.__scan.stop()); continue; }
  // sample bbox over ~1s so pulsing/spawning effects reach full extent
  let agg = null;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const b = await page.evaluate(() => window.__scan.bbox());
    if (!b) continue;
    if (!agg) agg = b;
    else {
      agg.minX = Math.min(agg.minX, b.minX); agg.maxX = Math.max(agg.maxX, b.maxX);
      agg.minY = Math.min(agg.minY, b.minY); agg.maxY = Math.max(agg.maxY, b.maxY);
    }
  }
  await page.evaluate(() => window.__scan.stop());
  if (!agg) continue;
  const halfW = Math.max(CX - agg.minX, agg.maxX - CX);
  results.push({ id, halfW, w: agg.maxX - agg.minX + 1, h: agg.maxY - agg.minY + 1 });
}
results.sort((a, b) => b.halfW - a.halfW);
console.log('id  halfWidthFromCatCenter  totalW  totalH  (lane budget halfW ~63px)');
for (const r of results.filter((r) => r.halfW > 70)) {
  console.log(`${r.id}  ${r.halfW}  ${r.w}x${r.h}`);
}
console.log(`\n${results.filter((r) => r.halfW > 70).length} effects exceed halfW 70px of ${results.length} measured`);
await browser.close();
server.close();
