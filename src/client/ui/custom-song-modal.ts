import { Scene, GameObjects } from 'phaser';
import {
  getSlot,
  saveSlot,
  clearSlot,
  type CustomSongSlot,
} from '@/services/custom-song-store';
import { detectBpm } from '@/services/bpm-detector';

/**
 * Rehearsal-only "Custom Song" modal. Player picks any audio file from
 * their device, scrubs to where they want the song to start, and the
 * modal saves the Blob + start offset + auto-detected BPM into the
 * one-slot IndexedDB store. Returns a SongPickerResult-shaped payload
 * so the caller (SongPickerModal) can route into the existing chart-gen
 * flow with audioKey = 'custom'.
 *
 * State machine (one modal, four screens):
 *   toggle    → only when slot exists: PLAY EXISTING / REPLACE
 *   pick-file → CHOOSE AUDIO FILE button + hidden <input type=file>
 *   set-time  → mm:ss start-time picker + PREVIEW + NEXT
 *   analyzing → "ANALYZING..." spinner while detectBpm runs
 *
 * Everything stays on the device — no upload, no server round-trip,
 * never visible to other players.
 */

export interface CustomSongResult {
  audioKey: 'custom';
  bpm: number;
  vibe: 'upbeat';
}

type Step = 'toggle' | 'pick-file' | 'set-time' | 'analyzing';

export class CustomSongModal {
  private container: GameObjects.Container | null = null;
  private stepChildren: GameObjects.GameObject[] = [];
  private htmlElements: HTMLElement[] = [];
  /** Active audio object during set-time scrubbing — torn down on close
   *  or step transition so the preview doesn't keep playing in the bg. */
  private audio: HTMLAudioElement | null = null;
  /** Pending file the player chose at pick-file step, carried into
   *  set-time. Cleared on close or back-to-pick-file. */
  private pendingFile: File | null = null;
  private pendingDurationSec = 0;
  private pendingStartSec = 0;
  private onDoneRef: ((result: CustomSongResult) => void) | null = null;
  private onCancelRef: (() => void) | null = null;

  constructor(private scene: Scene) {}

