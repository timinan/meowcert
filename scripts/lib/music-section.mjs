/**
 * Shared audio-analysis + reclip helpers used by both the calibrator
 * server (tools/server.mjs) and the backdate batch script
 * (scripts/audio/backdate-music-sections.mjs). Kept in /lib so the two
 * call sites never drift apart on RMS sampling rate, scoring function,
 * or ffmpeg argument list.
 *
 * Public API:
 *   probeDurationSeconds(srcPath) → Promise<number>
 *   extractRmsBins(srcPath)        → Promise<number[]>
 *   findBestSectionStart(bins, durationS) → { bestStart, score }
 *   reclipFromSource(srcPath, outPath, startS, durS) → Promise<void>
 *
 *   CLIP_DURATION_S   = 65
 *   WAVEFORM_BIN_MS   = 100
 *   ANALYZE_INTRO_S   = 8   // first N seconds of window = "calm" baseline
 */

import { spawn } from 'node:child_process';

export const CLIP_DURATION_S = 65;
export const WAVEFORM_BIN_MS = 100;
export const ANALYZE_INTRO_S = 8;

export function probeDurationSeconds(srcPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', srcPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    ff.stdout.on('data', (b) => { stdout += b.toString(); });
    ff.stderr.on('data', (b) => { stderr += b.toString(); });
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${stderr.trim()}`));
      const d = parseFloat(stdout.trim());
      if (!Number.isFinite(d) || d <= 0) return reject(new Error(`ffprobe bad duration: "${stdout}"`));
      resolve(d);
    });
  });
}

export function extractRmsBins(srcPath) {
  return new Promise((resolve, reject) => {
    const reset = (WAVEFORM_BIN_MS / 1000).toFixed(3);
    const af = `astats=metadata=1:reset=${reset}:length=${reset},ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`;
    const ff = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', srcPath, '-af', af, '-f', 'null', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    ff.stdout.on('data', (b) => { stdout += b.toString(); });
    ff.stderr.on('data', (b) => { stderr += b.toString(); });
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg astats exit ${code}: ${stderr.trim()}`));
      const bins = [];
      for (const line of stdout.split('\n')) {
        const m = line.match(/^lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf|nan)$/);
        if (!m) continue;
        let v = m[1] === '-inf' || m[1] === 'nan' ? -60 : parseFloat(m[1]);
        if (!Number.isFinite(v)) v = -60;
        bins.push(Math.max(-60, v));
      }
      resolve(bins);
    });
  });
}

export function findBestSectionStart(bins, durationS) {
  const binsPerSec = 1000 / WAVEFORM_BIN_MS;
  const windowBins = Math.floor(CLIP_DURATION_S * binsPerSec);
  const introBins = Math.floor(ANALYZE_INTRO_S * binsPerSec);
  if (durationS < CLIP_DURATION_S || bins.length <= windowBins) {
    return { bestStart: 0, score: 0 };
  }
  let bestStart = 0;
  let bestScore = -Infinity;
  for (let start = 0; start + windowBins < bins.length; start += Math.floor(binsPerSec)) {
    let preSum = 0;
    let mainSum = 0;
    for (let k = 0; k < introBins; k++) preSum += bins[start + k];
    for (let k = introBins; k < windowBins; k++) mainSum += bins[start + k];
    const preAvg = preSum / introBins;
    const mainAvg = mainSum / (windowBins - introBins);
    const score = mainAvg + 1.0 * (mainAvg - preAvg);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start / binsPerSec;
    }
  }
  return { bestStart, score: bestScore };
}

export function reclipFromSource(srcPath, outPath, startS, durS) {
  return new Promise((resolve, reject) => {
    const fadeIn = 0.35;
    const fadeOut = 1.5;
    const fadeOutStart = (durS - fadeOut).toFixed(3);
    const af = [
      `atrim=${startS.toFixed(3)}:${(startS + durS).toFixed(3)}`,
      `asetpts=PTS-STARTPTS`,
      `afade=t=in:st=0:d=${fadeIn.toFixed(3)}`,
      `afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(3)}`,
    ].join(',');
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', srcPath,
        '-af', af,
        '-ac', '1',
        '-ar', '44100',
        '-b:a', '96k',
        outPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    ff.stderr.on('data', (b) => { stderr += b.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg reclip exit ${code}: ${stderr.trim()}`));
    });
  });
}

/** Filename → catalog slug. Mirrors the slugify in tools/music/calibrator.html
 *  so a file `Daft Punk - One More Time.mp3` becomes `daft-punk-one-more-time`. */
export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'song';
}
