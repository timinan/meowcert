#!/usr/bin/env node
/**
 * Backdate music sections — runs the new chorus-detection + reclip
 * pipeline against original mp3s for tracks that were uploaded BEFORE
 * 2026-06-25 (when the calibrator started preserving sources).
 *
 * Usage:
 *   node scripts/audio/backdate-music-sections.mjs [--from <dir>] [--dry] [--force]
 *
 *   --from <dir>   Directory holding original mp3s. Default:
 *                  tools/music/sources-pending/
 *   --dry          Print what would happen, don't write anything.
 *   --force        Re-process tracks that ALREADY have a preserved
 *                  source (default skips them since they're "current").
 *
 * For each .mp3 in the input dir:
 *   1. Slugify the filename (matches calibrator upload behavior)
 *   2. If the slug exists in music.json → process it
 *      - Copy the source to tools/music/sources/<slug>.src
 *      - Run analyze (probeDuration + extractRmsBins + findBestSectionStart)
 *      - Reclip to public/assets/audio/backings/<slug>.mp3 with the
 *        auto-detected best 65 s section
 *      - Re-extract tap samples
 *      - Patch music.json: clipStartS + loopDurationMs
 *   3. If the slug doesn't exist → log + skip (don't auto-add; that's
 *      the calibrator's job and it does the genre/mood guessing too)
 *
 * Tracks in music.json with NO matching source file in the input dir
 * are listed at the end so Tim knows what still needs the original.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  probeDurationSeconds,
  extractRmsBins,
  findBestSectionStart,
  reclipFromSource,
  slugify,
  CLIP_DURATION_S,
} from '../lib/music-section.mjs';
import { extractTapsForSong } from '../lib/extract-taps-for-song.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MUSIC_JSON_PATH = path.join(PROJECT_ROOT, 'tools', 'music', 'music.json');
const MUSIC_SOURCES_DIR = path.join(PROJECT_ROOT, 'tools', 'music', 'sources');
const MUSIC_BACKINGS_DIR = path.join(PROJECT_ROOT, 'public', 'assets', 'audio', 'backings');
const TAPS_DIR = path.join(PROJECT_ROOT, 'public', 'assets', 'audio', 'taps');
const DEFAULT_INPUT_DIR = path.join(PROJECT_ROOT, 'tools', 'music', 'sources-pending');

// CLI args
const args = process.argv.slice(2);
let inputDir = DEFAULT_INPUT_DIR;
let dryRun = false;
let force = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') {
    inputDir = path.resolve(args[++i]);
  } else if (args[i] === '--dry') {
    dryRun = true;
  } else if (args[i] === '--force') {
    force = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`usage: backdate-music-sections.mjs [--from <dir>] [--dry] [--force]\n  default dir: ${DEFAULT_INPUT_DIR}`);
    process.exit(0);
  }
}

console.log(`[backdate] input dir:  ${inputDir}`);
console.log(`[backdate] dry-run:    ${dryRun ? 'YES' : 'no'}`);
console.log(`[backdate] force:      ${force ? 'YES (will re-process tracks with existing sources)' : 'no (skips tracks that already have sources)'}`);
console.log('');

let catalog = {};
try {
  catalog = JSON.parse(await fs.readFile(MUSIC_JSON_PATH, 'utf8'));
} catch (e) {
  console.error(`[backdate] FATAL — couldn't read music.json: ${e.message}`);
  process.exit(1);
}

let inputFiles = [];
try {
  const entries = await fs.readdir(inputDir);
  inputFiles = entries.filter((f) => /\.mp3$/i.test(f));
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error(`[backdate] FATAL — input dir missing: ${inputDir}`);
    console.error(`[backdate] drop original mp3s in there and re-run, or pass --from <other-dir>`);
    process.exit(1);
  }
  throw e;
}

if (inputFiles.length === 0) {
  console.error(`[backdate] no .mp3 files in ${inputDir}`);
  process.exit(1);
}

console.log(`[backdate] found ${inputFiles.length} source mp3(s) in input dir`);
console.log('');

await fs.mkdir(MUSIC_SOURCES_DIR, { recursive: true });

const processed = [];
const noCatalogMatch = [];
const skippedExisting = [];
const failed = [];

for (const filename of inputFiles) {
  const baseName = filename.replace(/\.mp3$/i, '');
  const slug = slugify(baseName);
  if (!catalog[slug]) {
    noCatalogMatch.push({ filename, slug });
    continue;
  }
  const srcPath = path.join(MUSIC_SOURCES_DIR, `${slug}.src`);
  const alreadyHasSource = await fs.access(srcPath).then(() => true).catch(() => false);
  if (alreadyHasSource && !force) {
    skippedExisting.push({ filename, slug });
    continue;
  }
  console.log(`[backdate] processing "${catalog[slug].displayName || slug}" (slug: ${slug})`);
  try {
    const inputPath = path.join(inputDir, filename);
    if (!dryRun) {
      await fs.copyFile(inputPath, srcPath);
    }
    const duration = await probeDurationSeconds(inputPath);
    const bins = await extractRmsBins(inputPath);
    const { bestStart } = findBestSectionStart(bins, duration);
    console.log(`  duration: ${duration.toFixed(1)}s · bestStart: ${bestStart.toFixed(2)}s · windowing ${CLIP_DURATION_S}s`);
    if (dryRun) {
      console.log(`  [dry] would reclip → ${path.join(MUSIC_BACKINGS_DIR, `${slug}.mp3`)}`);
      processed.push({ slug, displayName: catalog[slug].displayName, bestStart, duration });
      continue;
    }
    const outPath = path.join(MUSIC_BACKINGS_DIR, `${slug}.mp3`);
    await reclipFromSource(srcPath, outPath, bestStart, CLIP_DURATION_S);
    const bytes = (await fs.stat(outPath)).size;
    // Patch catalog entry
    catalog[slug].clipStartS = bestStart;
    catalog[slug].loopDurationMs = CLIP_DURATION_S * 1000;
    // Re-extract tap samples — they're sliced from the clip so they
    // need to follow the new section.
    try {
      await extractTapsForSong(outPath, TAPS_DIR, slug);
    } catch (tapsErr) {
      console.warn(`  ⚠️  tap-extract failed: ${tapsErr.message}`);
    }
    console.log(`  ✓ reclipped → ${bytes} bytes`);
    processed.push({ slug, displayName: catalog[slug].displayName, bestStart, duration });
  } catch (e) {
    console.error(`  ✗ FAILED: ${e.message}`);
    failed.push({ slug, error: e.message });
  }
}

// Persist catalog changes
if (processed.length > 0 && !dryRun) {
  await fs.writeFile(MUSIC_JSON_PATH, JSON.stringify(catalog, null, 2) + '\n');
  console.log('');
  console.log(`[backdate] music.json updated with new clipStartS + loopDurationMs for ${processed.length} track(s)`);
}

console.log('');
console.log('================ SUMMARY ================');
console.log(`processed:           ${processed.length}`);
console.log(`skipped (existing):  ${skippedExisting.length} (use --force to re-process)`);
console.log(`no catalog match:    ${noCatalogMatch.length}`);
console.log(`failed:              ${failed.length}`);
console.log('');

if (noCatalogMatch.length > 0) {
  console.log('⚠️  No catalog match for these files (rename or upload via calibrator first):');
  for (const m of noCatalogMatch) {
    console.log(`   ${m.filename} → would-be slug "${m.slug}" not in music.json`);
  }
  console.log('');
}

// Show catalog entries that still have no source = need original from Tim
const catalogSlugs = Object.keys(catalog);
const sourcesNow = new Set(
  (await fs.readdir(MUSIC_SOURCES_DIR).catch(() => []))
    .filter((f) => f.endsWith('.src'))
    .map((f) => f.replace(/\.src$/, '')),
);
const stillMissing = catalogSlugs.filter((s) => !sourcesNow.has(s));
if (stillMissing.length > 0) {
  console.log(`📂  Catalog entries STILL missing a source (drop the original mp3s in ${inputDir} and re-run):`);
  for (const slug of stillMissing) {
    console.log(`   - ${slug}  ("${catalog[slug].displayName || slug}")`);
  }
}

if (failed.length > 0) {
  console.log('');
  console.log('❌  FAILURES:');
  for (const f of failed) {
    console.log(`   ${f.slug}: ${f.error}`);
  }
  process.exit(1);
}

if (!dryRun && processed.length > 0) {
  console.log('');
  console.log('💡  Next: run `npm run sync:catalog` so the generated music-catalog.generated.ts picks up the new clipStartS values.');
}
