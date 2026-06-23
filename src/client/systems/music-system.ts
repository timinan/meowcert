import { Scene, Sound, Loader } from 'phaser';
import {
  BACKING_CATALOG,
  type Chart,
  type LaneId,
  type BackingTrack,
} from '@/../shared/state';
import { NoteSynth } from './note-synth';

/**
 * Audio runtime for one round. Owns:
 *   - One looping backing instrumental (BGM, scene-owned, ~0.85 volume).
 *   - A NoteSynth that fires pitched tap tones tuned to the chart's
 *     vibe (replaces the meow stem sampler — see note-synth.ts).
 *
 * Lifecycle:
 *   const music = new MusicSystem(scene, chart);
 *   music.start();                        // kick the backing
 *   music.playTapForLane(0);              // on each successful hit
 *   music.stop();                         // round end
 *   music.destroy();                      // scene shutdown
 */
const BACKING_VOLUME = 0.85;

export class MusicSystem {
  private backing: Sound.BaseSound | null = null;
  private noteSynth: NoteSynth;
  private destroyed = false;
  /** Cached promise for the in-flight backing download. Calling preload()
   *  more than once for the same round is cheap — subsequent calls reuse
   *  this promise so start() and an upfront preload() resolve together. */
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly chart: Chart,
  ) {
    this.noteSynth = new NoteSynth(scene);
  }

  /**
   * Begin downloading the resolved backing track for this round. Idempotent
   * — call once from Game.create() to kick off the download in parallel
   * with scene setup, then start() awaits the same promise. Resolves
   * immediately if the asset is already cached.
   *
   * Errors are swallowed (resolves anyway) so a failed download produces
   * a silent round rather than a stuck modal.
   */
  preload(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const backing = this.pickBacking();
    if (!backing) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    if (this.scene.cache.audio.exists(backing.audioKey)) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    this.loadPromise = new Promise<void>((resolve) => {
      const loader = this.scene.load;
      const onComplete = () => {
        loader.off('loaderror', onError);
        resolve();
      };
      const onError = (file: { key: string }) => {
        if (file.key !== backing.audioKey) return;
        console.warn(`[MusicSystem] backing load failed: ${backing.audioKey}`);
        loader.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      };
      loader.audio(backing.audioKey, `assets/audio/backings/${backing.id}.mp3`);
      loader.once(Loader.Events.COMPLETE, onComplete);
      loader.once('loaderror', onError);
      if (!loader.isLoading()) loader.start();
    });
    return this.loadPromise;
  }

  /**
   * Start the backing track for this round. Awaits the lazy load if
   * needed — typically a no-op because Game.create kicked preload off
   * earlier and the file's already in cache by the time the player
   * taps PLAY on the Ready modal.
   *
   * No-op if the chart's BPM has no matching backing in the catalog
   * (silent round; meow taps still fire).
   */
  async start(): Promise<void> {
    if (this.destroyed) return;
    await this.preload();
    if (this.destroyed) return;
    const backing = this.pickBacking();
    if (!backing) return;
    if (!this.scene.cache.audio.exists(backing.audioKey)) return;
    this.backing = this.scene.sound.add(backing.audioKey, {
      loop: true,
      volume: BACKING_VOLUME,
    });
    this.backing.play();
  }

  /**
   * Fire a tap tone in response to a successful lane tap. NoteSynth
   * picks the per-vibe preset (upbeat / melodic / smooth) and the
   * per-lane frequency within that preset, then schedules one
   * oscillator + envelope on the audio clock.
   */
  playTapForLane(lane: LaneId): void {
    if (this.destroyed) return;
    this.noteSynth.play(this.chart.vibe, lane);
  }

  /** Stop the backing track immediately. Pending meow one-shots will
   *  finish playing — they're cheap and brief, no need to interrupt. */
  stop(): void {
    if (this.backing) {
      this.backing.stop();
    }
  }

  /** Full teardown — call from the scene's SHUTDOWN handler. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.backing) {
      this.backing.stop();
      this.backing.destroy();
      this.backing = null;
    }
    this.noteSynth.destroy();
  }

  /** Pick the backing this chart should play. Filters by tempo AND
   *  player-picked vibe; falls back to "any vibe at this tempo" if the
   *  chart has no vibe yet (old saves) or the chosen vibe has no
   *  catalog entries. Stable per saved version of the chart — the hash
   *  includes `updatedAt`, so saving again may roll a different
   *  backing within the same tempo+vibe bucket. */
  private pickBacking(): BackingTrack | null {
    const sameTempo = Object.values(BACKING_CATALOG).filter(
      (b) => b.bpm === this.chart.bpm,
    );
    if (sameTempo.length === 0) return null;
    let candidates = sameTempo;
    if (this.chart.vibe) {
      const sameVibe = sameTempo.filter((b) => b.vibe === this.chart.vibe);
      if (sameVibe.length > 0) candidates = sameVibe;
    }
    if (candidates.length === 1) return candidates[0]!;
    const hash = hashString(
      `${this.chart.authorId}:${this.chart.bpm}:${this.chart.vibe ?? ''}:${this.chart.updatedAt}`,
    );
    return candidates[hash % candidates.length]!;
  }

}

/** Tiny deterministic string hash. Good enough for picking-a-bucket
 *  use cases — never use for security. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
