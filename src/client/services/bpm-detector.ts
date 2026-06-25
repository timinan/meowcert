/**
 * Client-side BPM detection for the custom-song rehearsal flow.
 *
 * Approach: decode the file via Web Audio, take the 60 s window the
 * player picked (the bit they'll actually rehearse), downsample it to
 * an energy envelope, then autocorrelate the envelope at lag values
 * corresponding to the BPM band we care about. The autocorrelation peak
 * is the dominant beat period. Doubling/halving folds half-time and
 * double-time detections into the band so 60-BPM lo-fi reads as 120
 * and 240-BPM gabber reads as 120 — close enough for chart generation,
 * which only uses BPM to lay down a step grid.
 *
 * Why not a library: avoids a Devvit bundling unknown for ~80 lines
 * of native Web Audio code that's specific to our (limited) needs.
 */

const ENVELOPE_RATE_HZ = 200; // 5 ms-per-sample envelope
const BPM_MIN = 80;
const BPM_MAX = 160;
const ANALYZE_DURATION_S = 60;

/** Decode the file, take the chosen 60 s slice, return the detected
 *  BPM clamped into [BPM_MIN, BPM_MAX]. Throws if decode fails. */
export async function detectBpm(blob: Blob, startSec: number): Promise<number> {
  const buffer = await blob.arrayBuffer();
  // Safari requires `webkitAudioContext` — type union covers both.
  const Ctor: typeof AudioContext =
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext;
  const ctx = new Ctor();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buffer);
  } finally {
    void ctx.close();
  }

  const sampleRate = audio.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(audio.length, startSample + Math.floor(ANALYZE_DURATION_S * sampleRate));
  const sliceLen = endSample - startSample;
  if (sliceLen <= sampleRate) {
    // Less than 1 s of usable audio — fall back to mid-range default
    // rather than throwing into the user's face.
    return 120;
  }

  // Downmix to mono in the slice window.
  const ch0 = audio.getChannelData(0);
  const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch0;
  const mono = new Float32Array(sliceLen);
  for (let i = 0; i < sliceLen; i++) {
    mono[i] = (ch0[startSample + i]! + ch1[startSample + i]!) * 0.5;
  }

  // Build an energy envelope at ENVELOPE_RATE_HZ. Each envelope sample
  // is the rectified mean over its window. Energy-domain (not RMS) is
  // fine here since we only care about the autocorrelation shape, not
  // absolute loudness.
  const windowLen = Math.max(1, Math.floor(sampleRate / ENVELOPE_RATE_HZ));
  const envLen = Math.floor(sliceLen / windowLen);
  const env = new Float32Array(envLen);
  for (let i = 0; i < envLen; i++) {
    let sum = 0;
    const base = i * windowLen;
    for (let j = 0; j < windowLen; j++) sum += Math.abs(mono[base + j]!);
    env[i] = sum / windowLen;
  }

  // Bias toward beat onsets: keep only positive first-differences (the
  // "rising edges" of the envelope). This sharpens kick / snare hits
  // and dampens sustained pads, which autocorrelates much cleaner.
  const onsets = new Float32Array(envLen);
  for (let i = 1; i < envLen; i++) {
    const d = env[i]! - env[i - 1]!;
    onsets[i] = d > 0 ? d : 0;
  }

  // Autocorrelate onset signal at lags within the BPM band. Lag in
  // envelope samples = ENVELOPE_RATE_HZ * 60 / BPM.
  const minLag = Math.floor((60 / BPM_MAX) * ENVELOPE_RATE_HZ);
  const maxLag = Math.ceil((60 / BPM_MIN) * ENVELOPE_RATE_HZ);
  let bestLag = minLag;
  let bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    const limit = envLen - lag;
    for (let i = 0; i < limit; i++) c += onsets[i]! * onsets[i + lag]!;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  const rawBpm = (60 * ENVELOPE_RATE_HZ) / bestLag;
  return foldIntoBand(rawBpm);
}

/** Fold raw BPM into the [BPM_MIN, BPM_MAX] band by halving / doubling.
 *  60 BPM lo-fi reads as 120; 240 BPM gabber reads as 120. */
function foldIntoBand(raw: number): number {
  let bpm = raw;
  while (bpm < BPM_MIN) bpm *= 2;
  while (bpm > BPM_MAX) bpm /= 2;
  return Math.round(bpm);
}
