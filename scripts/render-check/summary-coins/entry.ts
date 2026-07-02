/**
 * summary-coins harness — boots the REAL Game scene's summary overlay in
 * a bare Phaser game so the Playwright driver (shoot.mjs) can screenshot
 * the coin-reward line (summaryCoinsText) in each valve state.
 *
 * It subclasses Game and overrides create() to skip the heavy round
 * setup, wiring only the minimum the summary path needs, then calls the
 * SHIPPED buildSummaryOverlay() / showSummary() / updateSummaryCoinsLine()
 * so the geometry + styling under test is exactly the production code.
 *
 * Diagnostic tool only. Never shipped in the game bundle.
 */
import Phaser from 'phaser';
import { Game } from '@/scenes/Game';
import { ScoreSystem } from '@/systems/score-system';
import { DESIGN_W, DESIGN_H } from '@/constants/scene-layout';

// Replicate the crisp-text factory patch from src/client/game.ts so the
// summary text renders at the same resolution as production.
const DPR = (typeof window !== 'undefined' && window.devicePixelRatio) || 2;
const TEXT_RESOLUTION = Math.max(2, Math.min(3, DPR));
const _origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function patched(
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle,
) {
  return _origText.call(this, x, y, text, {
    ...(style ?? {}),
    resolution: style?.resolution ?? TEXT_RESOLUTION,
  });
};

class SummaryProbe extends Game {
  // eslint-disable-next-line @typescript-eslint/require-await
  override async create(): Promise<void> {
    const self = this as unknown as Record<string, unknown> & {
      buildSummaryOverlay(): void;
      showSummary(): void;
      updateSummaryCoinsLine(): void;
    };
    self.visitorMode = true;
    self.testMode = false;
    self.playerState = { username: 'tester' };
    // Chart needs audioKey + difficulty so the BEST row renders (the coin
    // line sits directly below it — this is the real co-occurring layout).
    self.playChart = {
      authorId: 'host',
      title: 'Test Song',
      audioKey: 'song',
      difficulty: 'medium',
      stepCount: 72,
      bpm: 120,
      steps: [],
      holds: [],
      slides: [],
      slideReturns: [],
      updatedAt: Date.now(),
    };
    const score = new ScoreSystem();
    for (let i = 0; i < 64; i++) score.registerHit('perfect');
    for (let i = 0; i < 6; i++) score.registerHit('great');
    for (let i = 0; i < 2; i++) score.registerHit('miss');
    score.add(18420);
    self.score = score;
    self.comboText = this.add.text(DESIGN_W / 2, 20, '', {
      fontFamily: 'Pixeloid Sans, sans-serif',
    });

    self.buildSummaryOverlay();
    self.showSummary();

    (window as unknown as { __setBreakdown: (b: unknown) => void }).__setBreakdown = (b) => {
      self.lastRewardBreakdown = b;
      self.updateSummaryCoinsLine();
    };
    (window as unknown as { __ready: boolean }).__ready = true;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b041a',
  width: DESIGN_W,
  height: DESIGN_H,
  render: { preserveDrawingBuffer: true },
  scene: [SummaryProbe],
});
