import { GameObjects, Scene, Scenes, Sound } from 'phaser';
import { THEME_CATALOG } from '@/../shared/state';
import type { ThemeEntry, ThemeId } from '@/../shared/state';

/**
 * Owns the backdrop image + music track for the active theme.
 *
 * `applyTheme(id)` swaps the backdrop and the music track.
 * Call `destroy()` on scene shutdown so the audio doesn't leak across restarts.
 */
export class ThemeManager {
  private backdrop: GameObjects.Image | null = null;
  private music: Sound.BaseSound | null = null;
  private currentThemeId: ThemeId | null = null;

  constructor(private scene: Scene) {
    // Belt-and-suspenders: if the scene shuts down without an explicit destroy()
    // call (e.g. uncaught error path), still clean up audio so it can't leak.
    scene.events.once(Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  applyTheme(id: ThemeId): void {
    if (id === this.currentThemeId) return;

    const entry = THEME_CATALOG.find((t: ThemeEntry) => t.id === id);
    if (!entry) {
      console.warn(`[ThemeManager] unknown theme id: ${id}, falling back to default`);
      return this.applyTheme('default');
    }

    this.swapBackdrop(entry);
    this.swapMusic(entry);
    this.currentThemeId = id;
  }

  private swapBackdrop(entry: ThemeEntry): void {
    const { width, height } = this.scene.scale;
    if (this.backdrop) {
      this.backdrop.setTexture(entry.backdropKey);
    } else {
      this.backdrop = this.scene.add
        .image(width / 2, height / 2, entry.backdropKey)
        .setDepth(-1000)
        .setDisplaySize(width, height);
    }
  }

  private swapMusic(entry: ThemeEntry): void {
    if (this.music) {
      this.music.stop();
      this.music.destroy();
      this.music = null;
    }
    this.music = this.scene.sound.add(entry.musicKey, { loop: true, volume: 0.4 });
    this.music.play();
  }

  destroy(): void {
    this.backdrop?.destroy();
    this.music?.stop();
    this.music?.destroy();
    this.backdrop = null;
    this.music = null;
    this.currentThemeId = null;
  }
}
