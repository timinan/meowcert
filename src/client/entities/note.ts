import { GameObjects, Scene } from 'phaser';
import type { LaneId } from '../../shared/state';
import { AssetKeys } from '../constants/assets';
import { LANE_COLORS, liftTowardWhite, BALL_BRIGHTNESS_LIFT } from './note-colors';

export { LANE_COLORS };

/**
 * A falling rhythm note rendered as the original Phase 1 "PS element" ball
 * (the colored ball that slid down the horizontal rhythm bar). Pooled —
 * configure() is the reset point; recycle() deactivates without resetting
 * `consumed`.
 */
export class Note extends GameObjects.Container {
  laneId: LaneId = 0;
  hitAtMs = 0;
  consumed = false;

  /** True for hold notes — affects miss detection (held holds don't
   *  auto-miss when the head crosses the miss line) and tells Game.ts
   *  to engage the hold instead of consuming on a successful tap. */
  isHold = false;
  /** Game-time when the trailing edge of the hold reaches the target.
   *  Game.ts uses this to time auto-end. 0 for tap notes. */
  holdEndAtMs = 0;
  /** Set true by Game.ts once the player has tapped down on this hold's
   *  head and is currently inside the hold. Cleared on release or
   *  auto-end. */
  holdActive = false;

  private ball: GameObjects.Image;
  private letters: GameObjects.Image;
  /** Rendered behind the ball when isHold is true. Extends upward from
   *  the ball (y < 0 in container space). Hidden + zero-height for taps. */
  private tail: GameObjects.Rectangle;

  constructor(scene: Scene) {
    super(scene, 0, 0);
    // Tail FIRST so it renders behind the ball + letters when both are
    // visible. Default hidden — only hold notes turn it on via configure().
    this.tail = scene.add.rectangle(0, 0, 40, 0, 0xffffff, 0.85);
    this.tail.setStrokeStyle(1, 0x1a0a2e, 0.7);
    this.tail.setVisible(false);
    // 54px — matches the 50% bump applied to the lane hit targets (48 → 72)
    // so the falling notes read at the same visual weight as the target.
    // White-base ball — greyscale-stretched so the per-bg sampled tint
    // paints a clean fuzzball instead of multiplying through the
    // prototype's saturated orange.
    this.ball = scene.add.image(0, 0, AssetKeys.Image.PspspsElementBallWhite);
    this.ball.setDisplaySize(54, 54);
    this.letters = scene.add.image(0, 0, AssetKeys.Image.PspspsElementLetters);
    this.letters.setDisplaySize(54, 54);
    this.add([this.tail, this.ball, this.letters]);
    // Render above cat-effect particles (cat sprite depth 0 → particles
    // depth +2). Without this, a cat with sparkles / fire / hearts equipped
    // visually obscures every falling note in its lane and the player
    // misses everything in that column.
    this.setDepth(40);
    this.setActive(false).setVisible(false);
  }

  configure(
    laneId: LaneId,
    x: number,
    startY: number,
    endY: number,
    fallMs: number,
    hitAtMs: number,
    /** Override the default LANE_COLORS tint — typically the per-bg
     *  sampled color from `Game.laneTints` so the falling note matches
     *  its lane's hit target. Omit / pass undefined for the default. */
    tintColor?: number,
    /** Optional hold config. When set, the note renders with a tail
     *  rectangle extending upward from the ball (= the trailing portion
     *  yet to be held) and records `holdEndAtMs` so Game.ts can auto-end
     *  when the tail's top crosses the target line. */
    hold?: { tailHeightPx: number; tailWidthPx: number; releaseAtMs: number },
  ): void {
    // Kill any in-flight tween from the pool's previous use FIRST. If we
    // set position before killing, a still-running fall tween from the
    // prior life can re-write y in the same frame and the note appears
    // to "teleport down" instead of starting at startY.
    this.scene.tweens.killTweensOf(this);
    this.laneId = laneId;
    this.hitAtMs = hitAtMs;
    this.consumed = false;
    this.holdActive = false;
    this.setPosition(x, startY);
    this.setActive(true).setVisible(true);
    this.setAlpha(1);
    this.setScale(1);
    // Lift the ball tint toward white so the falling note pops against
    // the alpha-0.55 lane underneath (lane + ball were previously the
    // exact same hue and blended on busy bgs).
    this.ball.setTint(liftTowardWhite(tintColor ?? LANE_COLORS[laneId], BALL_BRIGHTNESS_LIFT));
    // Letters stay white so the "PS" reads clearly on top of any lane tint.
    this.letters.clearTint();

    if (hold) {
      this.isHold = true;
      this.holdEndAtMs = hold.releaseAtMs;
      this.tail.setVisible(true);
      this.tail.setSize(hold.tailWidthPx, hold.tailHeightPx);
      // Tail extends upward from ball center — sits at y = -tailHeight/2
      // in container space so its BOTTOM edge meets the ball's center.
      this.tail.setPosition(0, -hold.tailHeightPx / 2);
      this.tail.setFillStyle(tintColor ?? LANE_COLORS[laneId], 0.85);
    } else {
      this.isHold = false;
      this.holdEndAtMs = 0;
      this.tail.setVisible(false);
    }

    this.scene.tweens.add({
      targets: this,
      y: endY,
      duration: fallMs,
      ease: 'Linear',
    });
  }

  recycle(): void {
    this.scene.tweens.killTweensOf(this);
    this.setActive(false).setVisible(false);
    this.tail.setVisible(false);
    this.isHold = false;
    this.holdActive = false;
    this.holdEndAtMs = 0;
  }
}
