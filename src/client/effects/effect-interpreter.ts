/**
 * effect-interpreter.ts
 *
 * Runtime driver for the 441 data-driven effects generated from the
 * smoketest into `src/shared/effect-catalog-gen.ts`. Each metadata entry
 * has a `kind` string + `params` blob; runKind() dispatches to a Phaser
 * renderer that matches the smoketest's vanilla-canvas visuals as closely
 * as feasible.
 *
 * Design:
 *   - Every kind returns { destroy, pulseHit?, pulseMiss? } (matches
 *     EffectHandle from cat-effects.ts).
 *   - Renderers use Phaser Graphics + tweens + POST_UPDATE for parity with
 *     the existing makeGlow / makeParticles style. Depth is always
 *     `target.depth - 1` so effects sit behind the cat (matches the
 *     "cat always on top" rule Tim established on 2026-06-30).
 *   - Kinds not yet fully implemented fall back to `runFallback()` which
 *     paints a soft colored aura so equipping doesn't crash. Follow-up
 *     sessions fill each remaining renderer in place.
 */
import { Scene, Scenes, GameObjects, Tweens } from 'phaser';
import type { EffectHandle, EffectTarget, CatEffect } from './cat-effects';
import type { EffectMeta } from '@/shared/effect-catalog-gen';
// (aliased under src/client/shared/ — see tsconfig paths)

const REST_INTENSITY = 0.55;
const HIT_INTENSITY = 1.0;
const MISS_INTENSITY = 0.3;
const PULSE_DECAY_MS = 600;

function footPosition(target: EffectTarget): { x: number; y: number } {
  return {
    x: target.x,
    y: target.y + target.displayHeight * (1 - target.originY),
  };
}

// Body-mid Y — used by halos/rings/pulses so they wrap the cat's torso.
function midPosition(target: EffectTarget): { x: number; y: number } {
  return {
    x: target.x,
    y: target.y - target.displayHeight * (target.originY - 0.5),
  };
}

// Interpolate two 0xRRGGBB colors.
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
function cycleColor(colors: number[], t: number, cycleMs: number): number {
  const n = colors.length;
  if (n === 1) return colors[0];
  const phase = (t / cycleMs) % 1;
  const seg = 1 / n;
  const idx = Math.floor(phase / seg);
  const segP = (phase - idx * seg) / seg;
  return lerpColor(colors[idx], colors[(idx + 1) % n], segP);
}

// ===========================================================================
// STAGELIGHT (solid + multicolor cycling)
// ===========================================================================
function runStagelight(
  scene: Scene, target: EffectTarget, scale: number,
  colors: number[], cycleMs = 2400,
): EffectHandle {
  const baseWidth = 56 * scale;
  const tipWidth = 10 * scale;
  const flameHeight = 96 * scale;
  const sliceThick = 10 * scale;
  const slices = 40;
  const g = scene.add.graphics().setDepth(target.depth - 1);
  g.alpha = REST_INTENSITY;

  const draw = (color: number): void => {
    g.clear();
    for (let i = 0; i < slices; i++) {
      const t = i / (slices - 1);
      const y = -t * flameHeight;
      const w = baseWidth + (tipWidth - baseWidth) * t;
      const alpha = 0.24 * (1 - t * 0.8);
      g.fillStyle(color, alpha);
      g.fillEllipse(0, y, w, sliceThick);
    }
  };
  const sync = (): void => { const p = footPosition(target); g.setPosition(p.x, p.y); };

  let lastColor = -1;
  const onUpdate = (): void => {
    sync();
    if (colors.length === 1) {
      if (lastColor !== colors[0]) { draw(colors[0]); lastColor = colors[0]; }
    } else {
      const c = cycleColor(colors, scene.time.now, cycleMs);
      if (c !== lastColor) { draw(c); lastColor = c; }
    }
  };
  scene.events.on(Scenes.Events.POST_UPDATE, onUpdate);
  onUpdate();

  const flicker = scene.tweens.add({
    targets: g, scaleX: 1.08, duration: 380,
    delay: Math.random() * 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, onUpdate);
    flicker.stop(); flicker.remove(); g.destroy();
  });
}

