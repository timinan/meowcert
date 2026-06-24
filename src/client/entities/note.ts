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
  private ball: GameObjects.Image;
  private letters: GameObjects.Image;

  constructor(scene: Scene) {
    super(scene, 0, 0);
    // 54px — matches the 50% bump applied to the lane hit targets (48 → 72)
    // so the falling notes read at the same visual weight as the target.
    // White-base ball — greyscale-stretched so the per-bg sampled tint
    // paints a clean fuzzball instead of multiplying through the
    // prototype's saturated orange.
    this.ball = scene.add.image(0, 0, AssetKeys.Image.PspspsElementBallWhite);
    this.ball.setDisplaySize(54, 54);
    this.letters = scene.add.image(0, 0, AssetKeys.Image.PspspsElementLetters);
    this.letters.setDisplaySize(54, 54);
    this.add([this.ball, this.letters]);
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
  ): void {
    // Kill any in-flight tween from the pool's previous use FIRST. If we
    // set position before killing, a still-running fall tween from the
    // prior life can re-write y in the same frame and the note appears
    // to "teleport down" instead of starting at startY.
    this.scene.tweens.killTweensOf(this);
    this.laneId = laneId;
    this.hitAtMs = hitAtMs;
    this.consumed = false;
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
  }
}
