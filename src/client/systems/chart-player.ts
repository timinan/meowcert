import type { Chart, LaneId } from '../../shared/state';

export interface ChartPlayerOpts {
  loopCount: number;
  noteFallMs: number;
}

export class ChartPlayer {
  private elapsedMs = 0;
  private nextEmitStep = 0;
  private listeners: Array<(lane: LaneId, hitAt: number) => void> = [];
  private msPerStep: number;
  private totalMs: number;

  constructor(
    private chart: Chart,
    private opts: ChartPlayerOpts,
  ) {
    // 8 steps per bar => msPerStep = (60000 / bpm) / 2 (assumes 8 eighth-notes per bar)
    this.msPerStep = 60000 / (chart.bpm * 2);
    this.totalMs = this.msPerStep * chart.stepCount * opts.loopCount;
  }

  onSpawn(fn: (lane: LaneId, hitAt: number) => void): void {
    this.listeners.push(fn);
  }

  advance(dtMs: number): void {
    const prevMs = this.elapsedMs;
    this.elapsedMs += dtMs;
    const startSpawnAt = prevMs;
    const stopSpawnAt = Math.min(this.elapsedMs, this.totalMs);
    while (this.nextEmitStep * this.msPerStep <= stopSpawnAt) {
      const t = this.nextEmitStep * this.msPerStep;
      if (t < startSpawnAt && this.nextEmitStep > 0) {
        this.nextEmitStep += 1;
        continue;
      }
      const stepIdx = this.nextEmitStep % this.chart.stepCount;
      const step = this.chart.steps[stepIdx]!;
      const hitAt = t + this.opts.noteFallMs;
      for (const lane of step.lanes) {
        for (const fn of this.listeners) fn(lane, hitAt);
      }
      this.nextEmitStep += 1;
    }
  }

  isFinished(): boolean {
    // all spawned notes have fallen: chart end + full fall window
    return this.elapsedMs >= this.totalMs + this.opts.noteFallMs;
  }
}