// ===========================================================================
// STAGELIGHT SPATIAL SPLIT (N vertical bands across flame width)
// ===========================================================================
function runStagelightSplit(
  scene: Scene, target: EffectTarget, scale: number, colors: number[],
): EffectHandle {
  const baseWidth = 56 * scale;
  const tipWidth = 10 * scale;
  const flameHeight = 96 * scale;
  const sliceThick = 10 * scale;
  const slices = 40;
  const n = colors.length;
  const g = scene.add.graphics().setDepth(target.depth - 1);
  g.alpha = REST_INTENSITY;

  const draw = (): void => {
    g.clear();
    for (let i = 0; i < slices; i++) {
      const t = i / (slices - 1);
      const y = -t * flameHeight;
      const w = baseWidth + (tipWidth - baseWidth) * t;
      const alpha = 0.24 * (1 - t * 0.8);
      const segW = w / n;
      for (let k = 0; k < n; k++) {
        const cx = -w / 2 + segW * k + segW / 2;
        g.fillStyle(colors[k], alpha);
        g.fillEllipse(cx, y, segW, sliceThick);
      }
    }
  };
  const sync = (): void => { const p = footPosition(target); g.setPosition(p.x, p.y); };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync(); draw();

  const flicker = scene.tweens.add({
    targets: g, scaleX: 1.08, duration: 380,
    delay: Math.random() * 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    flicker.stop(); flicker.remove(); g.destroy();
  });
}

// ===========================================================================
// HALO — ring around head/mid/feet with optional rotating bead
// ===========================================================================
type HaloParams = {
  color: number; radius: number; thickness?: number; pos?: 'head'|'mid'|'feet';
  glow?: boolean; alpha?: number; rotateMs?: number; tiltOscMs?: number;
  shape?: 'ellipse'|'segments'; segments?: number; reverse?: boolean;
  beadColor?: number; rotateBead?: boolean;
};
function runHalo(scene: Scene, target: EffectTarget, scale: number, p: HaloParams): EffectHandle {
  const g = scene.add.graphics().setDepth(target.depth - 1);
  const radius = p.radius * scale;
  const thickness = p.thickness ?? 3;
  const posMode = p.pos ?? 'mid';
  const baseSquash = p.shape === 'ellipse' ? 0.32 : 0.55;
  const dir = p.reverse ? -1 : 1;

  const draw = (t: number): void => {
    g.clear();
    const squashAmp = p.tiltOscMs ? 0.12 * Math.sin(t / p.tiltOscMs) : 0;
    const squash = baseSquash + squashAmp;
    const rotate = p.rotateMs ? (t / p.rotateMs) * Math.PI * 2 * dir : 0;
    g.lineStyle(thickness, p.color, p.alpha ?? 0.85);
    if (p.shape === 'segments') {
      const n = p.segments ?? 12;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + rotate;
        const a1 = a0 + (Math.PI * 2) / n * 0.7;
        g.beginPath();
        g.arc(0, 0, radius, a0, a1);
        g.strokePath();
      }
    } else {
      g.strokeEllipse(0, 0, radius * 2, radius * 2 * squash);
      if (p.glow) {
        g.lineStyle(thickness * 3, p.color, 0.18);
        g.strokeEllipse(0, 0, radius * 2, radius * 2 * squash);
      }
    }
    // rotation bead
    const beadA = (t / (p.rotateMs || 2400)) * Math.PI * 2 * dir;
    const beadC = p.beadColor ?? p.color;
    g.fillStyle(beadC, 1);
    g.fillCircle(Math.cos(beadA) * radius, Math.sin(beadA) * radius * squash, 3);
    g.fillStyle(beadC, 0.35);
    g.fillCircle(Math.cos(beadA) * radius, Math.sin(beadA) * radius * squash, 7);
  };

  const sync = (): void => {
    let x = target.x;
    let y: number;
    if (posMode === 'feet') y = footPosition(target).y + 4;
    else if (posMode === 'head') y = target.y - target.displayHeight * target.originY - 8;
    else y = midPosition(target).y;
    g.setPosition(x, y);
    draw(scene.time.now);
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    g.destroy();
  });
}

