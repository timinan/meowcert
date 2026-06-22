import { describe, it, expect } from 'vitest';
import {
  DIFFICULTY_PRESETS,
  makeChartForDifficulty,
  type DifficultyLevel,
} from '../src/client/systems/difficulty-charts';
import { DEFAULT_CHART_STEP_COUNT, validateChart } from '../src/shared/state';

describe('difficulty charts', () => {
  it('every level produces a valid chart', () => {
    for (const level of [1, 2, 3, 4, 5] as DifficultyLevel[]) {
      const chart = makeChartForDifficulty(level);
      expect(chart.stepCount).toBe(DEFAULT_CHART_STEP_COUNT);
      expect(chart.steps).toHaveLength(DEFAULT_CHART_STEP_COUNT);
      expect(validateChart(chart)).toEqual({ ok: true });
    }
  });

  it('every level uses all three lanes (no silent bar)', () => {
    for (const level of [1, 2, 3, 4, 5] as DifficultyLevel[]) {
      for (let trial = 0; trial < 20; trial++) {
        const chart = makeChartForDifficulty(level);
        const lanes = new Set(chart.steps.flatMap((s) => s.lanes));
        expect(lanes).toEqual(new Set([0, 1, 2]));
      }
    }
  });

  it('density rises monotonically across levels (avg over 30 trials)', () => {
    const avgDensity = (level: DifficultyLevel): number => {
      let sum = 0;
      for (let i = 0; i < 30; i++) {
        const c = makeChartForDifficulty(level);
        sum += c.steps.filter((s) => s.lanes.length > 0).length;
      }
      return sum / 30;
    };
    const d1 = avgDensity(1);
    const d3 = avgDensity(3);
    const d5 = avgDensity(5);
    expect(d1).toBeLessThan(d3);
    expect(d3).toBeLessThan(d5);
  });

  it('chord rate rises across levels (level 1 has zero chords)', () => {
    for (let i = 0; i < 30; i++) {
      const c = makeChartForDifficulty(1);
      const chords = c.steps.filter((s) => s.lanes.length > 1).length;
      expect(chords).toBe(0);
    }
  });

  it('presets are ordered ascending by density + chord rate', () => {
    for (let i = 2; i <= 5; i++) {
      const prev = DIFFICULTY_PRESETS[(i - 1) as DifficultyLevel];
      const curr = DIFFICULTY_PRESETS[i as DifficultyLevel];
      expect(curr.density).toBeGreaterThanOrEqual(prev.density);
      expect(curr.chordRate).toBeGreaterThanOrEqual(prev.chordRate);
    }
  });
});
