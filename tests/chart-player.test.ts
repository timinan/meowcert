import { describe, expect, it } from 'vitest';
import { ChartPlayer } from '../src/client/systems/chart-player';
import { emptyChart, type Chart } from '../src/shared/state';

function chartWith(stepLanes: number[][]): Chart {
  const c = emptyChart('a', 't');
  stepLanes.forEach((lanes, i) => (c.steps[i] = { lanes: lanes as any }));
  return c;
}

describe('ChartPlayer', () => {
  it('emits a noteSpawn at the start when step 0 has a lane', () => {
    const c = chartWith([[0], [], [], [], [], [], [], []]);
    const player = new ChartPlayer(c, { loopCount: 1, noteFallMs: 1000 });
    const spawns: Array<{ lane: number; hitAt: number }> = [];
    player.onSpawn((lane, hitAt) => spawns.push({ lane, hitAt }));
    player.advance(0);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].lane).toBe(0);
  });

  it('spawns sequential steps at BPM-correct cadence', () => {
    const c = chartWith([[0], [1], [2], [], [], [], [], []]);
    c.bpm = 120; // 8 steps per bar => 250ms per step
    const player = new ChartPlayer(c, { loopCount: 1, noteFallMs: 1000 });
    const spawns: Array<{ lane: number; hitAt: number }> = [];
    player.onSpawn((lane, hitAt) => spawns.push({ lane, hitAt }));
    for (let t = 0; t < 1000; t += 50) player.advance(50);
    expect(spawns.map(s => s.lane)).toEqual([0, 1, 2]);
    expect(spawns[1].hitAt - spawns[0].hitAt).toBeCloseTo(250, 0);
  });

  it("isFinished returns true after last loop's last note hit time + grace", () => {
    const c = chartWith([[0], [], [], [], [], [], [], []]);
    const player = new ChartPlayer(c, { loopCount: 2, noteFallMs: 500 });
    for (let t = 0; t < 5000; t += 100) player.advance(100);
    expect(player.isFinished()).toBe(true);
  });
});