// ===========================================================================
// SATURN (two counter-rotating halos)
// ===========================================================================
function runSaturn(scene: Scene, target: EffectTarget, scale: number, args: unknown[]): EffectHandle {
  const [a, b] = args as [number, number];
  const h1 = runHalo(scene, target, scale, {
    color: a, radius: 38, thickness: 3, pos: 'mid', shape: 'ellipse',
    glow: true, rotateMs: 4800, tiltOscMs: 2400,
  });
  const h2 = runHalo(scene, target, scale, {
    color: b, radius: 28, thickness: 2, pos: 'mid', shape: 'ellipse',
    glow: true, rotateMs: 3600, tiltOscMs: 2000, reverse: true,
  });
  return {
    destroy: () => { h1.destroy(); h2.destroy(); },
    pulseHit: () => { h1.pulseHit?.(); h2.pulseHit?.(); },
    pulseMiss: () => { h1.pulseMiss?.(); h2.pulseMiss?.(); },
  };
}

// ===========================================================================
// GROUND PORTAL (radial spiral at feet)
// ===========================================================================
type PortalParams = { args: [number, number, number, number] };
function runPortal(scene: Scene, target: EffectTarget, scale: number, p: PortalParams): EffectHandle {
  const [core, ring, mid, pulse] = p.args ?? [0xa64dff, 0xd6b6ff, 0x8833dd, 0xff88cc];
  const g = scene.add.graphics().setDepth(target.depth - 1);
  const draw = (t: number): void => {
    g.clear();
    const portalR = 44 * scale;
    // background radial
    for (let step = 0; step < 20; step++) {
      const r = portalR * (step / 20);
      const alpha = 0.75 * (1 - step / 20);
      const col = step < 10 ? core : mid;
      g.fillStyle(col, alpha * 0.3);
      g.fillEllipse(0, 0, r * 2, r * 2 * 0.36);
    }
    // rotating spiral arms
    g.lineStyle(2, ring, 0.85);
    for (let arm = 0; arm < 3; arm++) {
      const armPhase = (arm / 3) * Math.PI * 2;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2; a += 0.1) {
        const r = (a / (Math.PI * 2)) * portalR;
        const angle = a + t / 1400 + armPhase;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r * 0.36;
        if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokePath();
    }
    // concentric pulses
    for (let i = 0; i < 3; i++) {
      const phase = ((t / 1500 + i / 3) % 1);
      const r = phase * portalR;
      g.lineStyle(2, pulse, (1 - phase) * 0.6);
      g.strokeEllipse(0, 0, r * 2, r * 2 * 0.36);
    }
  };
  const sync = (): void => {
    const p = footPosition(target); g.setPosition(p.x, p.y + 2); draw(scene.time.now);
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    g.destroy();
  });
}

// ===========================================================================
// RING OF DOTS (12 dots orbiting body mid) + emoji variant
// ===========================================================================
function runRingOfDots(scene: Scene, target: EffectTarget, scale: number, color: number | 'rainbow'): EffectHandle {
  const g = scene.add.graphics().setDepth(target.depth - 1);
  const draw = (t: number): void => {
    g.clear();
    const r = 38 * scale;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t / 1500;
      const wobble = 1 + 0.1 * Math.sin(t / 200 + i);
      const px = Math.cos(a) * r * wobble;
      const py = Math.sin(a) * r * 0.4 * wobble;
      const dotColor = color === 'rainbow'
        ? Phaser.Display.Color.HSVToRGB(((i * 30 + t / 20) % 360) / 360, 0.95, 1).color as unknown as number
        : color;
      g.fillStyle(dotColor, 0.85);
      g.fillCircle(px, py, 4);
    }
  };
  const sync = (): void => {
    const p = midPosition(target); g.setPosition(p.x, p.y); draw(scene.time.now);
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    g.destroy();
  });
}

