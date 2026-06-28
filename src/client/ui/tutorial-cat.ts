import { Scene, GameObjects } from 'phaser';
import { AssetKeys } from '@/constants/assets';

/**
 * Tutorial-host cat overlay — the visual representation of "Whiskers"
 * narrating the tutorial. Renders a cat sprite (top-left of the
 * dialogue zone) + a speech-bubble background + the dialogue line +
 * an optional Continue button.
 *
 * Composable: any scene that needs the overlay (orchestrator + the
 * guided-mode steps in Decorate / Game / ChartEditor in later phases)
 * instantiates one, calls show() with the current line + an onContinue
 * callback, and calls hide() / destroy() when done.
 *
 * The host cat uses an existing breed not in the starter pool so it
 * never collides with the player's pick. cat6 (Inkwell, rare) is the
 * pick — present in the cats atlas as `cat6_idle_00`.
 */

const HOST_BREED_FRAME = 'cat6_idle_00';
const SPEECH_BUBBLE_COLOR = 0xfff8e7;
const SPEECH_BUBBLE_STROKE = 0xc678ff;
const TEXT_COLOR = '#1a0a2e';
const CONTINUE_FILL = 0xffd34d;
const CONTINUE_TEXT = '#1a0a2e';

interface ShowOptions {
  /** Optional Continue button. When omitted, the overlay is dialogue-
   *  only — the caller controls dismissal externally (e.g. a guided-
   *  mode step that advances on a real game action). */
  onContinue?: () => void;
  /** Default 'Continue →'. Override for "Next →" on multi-line beats. */
  continueLabel?: string;
}

export class TutorialCatOverlay {
  private container: GameObjects.Container | undefined;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Build (or rebuild) the overlay with the given dialogue. Safe to
   *  call repeatedly — each call tears down the previous render. */
  show(dialogue: string, opts: ShowOptions = {}): void {
    this.hide();

    const { width, height } = this.scene.scale;
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(2000);

    // -- Host cat sprite ----------------------------------------------
    // Anchored bottom-left of the dialogue zone. Scaled to ~84 design
    // pixels tall — readable but doesn't dominate the bubble.
    const catX = 56;
    const catY = height * 0.62;
    const catSprite = this.scene.add
      .sprite(catX, catY, AssetKeys.Atlas.Cats, HOST_BREED_FRAME)
      .setOrigin(0.5, 1)
      .setScale(1.3);
    this.container.add(catSprite);

    // -- Speech bubble ------------------------------------------------
    // Bubble fills the dialogue zone — width adapts to the canvas,
    // centered horizontally on the cat's right side. A tiny tail-arrow
    // anchors it to the cat.
    const bubbleX = catX + 36;
    const bubbleY = catY - 92;
    const bubbleW = Math.min(width - bubbleX - 24, 240);
    const bubbleH = 140;
    const bubble = this.scene.add
      .rectangle(bubbleX, bubbleY, bubbleW, bubbleH, SPEECH_BUBBLE_COLOR, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, SPEECH_BUBBLE_STROKE, 1);
    this.container.add(bubble);

    // Tail-arrow — small triangle anchored to the cat. Pointing left.
    const tail = this.scene.add.triangle(
      bubbleX,
      bubbleY + bubbleH - 16,
      0,
      0,
      -10,
      8,
      0,
      16,
      SPEECH_BUBBLE_COLOR,
    );
    tail.setStrokeStyle(2, SPEECH_BUBBLE_STROKE, 1);
    this.container.add(tail);

    // -- Dialogue text -----------------------------------------------
    const text = this.scene.add
      .text(bubbleX + 12, bubbleY + 12, dialogue, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '11px',
        color: TEXT_COLOR,
        wordWrap: { width: bubbleW - 24 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0);
    this.container.add(text);

    // -- Continue button ---------------------------------------------
    if (opts.onContinue) {
      const label = opts.continueLabel ?? 'Continue →';
      const btnY = height * 0.86;
      const btnW = 220;
      const btnH = 52;
      const btnBg = this.scene.add
        .rectangle(width / 2, btnY, btnW, btnH, CONTINUE_FILL, 1)
        .setInteractive({ useHandCursor: true });
      btnBg.setStrokeStyle(2, 0x1a0a2e, 1);
      const btnText = this.scene.add
        .text(width / 2, btnY, label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '16px',
          color: CONTINUE_TEXT,
        })
        .setOrigin(0.5);
      this.container.add([btnBg, btnText]);
      btnBg.on('pointerdown', () => {
        // Quick scale pulse for tap feedback before firing the
        // callback — same pattern as Welcome.ts had.
        this.scene.tweens.add({
          targets: [btnBg, btnText],
          scale: 0.96,
          duration: 80,
          yoyo: true,
          onComplete: () => opts.onContinue?.(),
        });
      });
    }
  }

  /** Tear down the overlay container. Idempotent — calling on an
   *  already-hidden overlay is a no-op. */
  hide(): void {
    if (this.container) {
      this.scene.tweens.killTweensOf(this.container);
      this.container.destroy(true);
      this.container = undefined;
    }
  }

  destroy(): void {
    this.hide();
  }
}
