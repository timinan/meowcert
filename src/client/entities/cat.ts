import { Scene, Scenes, GameObjects } from 'phaser';
import { AssetKeys } from '@/constants/assets';
import { Balance } from '@/constants/balance';
import type { CatBreed, CatAnimationState, CatModel, CosmeticId } from '@/types/game';

// How far above the sprite's anchor (which sits at the cat's feet, origin
// (0.5, 1)) to place the cosmetic. Source-pixel space, so it scales with
// the cat's current scale.
const COSMETIC_OFFSET_Y = -46;

/**
 * Phaser sprite wrapper around a CatModel.
 *
 * Animations are registered globally (in the scene's anims manager) the first
 * time a cat needs them. Frame names follow the convention
 * `${breed}_${animation}_${frameIndex:02d}` produced by the asset extractor.
 *
 * If a requested animation has no frames in the atlas (e.g. 'happy' is missing
 * for cat1/cat2/cat3), the sprite holds its current frame and logs a warning.
 */
export class Cat {
  readonly sprite: GameObjects.Sprite;
  private cosmeticSprite: GameObjects.Image | null = null;
  private readonly postUpdate: () => void;

  constructor(
    private readonly scene: Scene,
    public readonly model: CatModel,
  ) {
    const initialFrame = Cat.frameName(model.breed, model.animation, 0);
    this.sprite = scene.add.sprite(0, 0, AssetKeys.Atlas.Cats, initialFrame);
    this.sprite.setOrigin(0.5, 1);
    this.ensureAnimation(model.breed, model.animation);
    this.playAnimation(model.animation);

    // Cosmetic follows the cat sprite each frame so tweens on `sprite` (e.g.
    // the petting handoff slide-to-center) carry the accessory along. We
    // could parent via a Container but that would change `cat.sprite`'s
    // type, and callers like Game.ts reach in to set depth on it directly.
    this.postUpdate = () => this.syncCosmeticPosition();
    this.scene.events.on(Scenes.Events.POST_UPDATE, this.postUpdate);

    if (model.equippedCosmetic) {
      this.setCosmetic(model.equippedCosmetic);
    }
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.syncCosmeticPosition();
  }

  setAnimation(animation: CatAnimationState): void {
    this.model.animation = animation;
    this.ensureAnimation(this.model.breed, animation);
    this.playAnimation(animation);
  }

  /**
   * Show or update the cosmetic worn above this cat. Passing `null`
   * removes whatever it's currently wearing. The cosmetic is rendered
   * just above the cat sprite and matches the cat's scale + position.
   */
  setCosmetic(cosmeticId: CosmeticId | null): void {
    if (cosmeticId) {
      this.model.equippedCosmetic = cosmeticId;
    } else {
      delete this.model.equippedCosmetic;
    }

    if (!cosmeticId) {
      this.cosmeticSprite?.destroy();
      this.cosmeticSprite = null;
      return;
    }

    const frame = `cosmetic_${cosmeticId}_idle_00`;
    if (!this.cosmeticSprite) {
      this.cosmeticSprite = this.scene.add.image(0, 0, AssetKeys.Atlas.Cats, frame);
      this.cosmeticSprite.setOrigin(0.5, 0.5);
    } else {
      this.cosmeticSprite.setTexture(AssetKeys.Atlas.Cats, frame);
    }
    this.syncCosmeticPosition();
  }

  destroy(): void {
    this.scene.events.off(Scenes.Events.POST_UPDATE, this.postUpdate);
    this.cosmeticSprite?.destroy();
    this.cosmeticSprite = null;
    this.sprite.destroy();
  }

  private syncCosmeticPosition(): void {
    if (!this.cosmeticSprite) return;
    // Sit just above the cat sprite. The cat is anchored at (0.5, 1) so
    // y is the feet position; we move up by its display height plus a
    // small offset to land near the top of the head.
    const scale = this.sprite.scaleX;
    this.cosmeticSprite.setScale(scale);
    this.cosmeticSprite.setPosition(
      this.sprite.x,
      this.sprite.y - this.sprite.displayHeight + COSMETIC_OFFSET_Y * scale,
    );
    this.cosmeticSprite.setDepth(this.sprite.depth + 1);
  }

  private playAnimation(animation: CatAnimationState): void {
    const key = Cat.animationKey(this.model.breed, animation);
    if (this.scene.anims.exists(key)) {
      this.sprite.play(key, true);
    } else {
      // Hold whatever frame we have — no fallback animation in Phase 1.
      // Phase 2 may map missing animations to 'idle' when we add accessories.
    }
  }

  private ensureAnimation(breed: CatBreed, animation: CatAnimationState): void {
    const key = Cat.animationKey(breed, animation);
    if (this.scene.anims.exists(key)) return;

    const atlas = this.scene.textures.get(AssetKeys.Atlas.Cats);
    const prefix = `${breed}_${animation}_`;
    const frameNames = atlas
      .getFrameNames()
      .filter((n) => n.startsWith(prefix))
      .sort();

    if (frameNames.length === 0) {
      console.warn(`[cat] No frames for ${prefix} in cats atlas`);
      return;
    }

    this.scene.anims.create({
      key,
      frames: frameNames.map((frame) => ({ key: AssetKeys.Atlas.Cats, frame })),
      frameRate: Balance.catAnimationFrameRate,
      repeat: animation === 'hiss' || animation === 'happy' ? 0 : -1,
    });
  }

  static animationKey(breed: CatBreed, animation: CatAnimationState): string {
    return `${breed}_${animation}`;
  }

  static frameName(
    breed: CatBreed,
    animation: CatAnimationState,
    frameIndex: number,
  ): string {
    return `${breed}_${animation}_${String(frameIndex).padStart(2, '0')}`;
  }
}
