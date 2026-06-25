import type { GenDifficulty } from '@/../shared/chart-generator';

/**
 * Local-only personal-best store for rehearsal — replaces the social
 * leaderboard inside the single-player practice loop. Stored under one
 * localStorage key as a JSON map of `"${audioKey}:${difficulty}"` →
 * per-stat best values the player has hit on that exact chart.
 *
 * Per-stat semantics:
 *   - score, accuracy, maxCombo, hits → higher is better
 *   - misses                          → lower is better
 *
 * Each stat is tracked independently so the player gets credit for a
 * higher max-combo even if their overall score wasn't a record.
 *
 * Why localStorage: rehearsal is intentionally a private "practice room"
 * — zero rewards, zero social signal, just numbers you're trying to
 * beat. Persisting it server-side would invite cross-device sync work
 * for a feature that has no shared surface.
 */

const STORAGE_KEY = 'meowcert:rehearsal-best';

export interface BestStats {
  score: number;
  /** 0–100, integer percent. */
  accuracy: number;
  maxCombo: number;
  hits: number;
  misses: number;
}

export type StatKey = keyof BestStats;

type BestMap = Record<string, BestStats>;

function readMap(): BestMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as BestMap;
    return {};
  } catch {
    return {};
  }
}

function writeMap(map: BestMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / private-mode failure — silently no-op. Best score is a
    // nice-to-have, not load-bearing.
  }
}

function keyFor(audioKey: string, difficulty: GenDifficulty): string {
  return `${audioKey}:${difficulty}`;
}

/** Per-stat best for this chart, or null if never played. */
export function getBest(audioKey: string, difficulty: GenDifficulty): BestStats | null {
  const map = readMap();
  return map[keyFor(audioKey, difficulty)] ?? null;
}

/** Record this run and update any stats it beat. Returns the set of
 *  stat keys that were newly bested, so the UI can highlight per-cell
 *  improvements. A run with zero new bests still gets recorded (so
 *  partial bests like "you beat max-combo but not score" register). */
export function recordRun(
  audioKey: string,
  difficulty: GenDifficulty,
  run: BestStats,
): Set<StatKey> {
  const map = readMap();
  const k = keyFor(audioKey, difficulty);
  const prev = map[k];
  const newBests = new Set<StatKey>();
  if (!prev) {
    // First run on this chart — every stat is a new best by definition.
    map[k] = { ...run };
    for (const key of ['score', 'accuracy', 'maxCombo', 'hits', 'misses'] as StatKey[]) {
      newBests.add(key);
    }
    writeMap(map);
    return newBests;
  }
  const next: BestStats = { ...prev };
  if (run.score > prev.score) { next.score = run.score; newBests.add('score'); }
  if (run.accuracy > prev.accuracy) { next.accuracy = run.accuracy; newBests.add('accuracy'); }
  if (run.maxCombo > prev.maxCombo) { next.maxCombo = run.maxCombo; newBests.add('maxCombo'); }
  if (run.hits > prev.hits) { next.hits = run.hits; newBests.add('hits'); }
  // Misses: LOWER is better. A tie isn't a new best.
  if (run.misses < prev.misses) { next.misses = run.misses; newBests.add('misses'); }
  map[k] = next;
  writeMap(map);
  return newBests;
}
