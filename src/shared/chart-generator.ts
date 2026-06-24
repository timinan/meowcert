import {
  CHART_PAGE_SIZE,
  type Chart,
  type ChartStep,
  type LaneId,
  type BackingVibe,
} from './state';

export type GenDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Per-difficulty knobs for the procedural chart generator. Tuned by feel
 * against the 130bpm catalog — playable in test mode without dragging in
 * a real designer-curated template library yet.
 *
 *   density       — fraction of steps that fire at least one note
 *   chord2Chance  — given a firing step, fraction that fire on 2 lanes
 *   chord3Chance  — given a firing step, fraction that fire on all 3
 *   minGapSteps   — minimum empty steps between any two firing steps
 *                   (prevents accidental triplet bursts on easy)
 */
const PROFILES: Record<GenDifficulty, {
  density: number;
  chord2Chance: number;
  chord3Chance: number;
  minGapSteps: number;
}> = {
  easy:   { density: 0.30, chord2Chance: 0.00, chord3Chance: 0.00, minGapSteps: 2 },
  medium: { density: 0.45, chord2Chance: 0.18, chord3Chance: 0.00, minGapSteps: 1 },
  hard:   { density: 0.65, chord2Chance: 0.32, chord3Chance: 0.06, minGapSteps: 0 },
};

/** Round a target step count UP to the nearest multiple of CHART_PAGE_SIZE.
 *  validateChart insists on this, and the editor pages over CHART_PAGE_SIZE
 *  chunks, so any leftover steps would break both. */
function roundUpToPage(steps: number): number {
  return Math.ceil(steps / CHART_PAGE_SIZE) * CHART_PAGE_SIZE;
}

/** Step count needed for the chart to span at least `targetMs` at `bpm`.
 *  Matches the formula in ChartPlayer (msPerStep = 60000 / (bpm * 2),
 *  i.e. 8 eighth-notes per bar). Rounded up to a clean page boundary. */
export function stepsForDuration(bpm: number, targetMs: number): number {
  const msPerStep = 60_000 / (bpm * 2);
  return roundUpToPage(Math.ceil(targetMs / msPerStep));
}

/** Tiny PRNG so two calls with the same inputs produce different feel
 *  while still being deterministic within one call. Plenty random for a
 *  rhythm generator; never use for security. */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Generate a playable chart that fills at least `targetDurationMs` at
 * the selected BPM. The chart is fully populated — no empty pages — so
 * the round never silently starves the player of notes.
 *
 * The algorithm walks one step at a time, deciding whether to fire based
 * on the difficulty profile, then picks lanes for each firing step. Lane
 * pick avoids same-lane repetition on consecutive firings so the player
 * isn't pinned to one column for long stretches.
 */
export function generateChart(args: {
  authorId: string;
  title: string;
  difficulty: GenDifficulty;
  bpm: number;
  vibe: BackingVibe;
  targetDurationMs: number;
}): Chart {
  const { authorId, title, difficulty, bpm, vibe, targetDurationMs } = args;
  const profile = PROFILES[difficulty];
  const stepCount = stepsForDuration(bpm, targetDurationMs);

  const seed =
    (bpm * 31 + difficulty.charCodeAt(0) + vibe.charCodeAt(0) + Date.now()) | 0;
  const rng = makeRng(seed);

  const steps: ChartStep[] = Array.from({ length: stepCount }, () => ({ lanes: [] as LaneId[] }));

  let stepsSinceLastFire = profile.minGapSteps; // allow firing on step 0
  let lastLane: LaneId | null = null;

  for (let i = 0; i < stepCount; i++) {
    const canFire = stepsSinceLastFire >= profile.minGapSteps;
    if (!canFire || rng() >= profile.density) {
      stepsSinceLastFire++;
      continue;
    }

    // Pick lane count for this beat. chord3 implies a 3-lane hit (rare,
    // hard only); chord2 implies a 2-lane hit; default is a single tap.
    const roll = rng();
    let laneCount = 1;
    if (roll < profile.chord3Chance) laneCount = 3;
    else if (roll < profile.chord3Chance + profile.chord2Chance) laneCount = 2;

    const lanes = pickLanes(rng, laneCount, lastLane);
    steps[i]!.lanes = lanes;
    lastLane = lanes[0]!;
    stepsSinceLastFire = 0;
  }

  return {
    authorId,
    title,
    stepCount,
    bpm,
    vibe,
    steps,
    updatedAt: Date.now(),
  };
}

/** Pick `count` distinct lanes, biased away from the previous single-tap
 *  lane so the player isn't pinned to one column for long runs. For
 *  multi-lane chords we just shuffle and take a slice — the bias only
 *  matters for the single-tap case. */
function pickLanes(rng: () => number, count: number, avoid: LaneId | null): LaneId[] {
  const all: LaneId[] = [0, 1, 2];
  if (count >= 3) return all;
  if (count === 1) {
    const candidates = avoid === null ? all : all.filter((l) => l !== avoid);
    return [candidates[Math.floor(rng() * candidates.length)]!];
  }
  // count === 2: pick first lane biased away from previous, second is
  // any of the remaining two.
  const firstPool = avoid === null ? all : all.filter((l) => l !== avoid);
  const first = firstPool[Math.floor(rng() * firstPool.length)]!;
  const rest = all.filter((l) => l !== first);
  const second = rest[Math.floor(rng() * rest.length)]!;
  return [first, second];
}