function runRingEmoji(scene: Scene, target: EffectTarget, scale: number, glyph: string): EffectHandle {
  const texts: GameObjects.Text[] = [];
  for (let i = 0; i < 12; i++) {
    const t = scene.add.text(0, 0, glyph, {
      fontSize: `${Math.round(16 * scale)}px`, resolution: 0.42, padding: { x: 3, y: 4 },
    }).setOrigin(0.5).setDepth(target.depth - 1);
    t.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    texts.push(t);
  }
  const sync = (): void => {
    const p = midPosition(target);
    const r = 38 * scale;
    const now = scene.time.now;
    texts.forEach((tx, i) => {
      const a = (i / 12) * Math.PI * 2 + now / 1500;
      tx.setPosition(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.4);
    });
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return {
    destroy: () => {
      scene.events.off(Scenes.Events.POST_UPDATE, sync);
      texts.forEach(t => t.destroy());
    },
  };
}

// ===========================================================================
// ORBITER (emoji text orbiting sprite)
// ===========================================================================
type OrbiterParams = {
  glyph: string; count: number; radius: number; pos?: 'mid'|'head'|'feet';
  size?: number; speedMs?: number; flatten?: number;
};
function runOrbiter(scene: Scene, target: EffectTarget, scale: number, p: OrbiterParams): EffectHandle {
  const n = p.count ?? 5;
  const speedMs = p.speedMs ?? 2400;
  const flatten = p.flatten ?? 0.4;
  const sz = Math.round((p.size ?? 14) * scale);
  const texts: GameObjects.Text[] = [];
  for (let i = 0; i < n; i++) {
    const t = scene.add.text(0, 0, p.glyph, {
      fontSize: `${sz}px`, resolution: 0.42, padding: { x: 3, y: 4 },
    }).setOrigin(0.5).setDepth(target.depth - 1);
    t.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    texts.push(t);
  }
  const sync = (): void => {
    const posMode = p.pos ?? 'mid';
    let cx = target.x;
    let cy: number;
    if (posMode === 'feet') cy = footPosition(target).y;
    else if (posMode === 'head') cy = target.y - target.displayHeight * target.originY - 4;
    else cy = midPosition(target).y;
    const r = (p.radius ?? 32) * scale;
    const now = scene.time.now;
    texts.forEach((tx, i) => {
      const a = (now / speedMs) * Math.PI * 2 + (i / n) * Math.PI * 2;
      tx.setPosition(cx + Math.cos(a) * r, cy + Math.sin(a) * r * flatten);
    });
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return {
    destroy: () => {
      scene.events.off(Scenes.Events.POST_UPDATE, sync);
      texts.forEach(t => t.destroy());
    },
  };
}

// ===========================================================================
// PULSE (heart / sonar / echo / semicircle radio)
// ===========================================================================
type PulseParams = {
  color: number; maxR?: number; intervalMs?: number; lifeMs?: number;
  shape?: 'ring'|'heart'|'semicircle'; thickness?: number; pos?: 'feet'|'mid';
  flatness?: number; alpha?: number;
};
function runPulse(scene: Scene, target: EffectTarget, scale: number, p: PulseParams): EffectHandle {
  const g = scene.add.graphics().setDepth(target.depth - 1);
  const pulses: { start: number }[] = [];
  let lastSpawn = -1e9;
  const interval = p.intervalMs ?? 900;
  const life = p.lifeMs ?? 1500;
  const maxR = (p.maxR ?? 44) * scale;
  const shape = p.shape ?? 'ring';
  const thickness = p.thickness ?? 3;
  const alphaBase = p.alpha ?? 0.85;
  const flatness = p.flatness ?? 0.32;

  const draw = (t: number): void => {
    g.clear();
    if (t - lastSpawn > interval) { pulses.push({ start: t }); lastSpawn = t; }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pu = pulses[i];
      const age = (t - pu.start) / life;
      if (age >= 1) { pulses.splice(i, 1); continue; }
      const r = maxR * age;
      const alpha = (1 - age) * alphaBase;
      g.lineStyle(thickness, p.color, alpha);
      if (shape === 'heart') {
        const sc = r / 30;
        g.beginPath();
        for (let a = 0; a <= Math.PI * 2; a += 0.1) {
          const hx = 16 * Math.pow(Math.sin(a), 3);
          const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
          const px = hx * sc, py = hy * sc;
          if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.strokePath();
      } else if (shape === 'semicircle') {
        g.beginPath();
        g.arc(0, 0, r, Math.PI, 0);
        g.strokePath();
      } else {
        g.strokeEllipse(0, 0, r * 2, r * 2 * flatness);
      }
    }
  };
  const sync = (): void => {
    const pos = p.pos === 'mid' ? midPosition(target) : footPosition(target);
    g.setPosition(pos.x, pos.y);
    draw(scene.time.now);
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    g.destroy();
  });
}

// ===========================================================================
// TINT (color-cycle over sprite via setTint)
// ===========================================================================
type TintParams = { args: [string, number[]?, number?, number?] };
function runTint(scene: Scene, target: EffectTarget, scale: number, p: TintParams): EffectHandle {
  const [mode, colors, cycleMs = 2400, alphaScale = 1] = p.args as [string, number[] | undefined, number | undefined, number | undefined];
  const asSprite = target as unknown as GameObjects.Sprite;
  const setTintFn = (asSprite.setTint as unknown) as (c: number) => void;
  const clearTintFn = (asSprite.clearTint as unknown) as () => void;
  if (!setTintFn) return runFallback(scene, target, scale);

  const originalHasTint = !!(asSprite as any).tintTopLeft;
  const originalTint = originalHasTint ? (asSprite as any).tintTopLeft : 0xffffff;

  const applyTint = (): void => {
    const t = scene.time.now;
    if (mode === 'rainbow') {
      const hue = ((t / (cycleMs || 1200)) * 360) % 360;
      const rgb = Phaser.Display.Color.HSVToRGB(hue / 360, 0.95, 0.9);
      setTintFn.call(asSprite, (rgb as any).color);
    } else if (mode === 'strobe') {
      const phase = Math.floor(t / 120) % 2;
      setTintFn.call(asSprite, phase ? 0xffffff : originalTint);
    } else if (mode === 'inverted-flash') {
      const phase = (t / 1200) % 1;
      if (phase < 0.18) setTintFn.call(asSprite, 0x333333);
      else setTintFn.call(asSprite, 0xffffff);
    } else if (mode === 'flash' && colors) {
      const c = cycleColor(colors, t, cycleMs || 3600);
      setTintFn.call(asSprite, c);
    } else {
      setTintFn.call(asSprite, 0xffffff);
    }
  };
  scene.events.on(Scenes.Events.POST_UPDATE, applyTint);
  applyTint();
  return {
    destroy: () => {
      scene.events.off(Scenes.Events.POST_UPDATE, applyTint);
      clearTintFn.call(asSprite);
    },
  };
}

// ===========================================================================
// LIGHTNING (colored, on dark background with strike flash)
// ===========================================================================
function runLightning(
  scene: Scene, target: EffectTarget, scale: number,
  glowRgb = '255,228,77', coreRgb = '255,255,255',
): EffectHandle {
  const g = scene.add.graphics().setDepth(target.depth + 1);
  const dark = scene.add.graphics().setDepth(target.depth - 1);
  type Strike = { untilT: number; main: [number, number][]; branches: [number, number][][] };
  const strikes: Strike[] = [];

  const buildBolt = (originX: number, originY: number): Strike => {
    const main: [number, number][] = [];
    let x = originX, y = originY - 200;
    main.push([x, y]);
    while (y < originY) {
      x += (Math.random() - 0.5) * 30;
      y += 8 + Math.random() * 14;
      main.push([x, y]);
    }
    const branches: [number, number][][] = [];
    const nB = 1 + Math.floor(Math.random() * 3);
    for (let b = 0; b < nB; b++) {
      const si = 1 + Math.floor(Math.random() * (main.length - 2));
      let [bx, by] = main[si];
      const branch: [number, number][] = [[bx, by]];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const len = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < len; i++) {
        bx += dir * (8 + Math.random() * 16);
        by += 4 + Math.random() * 10;
        branch.push([bx, by]);
      }
      branches.push(branch);
    }
    return { untilT: scene.time.now + 150, main, branches };
  };

  const [gr, gg, gb] = glowRgb.split(',').map(n => parseInt(n));
  const [cr, cg, cb] = coreRgb.split(',').map(n => parseInt(n));
  const glowInt = (gr << 16) | (gg << 8) | gb;
  const coreInt = (cr << 16) | (cg << 8) | cb;

  const draw = (): void => {
    g.clear(); dark.clear();
    const t = scene.time.now;
    if (Math.random() < 0.09 && strikes.length < 4) {
      strikes.push(buildBolt(target.x, target.y));
    }
    // dark bg — smaller footprint, over the entire scene view
    dark.fillStyle(0x000000, 0.85);
    dark.fillRect(-1000, -1000, 3000, 3000);
    const hasLive = strikes.some(s => t <= s.untilT);
    const drawPath = (pts: [number, number][], gAlpha: number, gW: number, cAlpha: number): void => {
      g.lineStyle(gW, glowInt, gAlpha);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.strokePath();
      g.lineStyle(gW * 0.3, coreInt, cAlpha);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.strokePath();
    };
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i];
      if (t > s.untilT) { strikes.splice(i, 1); continue; }
      drawPath(s.main, 0.6, 5, 0.95);
      for (const br of s.branches) drawPath(br, 0.45, 3, 0.7);
    }
    if (hasLive) {
      g.fillStyle(coreInt, 0.22);
      g.fillRect(-1000, -1000, 3000, 3000);
    }
  };
  scene.events.on(Scenes.Events.POST_UPDATE, draw);
  draw();
  return {
    destroy: () => {
      scene.events.off(Scenes.Events.POST_UPDATE, draw);
      g.destroy(); dark.destroy();
    },
  };
}

