import { Scene, Sound, Loader } from 'phaser';
import {
  BACKING_CATALOG,
  type Chart,
  type LaneId,
  type BackingTrack,
} from '@/../shared/state';
import { NoteSynth } from './note-synth';
import { getEffectiveMusicVolume, onUserSettingsChange } from './user-settings';
import { getSlot } from '@/services/custom-song-store';

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

// Backing pulse was removed after the synth-taps iteration. The short
// version of the design history: reactive amplification on tap fights
// audio output buffer latency (5-50ms), and pre-scheduled amplification
// aligned to the chart grid fights mismatch between chart beats and
// the song's actual rhythm (especially bad on lo-fi like Midnight
// Coffee which doesn't even have a strict beat grid). Neither approach
// produced a synced "punch". The per-song tap sample carries the
// impact on its own; if more oomph is needed it'll come from a
// standalone additive thump that doesn't depend on the song timing.

export class MusicSystem {
  private backing: Sound.BaseSound | null = null;
  private noteSynth: NoteSynth;
  private destroyed = false;
  /** Cached promise for the in-flight backing download. Calling preload()
   *  more than once for the same round is cheap — subsequent calls reuse
   *  this promise so start() and an upfront preload() resolve together. */
  private loadPromise: Promise<void> | null = null;
  /** Resolved custom-song slot (blob + startSec + bpm) for chart.audioKey
   *  === 'custom'. Cached so start() doesn't re-query IndexedDB. */
  private customSlot: { startSec: number } | null = null;
  /** Phaser audio cache key used for the loaded custom-song blob. Distinct
   *  from any catalog id so it doesn't collide. */
  private static readonly CUSTOM_KEY = 'custom-song';

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
    // Custom-song path: pull the Blob from IndexedDB and load it under
    // a fixed cache key. Always evict the previous custom-song entry
    // first so a player who REPLACEd their song doesn't accidentally
    // hear the old one (the cache key stays the same across replaces).
    if (this.chart.audioKey === 'custom') {
      this.loadPromise = this.preloadCustom();
      return this.loadPromise;
    }
    const backing = this.pickBacking();
    if (!backing) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    const cache = this.scene.cache.audio;
    if (cache.exists(backing.audioKey)) {
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
        if (file.key === backing.audioKey) {
          console.warn(`[MusicSystem] backing load failed: ${backing.audioKey}`);
        }
      };
      loader.audio(backing.audioKey, `assets/audio/backings/${backing.id}.mp3`);
      loader.once(Loader.Events.COMPLETE, onComplete);
      loader.on('loaderror', onError);
      if (!loader.isLoading()) loader.start();
    });
    return this.loadPromise;
  }

  private async preloadCustom(): Promise<void> {
    const slot = await getSlot();
    if (!slot) {
      // No slot means the player nuked it between scene start and now —
      // round goes silent. Logging here so console makes the cause clear.
      console.warn('[MusicSystem] custom-song slot missing, round will be silent');
      return;
    }
    this.customSlot = { startSec: slot.startSec };
    const cache = this.scene.cache.audio;
    // Evict the prior custom-song entry so a REPLACE between rounds
    // doesn't keep serving the stale Blob from cache.
    if (cache.exists(MusicSystem.CUSTOM_KEY)) cache.remove(MusicSystem.CUSTOM_KEY);
    return new Promise<void>((resolve) => {
      const loader = this.scene.load;
      const url = URL.createObjectURL(slot.blob);
      const onComplete = () => {
        loader.off('loaderror', onError);
        URL.revokeObjectURL(url);
        resolve();
      };
      const onError = (file: { key: string }) => {
        if (file.key === MusicSystem.CUSTOM_KEY) {
          console.warn('[MusicSystem] custom-song load failed');
        }
      };
      loader.audio(MusicSystem.CUSTOM_KEY, url);
      loader.once(Loader.Events.COMPLETE, onComplete);
      loader.on('loaderror', onError);
      if (!loader.isLoading()) loader.start();
    });
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
  async start(startOffsetMs: number = 0): Promise<void> {
    if (this.destroyed) return;
    await this.preload();
    if (this.destroyed) return;
    // Custom-song path: no catalog lookup, no loop. Seek = saved startSec
    // (the chunk the player wants to rehearse) + any in-chart offset
    // (rehearse-from-page in the editor — currently unreachable from
    // SongPicker but kept consistent with the catalog path).
    if (this.chart.audioKey === 'custom') {
      if (!this.customSlot) return;
      if (!this.scene.cache.audio.exists(MusicSystem.CUSTOM_KEY)) return;
      this.backing = this.scene.sound.add(MusicSystem.CUSTOM_KEY, {
        loop: false,
        volume: BACKING_VOLUME * getEffectiveMusicVolume(),
      });
      const seekSec = this.customSlot.startSec + startOffsetMs / 1000;
      this.backing.play({ seek: seekSec });
      this.settingsUnsubscribe = onUserSettingsChange(() => {
        if (!this.backing) return;
        const s = this.backing as Sound.WebAudioSound;
        s.setVolume(BACKING_VOLUME * getEffectiveMusicVolume());
      });
      return;
    }
    const backing = this.pickBacking();
    if (!backing) return;
    if (!this.scene.cache.audio.exists(backing.audioKey)) return;
    this.backing = this.scene.sound.add(backing.audioKey, {
      loop: true,
      volume: BACKING_VOLUME * getEffectiveMusicVolume(),
    });
    // Seek the backing track to startOffsetMs (modulo loop length) so
    // rehearse-from-editor lands the music where the chart picked up.
    // Plain Rehearse passes 0 = play from clip start as before.
    const playOpts: Sound.SoundConfig = {};
    if (startOffsetMs > 0) {
      // Sound.play accepts a `seek` config (seconds) to start mid-clip.
      // Modulo by loopDurationMs so a chart whose startStep crosses the
      // backing loop seam still lands inside the clip.
      const loopMs = backing.loopDurationMs || 65000;
      playOpts.seek = (startOffsetMs % loopMs) / 1000;
    }
    this.backing.play(playOpts);
    // Re-apply volume live when the user moves the volume slider or
    // flips mute. WebAudio Sound exposes a `volume` setter that takes
    // effect instantly. Listener torn down on destroy().
    this.settingsUnsubscribe = onUserSettingsChange(() => {
      if (!this.backing) return;
      const s = this.backing as Sound.WebAudioSound;
      s.setVolume(BACKING_VOLUME * getEffectiveMusicVolume());
    });
  }

  private settingsUnsubscribe: (() => void) | null = null;

  /**
   * Fire a tap sound in response to a successful lane tap. Two layers:
   *
   *   1. If the song has per-lane sample WAVs in cache (preloaded
   *      alongside the backing), play that — the sample is sliced from
   *      the song itself so its timbre matches the backing exactly.
   *   2. Otherwise fall back to NoteSynth's per-vibe synthesized tone.
   *
   * Songs without samples still feel coherent because the synth chooses
   * a waveform + envelope matched to the chart's vibe.
   */
  // Hit feedback is now JUST the sub-bass kick. Layered alternatives
  // (per-song tap sample, per-vibe synth tone) were both tied to song
  // dynamics one way or another — the sample disconnected during quiet
  // passages, the synth tone needed pitch awareness it couldn't get
  // from the chart vibe alone. The kick is content-independent, lands
  // the same regardless of what the song is doing, and feels punchy
  // without trying to be "of the song".
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  playTapForLane(_lane: LaneId): void {
    if (this.destroyed) return;
    this.noteSynth.playKick();
  }

  /**
   * Miss feedback — a brief low buzz so the player knows they missed
   * without the song losing momentum. Lane-independent; never uses
   * the per-song sample (would feel too rewarding for a miss).
   */
  playMiss(): void {
    if (this.destroyed) return;
    this.noteSynth.playMiss();
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
    this.settingsUnsubscribe?.();
    this.settingsUnsubscribe = null;
    this.noteSynth.destroy();
  }

  /** Pick the backing this chart should play. Priority:
   *   1. `chart.audioKey` exact match — the player picked a specific song
   *      via SongPickerModal. Hard match wins over bucket fallback.
   *   2. tempo + vibe bucket, hashed by the chart so the same saved
   *      chart always picks the same song deterministically.
   *   3. tempo-only bucket if the chosen vibe has no catalog entries.
   *
   *  Returns null only when the catalog has nothing at this tempo —
   *  triggers a silent round so the gameplay still works.
   */
  private pickBacking(): BackingTrack | null {
    if (this.chart.audioKey) {
      const exact = BACKING_CATALOG[this.chart.audioKey];
      if (exact) return exact;
    }
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
