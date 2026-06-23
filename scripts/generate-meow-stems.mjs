#!/usr/bin/env node
/**
 * Slice the legacy `meow.wav` into 4 short staccato stems for the
 * MEOW_STEM_CATALOG. Same source pitch, different time windows — gives
 * the per-lane pool variety even before real diverse meows are
 * recorded.
 *
 * Run with:  node scripts/generate-meow-stems.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEOW_DIR = join(__dirname, '..', 'public', 'assets', 'audio', 'meows');
const SOURCE = join(MEOW_DIR, 'meow.wav');

// PCM WAV header layout (44 bytes for canonical PCM):
//  0-3  "RIFF"
//  4-7  file size - 8
//  8-11 "WAVE"
// 12-15 "fmt "
// 16-19 16 (fmt chunk size)
// 20-21 1  (PCM)
// 22-23 num channels
// 24-27 sample rate
// 28-31 byte rate
// 32-33 block align
// 34-35 bits per sample
// 36-39 "data"
// 40-43 data size
// 44+   PCM samples

function readWav(path) {
  const buf = readFileSync(path);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataSize = buf.readUInt32LE(40);
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const samples = buf.subarray(44, 44 + dataSize);
  return { numChannels, sampleRate, bitsPerSample, blockAlign, samples };
}

function writeWav(path, { numChannels, sampleRate, bitsPerSample }, samples) {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  writeFileSync(path, Buffer.concat([header, samples]));
}

/** Apply a short linear fade-in (1ms) + fade-out (12ms) to a 16-bit PCM
 *  buffer in place. Stops the chopped-segment clicks that pop on hard
 *  start/end boundaries. */
function applyFades(samples, sampleRate, blockAlign, fadeInMs, fadeOutMs) {
  const fadeInBytes = Math.floor((sampleRate * fadeInMs / 1000)) * blockAlign;
  const fadeOutBytes = Math.floor((sampleRate * fadeOutMs / 1000)) * blockAlign;
  const numFrames = samples.length / blockAlign;
  const fadeInFrames = fadeInBytes / blockAlign;
  const fadeOutFrames = fadeOutBytes / blockAlign;

  for (let i = 0; i < numFrames; i++) {
    let gain = 1;
    if (i < fadeInFrames) gain = i / fadeInFrames;
    else if (i >= numFrames - fadeOutFrames) {
      gain = (numFrames - 1 - i) / fadeOutFrames;
    }
    if (gain === 1) continue;
    for (let ch = 0; ch < blockAlign / 2; ch++) {
      const idx = i * blockAlign + ch * 2;
      const sample = samples.readInt16LE(idx);
      samples.writeInt16LE(Math.round(sample * gain), idx);
    }
  }
}

const src = readWav(SOURCE);
const { sampleRate, blockAlign } = src;
const msToBytes = (ms) => Math.floor((sampleRate * ms / 1000)) * blockAlign;

const slices = [
  // id           start (ms)  end (ms)   — purpose
  ['cute-01',          0,        280],   // attack + first body chunk — bright opener
  ['chirp-01',         0,        140],   // just the attack — sharp short stab
  ['sass-01',         70,        380],   // body section, skips the lead onset
  ['purr-01',         50,        500],   // longer body + tail for the alternate
];

for (const [id, startMs, endMs] of slices) {
  const start = Math.min(msToBytes(startMs), src.samples.length);
  const end = Math.min(msToBytes(endMs), src.samples.length);
  const slice = Buffer.from(src.samples.subarray(start, end)); // copy so fades don't mutate src
  applyFades(slice, sampleRate, blockAlign, 1, 12);
  const outPath = join(MEOW_DIR, `${id}.wav`);
  writeWav(outPath, src, slice);
  console.log(`wrote ${id}.wav  (${endMs - startMs}ms)`);
}