// ===========================================================================
// FALLBACK (soft colored aura for kinds not yet fully implemented)
// ===========================================================================
function runFallback(scene: Scene, target: EffectTarget, scale: number, color = 0xa64dff): EffectHandle {
  const g = scene.add.graphics().setDepth(target.depth - 1);
  const sync = (): void => {
    g.clear();
    const p = footPosition(target);
    g.setPosition(p.x, p.y);
    g.fillStyle(color, 0.25);
    g.fillCircle(0, -40 * scale, 30 * scale);
    g.fillStyle(color, 0.14);
    g.fillCircle(0, -40 * scale, 50 * scale);
  };
  scene.events.on(Scenes.Events.POST_UPDATE, sync);
  sync();
  return withPulse(scene, g, () => {
    scene.events.off(Scenes.Events.POST_UPDATE, sync);
    g.destroy();
  });
}

// ===========================================================================
// PULSE HIT/MISS mixin — every runX above wraps final teardown through this
// ===========================================================================
function withPulse(scene: Scene, g: GameObjects.Graphics, destroyFn: () => void): EffectHandle {
  g.alpha = REST_INTENSITY;
  let pulseT: Tweens.Tween | null = null;
  let decayT: Tweens.Tween | null = null;
  const pulseTo = (peak: number): void => {
    pulseT?.stop(); decayT?.stop();
    pulseT = scene.tweens.add({
      targets: g, alpha: peak, duration: 80, ease: 'Quad.easeOut',
      onComplete: () => {
        decayT = scene.tweens.add({
          targets: g, alpha: REST_INTENSITY,
          duration: PULSE_DECAY_MS, ease: 'Sine.easeOut',
        });
      },
    });
  };
  return {
    destroy: () => {
      pulseT?.stop(); pulseT?.remove();
      decayT?.stop(); decayT?.remove();
      destroyFn();
    },
    pulseHit: () => pulseTo(HIT_INTENSITY),
    pulseMiss: () => pulseTo(MISS_INTENSITY),
  };
}

