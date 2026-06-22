import { describe, expect, it } from 'vitest';
import {
  CHART_PAGE_SIZE,
  DEFAULT_CHART_STEP_COUNT,
  emptyChart,
  validateChart,
} from '../src/shared/state';

describe('Chart', () => {
  it('emptyChart defaults to a 32-step blank chart at 120 bpm', () => {
    const c = emptyChart('alice', 'untitled');
    expect(c.stepCount).toBe(DEFAULT_CHART_STEP_COUNT);
    expect(c.bpm).toBe(120);
    expect(c.steps).toHaveLength(DEFAULT_CHART_STEP_COUNT);
    expect(c.steps.every(s => s.lanes.length === 0)).toBe(true);
  });

  it('emptyChart accepts a custom stepCount that is a multiple of the page size', () => {
    const c = emptyChart('alice', 'x', 8);
    expect(c.stepCount).toBe(8);
    expect(c.steps).toHaveLength(8);
  });

  it('validateChart rejects a stepCount that is not a multiple of the page size', () => {
    const c = emptyChart('alice', 'x');
    const bad = { ...c, stepCount: 7 };
    expect(validateChart(bad)).toMatchObject({ ok: false });
  });

  it('validateChart accepts a stepCount that is a multiple of the page size', () => {
    const c = emptyChart('alice', 'x', CHART_PAGE_SIZE * 2);
    expect(validateChart(c)).toEqual({ ok: true });
  });

  it('validateChart rejects out-of-range bpm', () => {
    const c = emptyChart('alice', 'x');
    expect(validateChart({ ...c, bpm: 30 })).toMatchObject({ ok: false });
    expect(validateChart({ ...c, bpm: 240 })).toMatchObject({ ok: false });
  });

  it('validateChart rejects illegal lane ids', () => {
    const c = emptyChart('alice', 'x');
    c.steps[0] = { lanes: [3 as unknown as 0] };
    expect(validateChart(c)).toMatchObject({ ok: false });
  });

  it('validateChart returns ok:true for a clean emptyChart', () => {
    const c = emptyChart('alice', 'x');
    expect(validateChart(c)).toEqual({ ok: true });
  });

  it('validateChart rejects when steps.length differs from stepCount', () => {
    const c = emptyChart('alice', 'x');
    c.steps.pop();
    expect(validateChart(c)).toMatchObject({ ok: false });
  });
});