  open(args: {
    onDone: (result: CustomSongResult) => void;
    onCancel?: () => void;
  }): void {
    this.close();
    this.onDoneRef = args.onDone;
    this.onCancelRef = args.onCancel ?? null;

    const { width, height } = this.scene.scale;
    this.container = this.scene.add.container(0, 0).setDepth(400);
    const scrim = this.scene.add
      .rectangle(0, 0, width, height, 0x0b041a, 0.78)
      .setOrigin(0, 0)
      .setInteractive();
    scrim.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) =>
      e.stopPropagation(),
    );
    this.container.add(scrim);

    // Decide entry step based on slot presence.
    void getSlot().then((slot) => {
      if (!this.container) return;
      if (slot) this.renderToggle(slot);
      else this.renderPickFile();
    });
  }

  close(): void {
    this.tearDownStep();
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
    this.pendingFile = null;
    this.onDoneRef = null;
    this.onCancelRef = null;
  }

  destroy(): void {
    this.close();
  }

  // ─── Step rendering ────────────────────────────────────────────────────

  private renderChrome(title: string, subtitle: string): { panelX: number; panelY: number; panelW: number; panelH: number; cx: number } {
    this.tearDownStep();
    if (!this.container) return { panelX: 0, panelY: 0, panelW: 0, panelH: 0, cx: 0 };
    const { width, height } = this.scene.scale;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = Math.min(284, width - 24);
    const panelH = Math.min(360, height - 60);
    const panelX = cx - panelW / 2;
    const panelY = cy - panelH / 2;

    const panel = this.scene.add
      .rectangle(cx, cy, panelW, panelH, 0x1a0a2e, 1)
      .setStrokeStyle(2, 0xffd34d, 0.6);
    this.container.add(panel);
    this.stepChildren.push(panel);

    const titleTxt = this.scene.add
      .text(cx, panelY + 22, title, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '14px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    const subTxt = this.scene.add
      .text(cx, panelY + 42, subtitle, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '10px',
        color: '#c0a0e6',
        align: 'center',
        wordWrap: { width: panelW - 32 },
      })
      .setOrigin(0.5, 0);
    this.container.add([titleTxt, subTxt]);
    this.stepChildren.push(titleTxt, subTxt);

    // ✕ close button — top-right corner.
    const closeBg = this.scene.add
      .circle(panelX + panelW - 18, panelY + 18, 12, 0x0b041a, 0.85)
      .setStrokeStyle(1, 0xc0a0e6, 0.5)
      .setInteractive({ useHandCursor: true });
    const closeTxt = this.scene.add
      .text(panelX + panelW - 18, panelY + 18, '✕', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '12px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    closeBg.on('pointerdown', () => {
      const cb = this.onCancelRef;
      this.close();
      cb?.();
    });
    this.container.add([closeBg, closeTxt]);
    this.stepChildren.push(closeBg, closeTxt);

    return { panelX, panelY, panelW, panelH, cx };
  }

  private renderToggle(slot: CustomSongSlot): void {
    const { panelX, panelY, panelW, cx } = this.renderChrome(
      'CUSTOM SONG',
      'Saved to this device.\nPlay it again or replace it.',
    );
    if (!this.container) return;
    const playY = panelY + 110;
    const replaceY = playY + 60;

    const playBg = this.scene.add
      .rectangle(cx, playY, panelW - 48, 44, 0xffd34d, 1)
      .setInteractive({ useHandCursor: true });
    const playTxt = this.scene.add
      .text(cx, playY, '▶ PLAY EXISTING', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '13px',
        color: '#1a0a2e',
      })
      .setOrigin(0.5);
    playBg.on('pointerdown', () => {
      const cb = this.onDoneRef;
      this.close();
      cb?.({ audioKey: 'custom', bpm: slot.bpm, vibe: 'upbeat' });
    });

    const replaceBg = this.scene.add
      .rectangle(cx, replaceY, panelW - 48, 40, 0x2c1856, 1)
      .setStrokeStyle(1, 0xc678ff, 0.7)
      .setInteractive({ useHandCursor: true });
    const replaceTxt = this.scene.add
      .text(cx, replaceY, '↻ REPLACE', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '12px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    replaceBg.on('pointerdown', () => {
      void clearSlot().then(() => this.renderPickFile());
    });

    this.container.add([playBg, playTxt, replaceBg, replaceTxt]);
    this.stepChildren.push(playBg, playTxt, replaceBg, replaceTxt);
    void panelX;
  }

  private renderPickFile(): void {
    const { panelX, panelY, panelW, cx } = this.renderChrome(
      'UPLOAD CUSTOM SONG',
      'Pick any audio file from your device.\nStays here, no one else sees it.',
    );
    if (!this.container) return;

    const pickY = panelY + 130;
    const pickBg = this.scene.add
      .rectangle(cx, pickY, panelW - 48, 56, 0xffd34d, 1)
      .setInteractive({ useHandCursor: true });
    const pickTxt = this.scene.add
      .text(cx, pickY, '🎵  CHOOSE AUDIO FILE', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '13px',
        color: '#1a0a2e',
        align: 'center',
        wordWrap: { width: panelW - 64 },
      })
      .setOrigin(0.5);
    pickBg.on('pointerdown', () => fileInput.click());

    const hint = this.scene.add
      .text(cx, pickY + 50, 'mp3 · wav · m4a — under ~30 MB', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '9px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);

    this.container.add([pickBg, pickTxt, hint]);
    this.stepChildren.push(pickBg, pickTxt, hint);

    // Hidden HTML file input — triggered by the Phaser button click.
    // Kept offscreen so the native picker is the only visible affordance.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.position = 'absolute';
    fileInput.style.left = '-9999px';
    fileInput.style.top = '-9999px';
    document.body.appendChild(fileInput);
    this.htmlElements.push(fileInput);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.pendingFile = file;
      this.renderSetTime();
    });

    void panelX;
  }

  private renderSetTime(): void {
    if (!this.pendingFile) return;
    const { panelX, panelY, panelW, cx } = this.renderChrome(
      'PICK A START POINT',
      'Drag the slider or type mm:ss.\nPreview plays a few seconds from there.',
    );
    if (!this.container) return;

    // Load audio once so duration is known + preview is ready instantly.
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = URL.createObjectURL(this.pendingFile);
    this.audio = audio;
    this.htmlElements.push(audio);

    // Slider value display (mm:ss). Updated on slider input + text-box
    // edit so both inputs stay in sync.
    const sliderY = panelY + 130;
    const sliderLabelY = sliderY - 18;
    const timeLabel = this.scene.add
      .text(cx, sliderLabelY, 'START AT  0:00', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '12px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    this.container.add(timeLabel);
    this.stepChildren.push(timeLabel);

    // HTML range slider — touch-friendly on mobile, positioned over the
    // panel via the same canvas-rect math the comment modal uses.
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '0'; // updated once metadata loads
    slider.step = '1';
    slider.value = '0';
    slider.style.position = 'absolute';
    slider.style.zIndex = '9999';
    slider.style.accentColor = '#ffd34d';
    document.body.appendChild(slider);
    this.htmlElements.push(slider);

    // Text box for direct mm:ss entry — power-user affordance for when
    // the slider is too coarse on a long song.
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = '0:00';
    textInput.placeholder = 'mm:ss';
    textInput.style.position = 'absolute';
    textInput.style.zIndex = '9999';
    textInput.style.background = '#2c1856';
    textInput.style.color = '#ffffff';
    textInput.style.border = '1px solid #c678ff';
    textInput.style.padding = '4px 8px';
    textInput.style.fontFamily = 'monospace';
    textInput.style.fontSize = '13px';
    textInput.style.width = '70px';
    textInput.style.textAlign = 'center';
    document.body.appendChild(textInput);
    this.htmlElements.push(textInput);

    const sliderY2 = sliderY + 6;
    const textY = sliderY2 + 36;

    const positionOverlays = (): void => {
      const canvas = this.scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / this.scene.scale.width;
      const sy = rect.height / this.scene.scale.height;
      slider.style.left = `${rect.left + (panelX + 24) * sx}px`;
      slider.style.top = `${rect.top + sliderY2 * sy}px`;
      slider.style.width = `${(panelW - 48) * sx}px`;
      slider.style.height = `${24 * sy}px`;
      textInput.style.left = `${rect.left + (cx - 35) * sx}px`;
      textInput.style.top = `${rect.top + textY * sy}px`;
    };
    positionOverlays();
    const resizeHandler = (): void => positionOverlays();
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);

    const setStart = (sec: number, sync: 'slider' | 'text' | 'both'): void => {
      const clamped = Math.max(0, Math.min(this.pendingDurationSec, Math.round(sec)));
      this.pendingStartSec = clamped;
      timeLabel.setText(`START AT  ${formatMmss(clamped)}`);
      if (sync !== 'slider') slider.value = String(clamped);
      if (sync !== 'text') textInput.value = formatMmss(clamped);
    };

    audio.addEventListener('loadedmetadata', () => {
      this.pendingDurationSec = Math.floor(audio.duration);
      slider.max = String(this.pendingDurationSec);
    });
    slider.addEventListener('input', () => setStart(Number(slider.value), 'slider'));
    textInput.addEventListener('blur', () => {
      const sec = parseMmss(textInput.value);
      if (sec !== null) setStart(sec, 'text');
      else setStart(this.pendingStartSec, 'both'); // revert bad input
    });

    // PREVIEW + NEXT buttons at the bottom of the panel.
    const btnY = panelY + 260;
    const btnGap = 12;
    const btnW = (panelW - 48 - btnGap) / 2;

    const previewBg = this.scene.add
      .rectangle(cx - btnW / 2 - btnGap / 2, btnY, btnW, 40, 0x2c1856, 1)
      .setStrokeStyle(1, 0xc678ff, 0.7)
      .setInteractive({ useHandCursor: true });
    const previewTxt = this.scene.add
      .text(cx - btnW / 2 - btnGap / 2, btnY, '▶ PREVIEW', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '12px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    previewBg.on('pointerdown', () => {
      try {
        audio.currentTime = this.pendingStartSec;
        void audio.play();
        // Stop after 5s so the preview doesn't run forever.
        window.setTimeout(() => {
          if (!audio.paused) audio.pause();
        }, 5000);
      } catch {
        // ignore — preview is a nice-to-have, NEXT still works
      }
    });

    const nextBg = this.scene.add
      .rectangle(cx + btnW / 2 + btnGap / 2, btnY, btnW, 40, 0xffd34d, 1)
      .setInteractive({ useHandCursor: true });
    const nextTxt = this.scene.add
      .text(cx + btnW / 2 + btnGap / 2, btnY, 'NEXT', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '13px',
        color: '#1a0a2e',
      })
      .setOrigin(0.5);
    nextBg.on('pointerdown', () => this.runAnalysis());

    this.container.add([previewBg, previewTxt, nextBg, nextTxt]);
    this.stepChildren.push(previewBg, previewTxt, nextBg, nextTxt);
  }

  private renderAnalyzing(): void {
    const { panelY, cx } = this.renderChrome(
      'ANALYZING',
      'Finding the tempo so we can build your chart.\nTakes a couple seconds.',
    );
    if (!this.container) return;
    const dotsY = panelY + 160;
    const dots = this.scene.add
      .text(cx, dotsY, '◌ ◌ ◌', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '22px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    this.container.add(dots);
    this.stepChildren.push(dots);
    // Cheap animated spinner so the screen doesn't feel frozen during
    // decode. Tween cycles the dot color so it reads as "working".
    this.scene.tweens.add({
      targets: dots,
      alpha: { from: 0.4, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
  }

  private runAnalysis(): void {
    if (!this.pendingFile) return;
    const file = this.pendingFile;
    const startSec = this.pendingStartSec;
    this.renderAnalyzing();
    void detectBpm(file, startSec)
      .then(async (bpm) => {
        await saveSlot({ blob: file, startSec, bpm });
        const cb = this.onDoneRef;
        this.close();
        cb?.({ audioKey: 'custom', bpm, vibe: 'upbeat' });
      })
      .catch((err) => {
        console.warn('[CustomSongModal] BPM detect failed:', err);
        // Fall back to mid-band default so the player isn't stranded.
        const bpm = 120;
        void saveSlot({ blob: file, startSec, bpm }).then(() => {
          const cb = this.onDoneRef;
          this.close();
          cb?.({ audioKey: 'custom', bpm, vibe: 'upbeat' });
        });
      });
  }

  // ─── Teardown helpers ──────────────────────────────────────────────────

  private tearDownStep(): void {
    if (this.audio) {
      try {
        this.audio.pause();
        if (this.audio.src.startsWith('blob:')) URL.revokeObjectURL(this.audio.src);
      } catch {
        // ignore
      }
      this.audio = null;
    }
    for (const el of this.htmlElements) {
      try { el.remove(); } catch { /* ignore */ }
    }
    this.htmlElements = [];
    for (const child of this.stepChildren) child.destroy();
    this.stepChildren = [];
  }
}

function formatMmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseMmss(s: string): number | null {
  const t = s.trim();
  const match = t.match(/^(\d+):(\d{1,2})$/);
  if (!match) {
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  const mins = Number(match[1]!);
  const secs = Number(match[2]!);
  if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs < 0 || secs >= 60) return null;
  return mins * 60 + secs;
}
