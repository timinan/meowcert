/**
 * Handcrafted tutorial chart — used by Game scene in tutorial mode
 * (when `init.tutorialStep === 'play-tutorial'`).
 *
 * SKELETON ONLY for Phase 2. Real content lands in Phase 8 per spec §7.
 *
 * Sequence (filled in Phase 8):
 *   1-4   intro    — 4 single taps middle lane
 *   5-8   outer    — taps on lanes 0 and 2 (teach spatial mapping)
 *   9-12  chord    — 2/3-lane simultaneous taps
 *   13-16 hold     — hold middle lane, hold lane 0
 *   17-20 slide1   — 1-lane slides (0→1, 2→1)
 *   21-24 slide2   — 2-lane jumps (0→2, 2→0)
 *   25-28 sndr     — slide-and-return (◀▶)
 *   29-44 insane   — real chart fragment at insane density (~3s)
 *
 * Pacing: BPM 70, beatsPerStep 1 — slow, plenty of read time.
 *
 * TUTORIAL_CHART_BEATS maps each handcrafted section (start..end step
 * index) to the corresponding dialogue index in
 * TUTORIAL_DIALOGUE['play-tutorial']. The Game scene's guided mode
 * pauses ChartPlayer between sections, shows the dialogue line, and
 * resumes on Continue.
 */

import type { Chart } from './state';

const CHART_STEP_COUNT_PLACEHOLDER = 8;
// Phase 8 will bump this to 48 (≈ 41s at 70 BPM × 1 beat/step) so the
// chart covers all 7 handcrafted sections + the insane fragment +
// breathing room. CHART_PAGE_SIZE = 8 so the count needs to stay a
// positive multiple of 8.

export const TUTORIAL_CHART: Chart = {
  authorId: '_tutorial',
  title: 'Tutorial — Whiskers shows you the ropes',
  stepCount: CHART_STEP_COUNT_PLACEHOLDER,
  bpm: 70,
  steps: Array.from({ length: CHART_STEP_COUNT_PLACEHOLDER }, () => ({ lanes: [] })),
  holds: [],
  slides: [],
  slideReturns: [],
  updatedAt: 0,
};

/** Maps a chart-section step-range to the dialogue index in
 *  TUTORIAL_DIALOGUE['play-tutorial']. The Game scene's guided mode
 *  pauses the ChartPlayer when the current beat enters one of these
 *  ranges, displays the corresponding dialogue line, and resumes on
 *  Continue.
 *
 *  Empty for Phase 2 skeleton — populated in Phase 8 alongside the
 *  filled-in chart steps.
 */
export const TUTORIAL_CHART_BEATS: ReadonlyArray<{
  /** Inclusive lower bound — when current step >= startStep, pause. */
  startStep: number;
  /** Inclusive upper bound for the section. */
  endStep: number;
  /** Index into TUTORIAL_DIALOGUE['play-tutorial'] (0..9). */
  dialogueIndex: number;
}> = [];
