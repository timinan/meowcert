import { GameObjects, Scene } from 'phaser';
import { BACKGROUND_CATALOG } from '@/../shared/state';
import type { BackgroundId } from '@/../shared/state';

const KNOWN_IDS = Object.keys(BACKGROUND_CATALOG) as BackgroundId[];

/**
 * Draws a themed procedural backdrop behind the cat stage.
 *
 * Usage:
 *   const bg = new BackgroundManager(scene);
 *   const container = bg.create();          // call in scene create()
 *   bg.setBackground('cozy');               // swap at any time
 *   bg.destroy();                           // call on scene SHUTDOWN
 *
 * The container sits at depth -100 so it renders behind everything else.
 * Art is procedural for v1 (gradient rect + scenery emoji). Swap `draw()`
 * internals for atlas keys once backdrop art lands.
 */
export class BackgroundManager {
  active: BackgroundId = 'default';
  private container: GameObjects.Container | undefined;

  constructor(private scene: Scene) {}

  create(): GameObjects.Container {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(-100);
    this.draw();
    return this.container;
  }

  setBackground(id: BackgroundId): void {
    this.active = KNOWN_IDS.includes(id) ? id : 'default';
    this.draw();
  }

  /** Redraws the container contents for the active background id.
   *  Safe to call on background changes — not a per-frame hot path. */
  private draw(): void {
    if (!this.container) return;
    this.container.removeAll(true);

    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    // Cheap gradient via a single rect. Replace with atlas key once art lands.
    const top = this.scene.add
      .rectangle(0, 0, w, h, this.topColor())
      .setOrigin(0, 0);
    this.container.add(top);

    // Scenery decor per theme.
    if (this.active === 'cozy') {
      // Window rectangle + potted plant.
      this.container.add(this.scene.add.rectangle(20, 60, 60, 80, 0xffd187));
      this.container.add(
        this.scene.add.text(w - 36, h * 0.25, '🪴', { fontSize: '28px' }),
      );
    } else if (this.active === 'spooky') {
      // Ghost at reduced alpha.
      this.container.add(
        this.scene.add.text(24, 60, '👻', { fontSize: '24px' }).setAlpha(0.6),
      );
    }
  }

  private topColor(): number {
    if (this.active === 'cozy') return 0xc98a48;
    if (this.active === 'spooky') return 0x2a2440;
    return 0x3b2a5c;
  }

  destroy(): void {
    this.container?.destroy(true);
    this.container = undefined;
  }
}
