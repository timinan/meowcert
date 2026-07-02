/**
 * fx-scan harness — applies every generated effect to a dummy sprite in a
 * bare Phaser scene so the Playwright driver can detect apply-time throws,
 * per-frame throws (RAF-chain death), and hard main-thread stalls.
 *
 * Diagnostic tool only. Never shipped in the game bundle.
 */
import Phaser from 'phaser';
import { getEffectById, getEffectGridEntries } from '@/effects/cat-effects';
import type { EffectHandle } from '@/effects/cat-effects';

// Deliberately NO `window.Phaser` polyfill — the real game bundle has no
// global Phaser, and polyfilling one here masked the effect-interpreter's
// unbound `Phaser.*` references (the strobe/rainbow/aurora freeze class).
// The harness must fail exactly where the game fails.

type ScanApi = {
  ids(): string[];
  start(id: string): string | null; // returns error message or null
  frames(): number;
  baseline(): void;
  pixelDelta(): number; // pixels differing from the effect-free baseline
  bbox(): { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number } | null;
  stop(): string | null;
};

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) =>
  errors.push(String((e as PromiseRejectionEvent).reason)),
);

class ScanScene extends Phaser.Scene {
  frameCount = 0;
  target!: Phaser.GameObjects.Sprite;
  handle: EffectHandle | null = null;

  preload(): void {
    // Real cat when the server exposes the game atlas (capture-flipbooks
    // + scan servers serve it); harmless 404 → gray-box fallback.
    this.load.atlas('cats-atlas', 'assets/atlas/cats.png', 'assets/atlas/cats.json');
    this.load.on('loaderror', () => { /* fall back to dummy */ });
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(0x888888, 1);
    g.fillRect(0, 0, 64, 64);
    g.generateTexture('dummy-cat', 64, 64);
    g.destroy();
    const useCat = this.textures.exists('cats-atlas') &&
      this.textures.get('cats-atlas').has('cat2_idle_00');
    this.target = useCat
      ? this.add.sprite(240, 320, 'cats-atlas', 'cat2_idle_00').setScale(1.4)
      : this.add.sprite(240, 320, 'dummy-cat').setScale(1.4);

    let base: Uint8ClampedArray | null = null;
    // WebGL-safe: blit the game canvas into an offscreen 2d canvas
    // (requires preserveDrawingBuffer: true in the game config below).
    const off = document.createElement('canvas');
    const grab = (): Uint8ClampedArray => {
      const canvas = this.game.canvas;
      off.width = canvas.width; off.height = canvas.height;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, off.width, off.height).data;
    };

    const api: ScanApi = {
      // Full merged catalog (hand-authored + generated), deduped the same
      // way the game dedupes (getEffectById prefers hand-authored).
      ids: () => getEffectGridEntries().map((e) => e.id),
      baseline: () => { base = grab(); },
      pixelDelta: () => {
        if (!base) return -1;
        const now = grab();
        let delta = 0;
        for (let i = 0; i < now.length; i += 4) {
          if (
            Math.abs(now[i] - base[i]) > 8 ||
            Math.abs(now[i + 1] - base[i + 1]) > 8 ||
            Math.abs(now[i + 2] - base[i + 2]) > 8
          ) delta++;
        }
        return delta;
      },
      // Bounding box of changed pixels — measures each effect's real
      // rendered footprint so oversized effects can be found empirically.
      bbox: () => {
        if (!base) return null;
        const now = grab();
        const W = off.width;
        let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
        for (let i = 0; i < now.length; i += 4) {
          if (
            Math.abs(now[i] - base[i]) > 8 ||
            Math.abs(now[i + 1] - base[i + 1]) > 8 ||
            Math.abs(now[i + 2] - base[i + 2]) > 8
          ) {
            const p = i / 4;
            const px = p % W, py = Math.floor(p / W);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
        if (maxX < 0) return null;
        return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
      },
      start: (id: string) => {
        errors.length = 0;
        // Resolve exactly like the game does — hand-authored registry
        // first, generated interpreter second.
        const effect = getEffectById(id);
        if (!effect) return `no effect for ${id}`;
        try {
          this.handle = effect.apply(this, this.target, 1.4);
        } catch (err) {
          return `APPLY THROW: ${String(err)}`;
        }
        return null;
      },
      frames: () => this.frameCount,
      stop: () => {
        try {
          this.handle?.destroy();
        } catch (err) {
          return `DESTROY THROW: ${String(err)}`;
        } finally {
          this.handle = null;
        }
        return errors.length ? `TICK THROW: ${errors.join(' | ')}` : null;
      },
    };
    (window as unknown as { __scan: ScanApi }).__scan = api;
    (window as unknown as { __scene: Phaser.Scene }).__scene = this;
    // Catalog metadata for the capture pipeline / review page — full
    // merged set with the game's own name/rarity resolution.
    (window as unknown as { __catalog: unknown }).__catalog = getEffectGridEntries().map((e) => {
      const fx = getEffectById(e.id);
      return { id: e.id, name: fx?.name ?? e.id, category: e.category, rarity: fx?.rarity ?? 'common' };
    });
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  update(): void {
    this.frameCount++;
  }
}

new Phaser.Game({
  type: Phaser.AUTO, // match the game's config (game.ts uses AUTO)
  width: 480,
  height: 640,
  backgroundColor: '#101018',
  render: { preserveDrawingBuffer: true },
  scene: [ScanScene],
});