// ===========================================================================
// DISPATCH — kind → run function
// ===========================================================================
export function runKind(
  meta: EffectMeta,
  scene: Scene,
  target: EffectTarget,
  scale: number,
): EffectHandle {
  const params = meta.impl.params as Record<string, unknown>;
  switch (meta.impl.kind) {
    case 'stagelight': {
      const colors = (params.colors as number[]) ?? [0xffe44d];
      const cycleMs = (params.cycleMs as number) ?? 2400;
      return runStagelight(scene, target, scale, colors, cycleMs);
    }
    case 'stagelight_split': {
      const colors = (params.colors as number[]) ?? [0xff3333, 0x3399ff];
      return runStagelightSplit(scene, target, scale, colors);
    }
    case 'halo':
      return runHalo(scene, target, scale, params as unknown as HaloParams);
    case 'halo_saturn':
      return runSaturn(scene, target, scale, (params.args as unknown[]) ?? []);
    case 'halo_portal':
      return runPortal(scene, target, scale, params as unknown as PortalParams);
    case 'halo_ring_of_dots':
      return runRingOfDots(scene, target, scale, 0xff8833);
    case 'halo_ring_emoji':
      return runRingEmoji(scene, target, scale, (params.glyph as string) ?? '🔥');
    case 'orbiter':
      return runOrbiter(scene, target, scale, params as unknown as OrbiterParams);
    case 'pulse':
    case 'sonar_pro':
    case 'sonar_pro_multi':
    case 'heart_multi':
    case 'radio_multi':
      return runPulse(scene, target, scale, params as unknown as PulseParams);
    case 'tint':
      return runTint(scene, target, scale, params as unknown as TintParams);
    case 'lightning_colored': {
      const args = (params.args as unknown[]) ?? [];
      return runLightning(scene, target, scale, (args[0] as string), (args[1] as string));
    }
    default:
      // Fallback color derived from category so at least each category has
      // a distinct look until we implement the kind properly.
      return runFallback(scene, target, scale, catFallbackColor(meta.category));
  }
}

function catFallbackColor(category: string): number {
  switch (category) {
    case 'Beams': return 0xffe44d;
    case 'Pulse Waves': return 0xff66cc;
    case 'Floor / Ground': return 0xa64dff;
    case 'Weather': return 0x66ccff;
    case 'Decorative': return 0xffffff;
    case 'Misc / Extras': return 0x33ffe6;
    default: return 0xa64dff;
  }
}

// Convert an EffectMeta from the generated catalog into a CatEffect the rest
// of the runtime can consume identically to the hand-authored entries.
export function makeCatEffectFromMeta(meta: EffectMeta): CatEffect {
  return {
    id: meta.id,
    name: meta.name,
    iconEmoji: meta.iconEmoji,
    rarity: meta.rarity,
    apply(scene, target, scale = 1) {
      return runKind(meta, scene, target, scale);
    },
    burst(scene, target, scale = 1) {
      // Reuse the apply's first ~200 ms for a light burst feel — most of the
      // meta-driven effects don't need a distinct burst pattern.
      const h = runKind(meta, scene, target, scale);
      scene.time.delayedCall(220, () => h.destroy());
    },
  };
}
