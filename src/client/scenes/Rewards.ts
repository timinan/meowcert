import { GameObjects, Scene, Scenes, Tweens } from 'phaser';
import { SceneKeys, type SceneKey } from '@/constants/scenes';
import { TopHud } from '@/ui/top-hud';
import { buildMenuItems } from '@/ui/menu-items';
import { playLanternMusic } from '@/systems/home-music';
import {
  collectRewards,
  claimQuest,
  claimQuestBonus,
  claimStreak,
  claimWeekly,
  claimWeeklyBonus,
  claimAchievement,
} from '@/services/state-client';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_TIERS,
  ACHIEVEMENT_TIER_REWARDS,
  tierThreshold,
  type AchievementDef,
  type AchievementId,
  type AchievementTier,
} from '@/../shared/achievements';
import {
  dailyQuestsFor,
  STREAK_TRACK,
  WEEKLY_QUEST_POOL,
  WEEKLY_BONUS_COINS,
  type DailyQuest,
  type WeeklyQuest,
} from '@/../shared/quests';
import { BOX_CATALOG, type BoxConfig, type BoxId, type PlayerState } from '@/../shared/state';

/**
 * Rewards scene — the 🎁 REWARDS destination from the hamburger drawer.
 * Replaces the old rewards drawer overlay with a full scene that owns its
 * own TopHud and a three-tab layout: DAILY · WEEKLY · TROPHIES.
 *
 * Layout top-to-bottom:
 *   TopHud → BACK chip → collect banner (pinned on every tab) → tab chips
 *   → bodyRoot (the active tab's content).
 *
 * This task (1) ports the DAILY tab 1:1 from the modal (collect pot, daily
 * quests, login streak, box choosers). WEEKLY and TROPHIES render a small
 * "coming soon" placeholder — Tasks 4 and 7 fill them in, reusing
 * `openTierChooser` and `renderTabBody`.
 */
// TROPHIES scroll geometry. The list (one row per ACHIEVEMENTS entry) is
// taller than the tab body, so it uses the repo's canonical Phaser-4 scroll
// pattern (DressingRoom.ts): rows live in a far-away world band only a
// dedicated grid camera looks at, and that camera's viewport is the tab-body
// rect — GPU scissor clips the rows pixel-perfectly at the body edges.
// Geometry masks are silent no-ops under Phaser-4 WebGL, hence the camera.
const TROPHY_WORLD_OFF = 100000;
const TROPHY_ROW_H = 60;
const TROPHY_ROW_GAP = 8;
const TROPHY_ROW_STRIDE = TROPHY_ROW_H + TROPHY_ROW_GAP;
const TROPHY_TOP_PAD = 8;

export class Rewards extends Scene {
  private playerState: PlayerState | null = null;
  private fromScene: SceneKey = SceneKeys.Game;
  private activeTab: 'daily' | 'weekly' | 'trophies' = 'daily';
  private topHud: TopHud | null = null;
  private uiRoot: GameObjects.Container | null = null; // banner + tabs, rebuilt on adopt
  private bodyRoot: GameObjects.Container | null = null; // active tab content
  private chooser: GameObjects.Container | null = null; // depth 470 overlay
  private busy = false;
  private isoToday = new Date().toISOString().slice(0, 10);
  private flyTweens: Tweens.Tween[] = [];

  // Collect-card refs, repainted into their 0/N states by setPotState().
  private potText: GameObjects.Text | null = null;
  private collectBg: GameObjects.Rectangle | null = null;
  private collectLabel: GameObjects.Text | null = null;
  private cardCX = 0;
  private cardCY = 0;
  private cardW = 0;

  // TROPHIES scroll state — the dedicated grid camera + its live row objects.
  // scrollY is scene state so it survives claim rebuilds; rows are scene-level
  // world objects (like DressingRoom cells), not children of bodyRoot.
  private trophyCam: Phaser.Cameras.Scene2D.Camera | null = null;
  private trophyCells: GameObjects.GameObject[] = [];
  private trophyScrollbar: GameObjects.Rectangle | null = null;
  private trophyScrollY = 0;
  private trophyViewTop = 0;
  private trophyViewH = 0;
  private trophyDragActive = false;
  private trophyDragLastY = 0;
  private trophyDragMoved = 0;
  private trophyDragVelocity = 0;
  private trophyDragLastT = 0;
  private trophyMomentum: Tweens.Tween | null = null;
  private trophyInputBound = false;
  private trophyOnDown: ((p: Phaser.Input.Pointer) => void) | null = null;
  private trophyOnMove: ((p: Phaser.Input.Pointer) => void) | null = null;
  private trophyOnUp: (() => void) | null = null;
  private trophyOnWheel: ((p: unknown, o: unknown, dx: number, dy: number) => void) | null = null;

  // One emoji per reward category — drives the data-driven tier chooser
  // so adding a SKU changes the chooser with zero UI edits.
  private static readonly CHOOSER_EMOJI: Record<BoxConfig['category'], string> = {
    cat: '🐱',
    cosmetic: '🎀',
    effect: '✨',
    background: '🖼',
  };

  constructor() {
    super(SceneKeys.Rewards);
  }

  init(data?: { playerState?: PlayerState | null; fromScene?: SceneKey; isoToday?: string }): void {
    this.playerState = data?.playerState ?? null;
    this.fromScene = data?.fromScene ?? SceneKeys.Game;
    this.isoToday = data?.isoToday ?? new Date().toISOString().slice(0, 10);
    this.busy = false;
    // Reset transient refs — the same scene instance is reused across
    // restarts, so stale handles (a lingering `chooser` especially) would
    // otherwise block reopening after a re-entry.
    this.activeTab = 'daily';
    this.topHud = null;
    this.uiRoot = null;
    this.bodyRoot = null;
    this.chooser = null;
    this.potText = null;
    this.collectBg = null;
    this.collectLabel = null;
    this.flyTweens = [];
    this.trophyCam = null;
    this.trophyCells = [];
    this.trophyScrollbar = null;
    this.trophyScrollY = 0;
    this.trophyMomentum = null;
    this.trophyInputBound = false;
    this.trophyDragActive = false;
  }

  create(): void {
    playLanternMusic(this);
    const { width, height } = this.scale;

    this.add.rectangle(0, 0, width, height, 0x0b041a, 1).setOrigin(0, 0);
    this.events.once(Scenes.Events.SHUTDOWN, () => this.shutdown());

    this.topHud = new TopHud(this, {
      showStats: true,
      currentKey: SceneKeys.Rewards,
      items: buildMenuItems(this, () => this.playerState),
    });
    this.topHud.setCoins(this.playerState?.coins ?? 0);

    this.drawBackChip();

    this.uiRoot = this.add.container(0, 0);
    this.bodyRoot = this.add.container(0, 0);
    this.buildChrome();
    this.renderTabBody();
  }

  /** Top-left BACK chip — returns to the scene the player came from,
   *  handing it the adopted playerState (Decorate.ts:172-193 pattern). */
  private drawBackChip(): void {
    const x = 38;
    const y = TopHud.HEIGHT + 18;
    const bg = this.add
      .rectangle(x, y, 56, 24, 0x2c1856, 1)
      .setStrokeStyle(1, 0xc0a0e6, 0.6)
      .setInteractive({ useHandCursor: true })
      .setDepth(2100);
    const txt = this.add
      .text(x, y, '← BACK', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '10px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5)
      .setDepth(2101);
    void txt;
    bg.on('pointerover', () => bg.setFillStyle(0x3d2566, 1));
    bg.on('pointerout', () => bg.setFillStyle(0x2c1856, 1));
    bg.on('pointerdown', () => {
      this.scene.start(this.fromScene, { playerState: this.playerState });
    });
  }

  // -- chrome: collect banner + tab chips (rebuilt on adopt) -------------

  private buildChrome(): void {
    if (!this.uiRoot) return;
    this.uiRoot.removeAll(true);
    this.potText = null;
    this.collectBg = null;
    this.collectLabel = null;

    const { width } = this.scale;
    const cx = width / 2;
    const rowW = width - 24;

    // --- collect pot banner (pinned on every tab) ---------------------
    const cardTop = TopHud.HEIGHT + 40;
    const cardH = 96;
    this.cardW = rowW;
    this.cardCX = cx;
    this.cardCY = cardTop + cardH / 2;

    const card = this.add
      .rectangle(this.cardCX, this.cardCY, this.cardW, cardH, 0x2c1856, 1)
      .setStrokeStyle(2, 0xffd34d, 0.85);
    this.uiRoot.add(card);

    this.potText = this.add
      .text(this.cardCX, this.cardCY - 26, '', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '11px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: this.cardW - 28 },
      })
      .setOrigin(0.5);
    this.uiRoot.add(this.potText);

    this.collectBg = this.add
      .rectangle(this.cardCX, this.cardCY + 26, 150, 34, 0xffd34d, 1)
      .setStrokeStyle(2, 0x0b041a, 0.9)
      .setInteractive({ useHandCursor: true });
    this.collectBg.on('pointerdown', () => void this.onCollect());
    this.uiRoot.add(this.collectBg);

    this.collectLabel = this.add
      .text(this.cardCX, this.cardCY + 26, 'COLLECT', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '14px',
        color: '#0b041a',
      })
      .setOrigin(0.5);
    this.uiRoot.add(this.collectLabel);

    // --- tab chips row (DailyRoom slot-tab styling) -------------------
    const chipsTop = cardTop + cardH + 14;
    const chipH = 26;
    const gap = 6;
    const leftX = cx - rowW / 2;
    const chipW = (rowW - gap * 2) / 3;
    const tabs: Array<{ key: 'daily' | 'weekly' | 'trophies'; label: string }> = [
      { key: 'daily', label: 'DAILY' },
      { key: 'weekly', label: 'WEEKLY' },
      { key: 'trophies', label: 'TROPHIES' },
    ];
    tabs.forEach((tab, i) => {
      const x = leftX + i * (chipW + gap);
      const isActive = this.activeTab === tab.key;
      const bg = this.add
        .rectangle(x, chipsTop, chipW, chipH, isActive ? 0x4d2d8c : 0x0b041a, isActive ? 1 : 0.55)
        .setOrigin(0, 0)
        .setStrokeStyle(isActive ? 2 : 1, isActive ? 0xffd34d : 0xc0a0e6, isActive ? 1 : 0.25)
        .setInteractive({ useHandCursor: true });
      const txt = this.add
        .text(x + chipW / 2, chipsTop + chipH / 2, tab.label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '11px',
          color: isActive ? '#ffd34d' : '#c0a0e6',
        })
        .setOrigin(0.5);
      this.uiRoot!.add([bg, txt]);
      bg.on('pointerdown', () => {
        if (this.activeTab === tab.key) return;
        this.activeTab = tab.key;
        this.buildChrome();
        this.renderTabBody();
      });
    });

    const pot = this.playerState?.economy?.pendingCollect ?? 0;
    this.setPotState(pot);
  }

  /** Y where the active tab's body starts, just below the chip row. */
  private bodyTop(): number {
    return TopHud.HEIGHT + 40 + 96 + 14 + 26 + 16;
  }

  // -- tab bodies --------------------------------------------------------

  private renderTabBody(): void {
    if (!this.bodyRoot) return;
    this.bodyRoot.removeAll(true);
    // Trophies owns a dedicated camera + scene-level world objects. Any tab
    // that isn't trophies must tear that down (camera, cells, listeners).
    if (this.activeTab !== 'trophies') this.teardownTrophies();
    if (this.activeTab === 'daily') this.renderDaily();
    else if (this.activeTab === 'weekly') this.renderWeekly();
    else this.renderTrophies();
  }

  private renderDaily(): void {
    const { width } = this.scale;
    const cx = width / 2;
    const rowW = width - 24;
    const top = this.bodyTop();
    this.renderQuestsSection(cx, top, rowW);
    this.renderStreakSection(cx, top + 142, rowW);
  }

  private sectionHeader(cx: number, y: number, w: number, text: string): void {
    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2, y, text, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '11px',
          color: '#ffd34d',
        })
        .setOrigin(0, 0.5),
    );
  }

  /** DAILY QUESTS — 3 rows for today's quests + an all-3 bonus row. */
  private renderQuestsSection(cx: number, top: number, w: number): void {
    this.sectionHeader(cx, top, w, '🗓  DAILY QUESTS');
    const daily = this.playerState?.economy?.daily;
    const progress = daily?.questProgress ?? {};
    const claimed = daily?.questClaimed ?? {};
    const quests = dailyQuestsFor(this.isoToday);

    const rowStride = 30;
    quests.forEach((q, i) => {
      this.addQuestRow(
        cx,
        top + 22 + i * rowStride,
        w,
        q,
        progress[q.id] ?? 0,
        claimed[q.id] === true,
      );
    });

    const claimedCount = quests.filter((q) => claimed[q.id] === true).length;
    this.addBonusRow(
      cx,
      top + 22 + quests.length * rowStride,
      w,
      claimedCount,
      daily?.questBonusClaimed === true,
    );
  }

  private addQuestRow(
    cx: number,
    cy: number,
    w: number,
    quest: DailyQuest,
    progress: number,
    claimed: boolean,
  ): void {
    const rowH = 26;
    const complete = progress >= quest.target;
    const bg = this.add
      .rectangle(cx, cy, w, rowH, 0x120726, 1)
      .setStrokeStyle(1, complete && !claimed ? 0xffd34d : 0xc0a0e6, complete && !claimed ? 0.7 : 0.4);
    this.bodyRoot!.add(bg);

    const labelColor = claimed ? '#6b8a6b' : complete ? '#ffffff' : '#c0a0e6';
    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2 + 10, cy, quest.label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontSize: '10px',
          color: labelColor,
        })
        .setOrigin(0, 0.5),
    );

    const rightX = cx + w / 2 - 10;
    if (claimed) {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, '✓ CLAIMED', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '9px',
            color: '#7ee08a',
          })
          .setOrigin(1, 0.5),
      );
    } else if (complete) {
      // Gold CLAIM button — label doubles as the reward (+N coins).
      const btnW = 60;
      const btnH = 20;
      const btnCX = rightX - btnW / 2;
      const btnBg = this.add
        .rectangle(btnCX, cy, btnW, btnH, 0xffd34d, 1)
        .setStrokeStyle(2, 0x0b041a, 0.9)
        .setInteractive({ useHandCursor: true });
      btnBg.on('pointerdown', () => void this.onClaimQuest(quest.id));
      this.bodyRoot!.add(btnBg);
      this.bodyRoot!.add(
        this.add
          .text(btnCX, cy, `+${quest.coins}`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '11px',
            color: '#0b041a',
          })
          .setOrigin(0.5),
      );
    } else {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, `${progress}/${quest.target}`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '11px',
            color: '#c0a0e6',
          })
          .setOrigin(1, 0.5),
      );
    }
  }

  private addBonusRow(
    cx: number,
    cy: number,
    w: number,
    claimedCount: number,
    bonusClaimed: boolean,
  ): void {
    const rowH = 26;
    const unlocked = claimedCount >= 3;
    const bg = this.add
      .rectangle(cx, cy, w, rowH, 0x1c1030, 1)
      .setStrokeStyle(1, unlocked && !bonusClaimed ? 0xffd34d : 0xc0a0e6, unlocked && !bonusClaimed ? 0.8 : 0.35);
    this.bodyRoot!.add(bg);

    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2 + 10, cy, '🎁 ALL 3 → FREE BOX', {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '10px',
          color: bonusClaimed ? '#6b8a6b' : unlocked ? '#ffd34d' : '#c0a0e6',
        })
        .setOrigin(0, 0.5),
    );

    const rightX = cx + w / 2 - 10;
    if (bonusClaimed) {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, '✓ CLAIMED', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '9px',
            color: '#7ee08a',
          })
          .setOrigin(1, 0.5),
      );
    } else if (unlocked) {
      const btnW = 66;
      const btnH = 20;
      const btnCX = rightX - btnW / 2;
      const btnBg = this.add
        .rectangle(btnCX, cy, btnW, btnH, 0xffd34d, 1)
        .setStrokeStyle(2, 0x0b041a, 0.9)
        .setInteractive({ useHandCursor: true });
      btnBg.on('pointerdown', () =>
        this.openTierChooser('standard', 'PICK YOUR BOX', (boxId) => void this.onBonusPick(boxId)),
      );
      this.bodyRoot!.add(btnBg);
      this.bodyRoot!.add(
        this.add
          .text(btnCX, cy, 'CHOOSE', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '10px',
            color: '#0b041a',
          })
          .setOrigin(0.5),
      );
    } else {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, `${claimedCount}/3`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '11px',
            color: '#c0a0e6',
          })
          .setOrigin(1, 0.5),
      );
    }
  }

  // -- weekly tab --------------------------------------------------------

  /** Milliseconds until next Monday 00:00 UTC, as "Resets in Nd Nh". */
  private weeklyResetLabel(): string {
    const now = new Date();
    const day = now.getUTCDay() || 7;
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (8 - day));
    const ms = next - now.getTime();
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    return `Resets in ${d}d ${h}h`;
  }

  private renderWeekly(): void {
    const { width } = this.scale;
    const cx = width / 2;
    const rowW = width - 24;
    const top = this.bodyTop();

    // Header line: title on the left, reset countdown on the right.
    this.sectionHeader(cx, top, rowW, '📅  WEEKLY QUESTS');
    this.bodyRoot!.add(
      this.add
        .text(cx + rowW / 2, top, this.weeklyResetLabel(), {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontSize: '9px',
          color: '#c0a0e6',
        })
        .setOrigin(1, 0.5),
    );

    const weekly = this.playerState?.economy?.weekly;
    const progress = weekly?.progress ?? {};
    const claimed = weekly?.claimed ?? {};

    const rowStride = 30;
    WEEKLY_QUEST_POOL.forEach((q, i) => {
      this.addWeeklyRow(
        cx,
        top + 24 + i * rowStride,
        rowW,
        q,
        progress[q.id] ?? 0,
        claimed[q.id] === true,
      );
    });

    const allClaimed = WEEKLY_QUEST_POOL.every((q) => claimed[q.id] === true);
    this.addWeeklyBonusRow(
      cx,
      top + 24 + WEEKLY_QUEST_POOL.length * rowStride,
      rowW,
      allClaimed,
      weekly?.bonusClaimed === true,
    );
  }

  private addWeeklyRow(
    cx: number,
    cy: number,
    w: number,
    quest: WeeklyQuest,
    progress: number,
    claimed: boolean,
  ): void {
    const rowH = 26;
    const complete = progress >= quest.target;
    const bg = this.add
      .rectangle(cx, cy, w, rowH, 0x120726, 1)
      .setStrokeStyle(1, complete && !claimed ? 0xffd34d : 0xc0a0e6, complete && !claimed ? 0.7 : 0.4);
    this.bodyRoot!.add(bg);

    const labelColor = claimed ? '#6b8a6b' : complete ? '#ffffff' : '#c0a0e6';
    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2 + 10, cy, quest.label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontSize: '9px',
          color: labelColor,
        })
        .setOrigin(0, 0.5),
    );

    const rightX = cx + w / 2 - 10;

    // Per-quest reward (coins + a golden box), shown until the row is claimed.
    if (!claimed) {
      this.bodyRoot!.add(
        this.add
          .text(rightX - 66, cy, `🪙${quest.coins} + 🎁`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontSize: '9px',
            color: '#8f80b0',
          })
          .setOrigin(1, 0.5),
      );
    }

    if (claimed) {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, '✓ CLAIMED', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '9px',
            color: '#7ee08a',
          })
          .setOrigin(1, 0.5),
      );
    } else if (complete) {
      // Gold CLAIM button — every weekly claim picks a golden box first.
      const btnW = 56;
      const btnH = 20;
      const btnCX = rightX - btnW / 2;
      const btnBg = this.add
        .rectangle(btnCX, cy, btnW, btnH, 0xffd34d, 1)
        .setStrokeStyle(2, 0x0b041a, 0.9)
        .setInteractive({ useHandCursor: true });
      btnBg.on('pointerdown', () =>
        this.openTierChooser('golden', 'PICK YOUR GOLDEN BOX', (boxId) =>
          void this.onClaimWeekly(quest.id, boxId),
        ),
      );
      this.bodyRoot!.add(btnBg);
      this.bodyRoot!.add(
        this.add
          .text(btnCX, cy, 'CLAIM', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '11px',
            color: '#0b041a',
          })
          .setOrigin(0.5),
      );
    } else {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, `${progress}/${quest.target}`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '11px',
            color: '#c0a0e6',
          })
          .setOrigin(1, 0.5),
      );
    }
  }

  private addWeeklyBonusRow(
    cx: number,
    cy: number,
    w: number,
    unlocked: boolean,
    bonusClaimed: boolean,
  ): void {
    const rowH = 26;
    const bg = this.add
      .rectangle(cx, cy, w, rowH, 0x1c1030, 1)
      .setStrokeStyle(1, unlocked && !bonusClaimed ? 0xffd34d : 0xc0a0e6, unlocked && !bonusClaimed ? 0.8 : 0.35);
    this.bodyRoot!.add(bg);

    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2 + 10, cy, `🎁 ALL ${WEEKLY_QUEST_POOL.length} → GOLDEN BOX + ${WEEKLY_BONUS_COINS}`, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '10px',
          color: bonusClaimed ? '#6b8a6b' : unlocked ? '#ffd34d' : '#c0a0e6',
        })
        .setOrigin(0, 0.5),
    );

    const rightX = cx + w / 2 - 10;
    if (bonusClaimed) {
      this.bodyRoot!.add(
        this.add
          .text(rightX, cy, '✓ CLAIMED', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '9px',
            color: '#7ee08a',
          })
          .setOrigin(1, 0.5),
      );
    } else if (unlocked) {
      const btnW = 66;
      const btnH = 20;
      const btnCX = rightX - btnW / 2;
      const btnBg = this.add
        .rectangle(btnCX, cy, btnW, btnH, 0xffd34d, 1)
        .setStrokeStyle(2, 0x0b041a, 0.9)
        .setInteractive({ useHandCursor: true });
      btnBg.on('pointerdown', () =>
        this.openTierChooser('golden', 'PICK YOUR GOLDEN BOX', (boxId) =>
          void this.onWeeklyBonus(boxId),
        ),
      );
      this.bodyRoot!.add(btnBg);
      this.bodyRoot!.add(
        this.add
          .text(btnCX, cy, 'CHOOSE', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '10px',
            color: '#0b041a',
          })
          .setOrigin(0.5),
      );
    }
  }

  /** LOGIN STREAK — 7 pips + reward label + CLAIM when claimable. */
  private renderStreakSection(cx: number, top: number, w: number): void {
    this.sectionHeader(cx, top, w, '🔥  LOGIN STREAK');
    const streak = this.playerState?.economy?.streak ?? {
      lastDay: '',
      count: 0,
      lastClaimedDay: '',
    };
    const count = Math.max(0, Math.min(7, streak.count));
    const activeToday = streak.lastDay === this.isoToday;
    const claimedToday = streak.lastClaimedDay === this.isoToday;
    const claimable = activeToday && !claimedToday && count >= 1;

    // 7 pips across the row width; filled up to `count`, today ringed.
    const pipsY = top + 26;
    const slot = w / 7;
    for (let i = 0; i < 7; i++) {
      const px = cx - w / 2 + slot * (i + 0.5);
      const filled = i < count;
      const isToday = claimable && i === count - 1;
      const pip = this.add
        .circle(px, pipsY, isToday ? 9 : 8, filled ? 0xffd34d : 0x3a2b52, 1)
        .setStrokeStyle(2, isToday ? 0xffffff : 0x0b041a, isToday ? 1 : 0.6);
      this.bodyRoot!.add(pip);
      this.bodyRoot!.add(
        this.add
          .text(px, pipsY, String(i + 1), {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '9px',
            color: filled ? '#0b041a' : '#7a6699',
          })
          .setOrigin(0.5),
      );
    }

    // Reward label (left) + CLAIM button (right).
    const rowY = top + 54;
    const reward = STREAK_TRACK[Math.max(0, count - 1)] ?? 25;
    let label: string;
    if (claimable) {
      label = count === 7 ? `Day 7: +${reward} 🪙 + Golden box` : `Day ${count}: +${reward} 🪙`;
    } else if (claimedToday) {
      label = `Day ${count} claimed ✓ — back tomorrow`;
    } else {
      label = 'Log in daily to earn coins';
    }
    this.bodyRoot!.add(
      this.add
        .text(cx - w / 2, rowY, label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontSize: '10px',
          color: claimable ? '#ffffff' : '#c0a0e6',
        })
        .setOrigin(0, 0.5),
    );

    if (claimable) {
      const btnW = 72;
      const btnH = 24;
      const btnCX = cx + w / 2 - btnW / 2;
      const btnBg = this.add
        .rectangle(btnCX, rowY, btnW, btnH, 0xffd34d, 1)
        .setStrokeStyle(2, 0x0b041a, 0.9)
        .setInteractive({ useHandCursor: true });
      // Day 7: open the golden box chooser first; other days claim immediately.
      btnBg.on('pointerdown', () => {
        if (count === 7) {
          this.openTierChooser('golden', 'PICK YOUR GOLDEN BOX', (boxId) =>
            void this.onClaimStreak(boxId),
          );
        } else {
          void this.onClaimStreak();
        }
      });
      this.bodyRoot!.add(btnBg);
      this.bodyRoot!.add(
        this.add
          .text(btnCX, rowY, 'CLAIM', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '12px',
            color: '#0b041a',
          })
          .setOrigin(0.5),
      );
    }
  }

  // -- trophies tab (camera-clipped scrolling achievement list) ---------

  /** Render the whole achievement list into the far-away world band and
   *  point the grid camera's viewport at the tab-body rect. Rebuilt on
   *  entry and after every claim; trophyScrollY is preserved and clamped so
   *  a claim doesn't jump the list. Rows never leave the band, so scrolling
   *  is pure camera pan (setTrophyScroll) — no per-frame rebuild needed. */
  private renderTrophies(): void {
    const { width, height } = this.scale;
    this.trophyViewTop = this.bodyTop() - 8;
    this.trophyViewH = height - this.trophyViewTop - 12;

    // Fresh camera + cells every render (claim rebuild included). Cheap: the
    // list is small, and a fresh camera avoids any stale-viewport drift.
    this.destroyTrophyObjects();
    this.trophyCam = this.cameras.add(0, this.trophyViewTop, width, this.trophyViewH);
    this.trophyScrollY = Math.max(0, Math.min(this.trophyMaxScroll(), this.trophyScrollY));
    this.trophyCam.setScroll(0, TROPHY_WORLD_OFF + this.trophyScrollY);

    const cx = width / 2;
    const rowW = width - 24;
    ACHIEVEMENTS.forEach((def, i) => {
      const cy = TROPHY_WORLD_OFF + TROPHY_TOP_PAD + i * TROPHY_ROW_STRIDE + TROPHY_ROW_H / 2;
      this.buildTrophyRow(def, cx, cy, rowW);
    });

    // Thin scroll indicator on the body's right edge (main camera object —
    // it sits at normal world coords, so the grid camera never sees it).
    this.trophyScrollbar = this.add
      .rectangle(width - 6, this.trophyViewTop, 3, 40, 0xc0a0e6, 0.45)
      .setOrigin(0.5, 0)
      .setDepth(5);
    this.updateTrophyScrollbar();

    this.setupTrophyScrollInput();
  }

  private trophyMaxScroll(): number {
    const total = ACHIEVEMENTS.length * TROPHY_ROW_STRIDE + TROPHY_TOP_PAD;
    return Math.max(0, total - this.trophyViewH);
  }

  private setTrophyScroll(v: number): void {
    this.trophyScrollY = Math.max(0, Math.min(this.trophyMaxScroll(), v));
    this.trophyCam?.setScroll(0, TROPHY_WORLD_OFF + this.trophyScrollY);
    this.updateTrophyScrollbar();
  }

  private updateTrophyScrollbar(): void {
    if (!this.trophyScrollbar) return;
    const max = this.trophyMaxScroll();
    this.trophyScrollbar.setVisible(max > 0);
    if (max <= 0) return;
    const frac = this.trophyViewH / (max + this.trophyViewH);
    const barH = Math.max(24, this.trophyViewH * frac);
    this.trophyScrollbar.setSize(3, barH);
    this.trophyScrollbar.y = this.trophyViewTop + (this.trophyViewH - barH) * (this.trophyScrollY / max);
  }

  /** Scene-level drag / momentum / wheel scroll, gated to the body rect.
   *  Bound once per trophies entry; `trophyDragMoved` lets medal taps tell a
   *  flick-scroll from a real tap (DressingRoom pattern). */
  private setupTrophyScrollInput(): void {
    if (this.trophyInputBound) return;
    this.trophyOnDown = (p: Phaser.Input.Pointer) => {
      if (
        p.y < this.trophyViewTop - TROPHY_ROW_GAP ||
        p.y > this.trophyViewTop + this.trophyViewH
      )
        return;
      this.trophyMomentum?.stop();
      this.trophyMomentum = null;
      this.trophyDragActive = true;
      this.trophyDragLastY = p.y;
      this.trophyDragMoved = 0;
      this.trophyDragVelocity = 0;
      this.trophyDragLastT = this.time.now;
    };
    this.trophyOnMove = (p: Phaser.Input.Pointer) => {
      if (!this.trophyDragActive) return;
      const dy = p.y - this.trophyDragLastY;
      if (dy === 0) return;
      const now = this.time.now;
      const dt = Math.max(1, now - this.trophyDragLastT);
      this.trophyDragVelocity = dy / dt;
      this.trophyDragLastY = p.y;
      this.trophyDragLastT = now;
      this.trophyDragMoved += Math.abs(dy);
      this.setTrophyScroll(this.trophyScrollY - dy);
    };
    this.trophyOnUp = () => {
      if (!this.trophyDragActive) return;
      this.trophyDragActive = false;
      const v = this.trophyDragVelocity;
      if (Math.abs(v) > 0.25 && this.trophyMaxScroll() > 0) {
        const proxy = { v: this.trophyScrollY };
        this.trophyMomentum = this.tweens.add({
          targets: proxy,
          v: this.trophyScrollY - v * 260,
          duration: 480,
          ease: 'Quad.easeOut',
          onUpdate: () => this.setTrophyScroll(proxy.v),
        });
      }
    };
    this.trophyOnWheel = (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.trophyMaxScroll() > 0) this.setTrophyScroll(this.trophyScrollY + dy * 0.6);
    };
    this.input.on('pointerdown', this.trophyOnDown);
    this.input.on('pointermove', this.trophyOnMove);
    this.input.on('pointerup', this.trophyOnUp);
    this.input.on('wheel', this.trophyOnWheel);
    this.trophyInputBound = true;
  }

  /** One achievement row in grid-camera world space: name · 🥉🥈🥇 medal
   *  chips (filled = claimed, hollow gold ring = reached-unclaimed/tappable,
   *  grey = unreached) · progress bar + `value / next-threshold` label. */
  private buildTrophyRow(def: AchievementDef, cx: number, cy: number, w: number): void {
    const p = this.playerState;
    const value = p ? def.progress(p) : 0;
    const claimedTiers = p?.economy?.achievementsClaimed?.[def.id] ?? [];
    const goldClaimed = claimedTiers.includes('gold');
    const anyClaimable = ACHIEVEMENT_TIERS.some(
      (t) => value >= tierThreshold(def, t) && !claimedTiers.includes(t),
    );

    const bg = this.add
      .rectangle(cx, cy, w, TROPHY_ROW_H, 0x120726, 1)
      .setStrokeStyle(1, anyClaimable ? 0xffd34d : 0xc0a0e6, anyClaimable ? 0.7 : 0.35);
    this.trophyCells.push(bg);

    // Name (top-left).
    this.trophyCells.push(
      this.add
        .text(cx - w / 2 + 12, cy - 15, def.name, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '11px',
          color: anyClaimable ? '#ffd34d' : '#ffffff',
        })
        .setOrigin(0, 0.5),
    );

    // Medal chips (top-right), one per tier.
    const emojis: Record<AchievementTier, string> = { bronze: '🥉', silver: '🥈', gold: '🥇' };
    const medalY = cy - 14;
    ACHIEVEMENT_TIERS.forEach((tier, ti) => {
      const mx = cx + w / 2 - 16 - (ACHIEVEMENT_TIERS.length - 1 - ti) * 24;
      const reached = value >= tierThreshold(def, tier);
      const claimed = claimedTiers.includes(tier);
      const claimable = reached && !claimed;

      if (claimed) {
        // Filled: solid gold disc behind a full-strength medal.
        this.trophyCells.push(this.add.circle(mx, medalY, 11, 0xffd34d, 0.85));
      } else if (claimable) {
        // Hollow: gold ring stroke only, medal at full strength + tappable.
        const ring = this.add
          .circle(mx, medalY, 11, 0x000000, 0)
          .setStrokeStyle(2, 0xffd34d, 1)
          .setInteractive({ useHandCursor: true });
        ring.on('pointerup', () => {
          if (this.trophyDragMoved >= 8) return;
          this.startAchievementClaim(def, tier);
        });
        this.trophyCells.push(ring);
      }

      const medal = this.add
        .text(mx, medalY, emojis[tier], { fontSize: '15px' })
        .setOrigin(0.5)
        .setAlpha(reached ? 1 : 0.22);
      if (claimable) {
        medal.setInteractive({ useHandCursor: true });
        medal.on('pointerup', () => {
          if (this.trophyDragMoved >= 8) return;
          this.startAchievementClaim(def, tier);
        });
      }
      this.trophyCells.push(medal);
    });

    // Progress bar toward the next unreached tier; full + MAXED once gold
    // is claimed. Graphics rounded-rect, DressingRoom stroke conventions.
    let nextThreshold: number | null = null;
    for (const tier of ACHIEVEMENT_TIERS) {
      const th = tierThreshold(def, tier);
      if (value < th) {
        nextThreshold = th;
        break;
      }
    }
    const barX0 = cx - w / 2 + 12;
    const labelX = cx + w / 2 - 12;
    const barW = w - 24 - 88;
    const barY = cy + 15;
    const barH = 8;
    const frac = nextThreshold === null ? 1 : Math.min(1, value / nextThreshold);

    const g = this.add.graphics();
    g.fillStyle(0x0b041a, 1);
    g.fillRoundedRect(barX0, barY - barH / 2, barW, barH, 4);
    g.lineStyle(1, 0xc0a0e6, 0.4);
    g.strokeRoundedRect(barX0, barY - barH / 2, barW, barH, 4);
    if (frac > 0) {
      g.fillStyle(goldClaimed ? 0xffd34d : 0x7ee08a, 1);
      g.fillRoundedRect(barX0, barY - barH / 2, Math.max(4, barW * frac), barH, 4);
    }
    this.trophyCells.push(g);

    const targetForLabel = nextThreshold ?? tierThreshold(def, 'gold');
    const label = goldClaimed
      ? 'MAXED'
      : `${value.toLocaleString('en-US')} / ${targetForLabel.toLocaleString('en-US')}`;
    this.trophyCells.push(
      this.add
        .text(labelX, barY, label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '9px',
          color: goldClaimed ? '#ffd34d' : '#c0a0e6',
        })
        .setOrigin(1, 0.5),
    );
  }

  /** Derives claim flow from ACHIEVEMENT_TIER_REWARDS: coins → claim directly; boxTier → open chooser. */
  private startAchievementClaim(def: AchievementDef, tier: AchievementTier): void {
    if (this.busy || this.chooser) return;
    const reward = ACHIEVEMENT_TIER_REWARDS[tier];
    if ('coins' in reward) {
      void this.onClaimAchievement(def.id, tier);
    } else {
      this.openTierChooser(
        reward.boxTier,
        `PICK YOUR ${reward.boxTier.toUpperCase()} BOX`,
        (boxId) => void this.onClaimAchievement(def.id, tier, boxId),
      );
    }
  }

  private async onClaimAchievement(
    id: AchievementId,
    tier: AchievementTier,
    boxId?: BoxId,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.closeChooser();
    try {
      const res = await claimAchievement(id, tier, boxId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state); // rebuild first so flyCoins targets the fresh banner
        if (res.coins > 0) this.flyCoins(res.coins);
        if (res.pull) this.flyText(`+ ${res.pull.itemId}`);
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  /** Destroy the live trophy row objects + scrollbar + camera (but keep the
   *  bound scroll listeners — cheap, and re-render reuses them). */
  private destroyTrophyObjects(): void {
    this.trophyMomentum?.stop();
    this.trophyMomentum = null;
    for (const obj of this.trophyCells) obj.destroy();
    this.trophyCells.length = 0;
    this.trophyScrollbar?.destroy();
    this.trophyScrollbar = null;
    if (this.trophyCam) {
      this.cameras.remove(this.trophyCam);
      this.trophyCam = null;
    }
  }

  /** Full trophies teardown — objects + camera + scroll listeners. Called
   *  when switching away from the tab and on shutdown (DressingRoom pattern). */
  private teardownTrophies(): void {
    this.destroyTrophyObjects();
    if (this.trophyInputBound) {
      if (this.trophyOnDown) this.input.off('pointerdown', this.trophyOnDown);
      if (this.trophyOnMove) this.input.off('pointermove', this.trophyOnMove);
      if (this.trophyOnUp) this.input.off('pointerup', this.trophyOnUp);
      if (this.trophyOnWheel) this.input.off('wheel', this.trophyOnWheel);
      this.trophyInputBound = false;
    }
    this.trophyDragActive = false;
    this.trophyScrollY = 0;
  }

  // -- claim handlers (await-and-adopt, then rebuild) -------------------

  private adopt(state: PlayerState): void {
    this.playerState = state;
    this.topHud?.setCoins(state.coins);
    this.buildChrome();
    this.renderTabBody();
  }

  private async onClaimQuest(questId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await claimQuest(questId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state); // rebuild first so flyCoins targets the fresh banner
        this.flyCoins(res.claimed);
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  private async onClaimStreak(boxId?: BoxId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await claimStreak(boxId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state);
        this.flyCoins(res.claimed);
        if ('goldenPull' in res && res.goldenPull) {
          this.flyText(`🏆 ${BOX_CATALOG[boxId!]?.displayName ?? 'Golden Box'}!`);
        }
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  private async onBonusPick(boxId: BoxId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.closeChooser();
    try {
      const res = await claimQuestBonus(boxId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state);
        // No coin count-up — the reward is an item; flash the box name.
        this.flyText(`🎁 ${BOX_CATALOG[boxId].displayName}!`);
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  private async onClaimWeekly(questId: string, boxId: BoxId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.closeChooser();
    try {
      const res = await claimWeekly(questId, boxId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state);
        this.flyCoins(res.claimed);
        this.flyText(`+ ${res.pull.itemId}`);
      } else {
        this.renderTabBody(); // state drifted server-side — repaint from current
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  private async onWeeklyBonus(boxId: BoxId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.closeChooser();
    try {
      const res = await claimWeeklyBonus(boxId);
      if (!this.scene.isActive()) return;
      if (res.ok) {
        this.adopt(res.state);
        this.flyCoins(res.claimed);
        this.flyText(`+ ${res.pull.itemId}`);
      } else {
        this.renderTabBody(); // state drifted server-side — repaint from current
      }
    } catch {
      /* leave the tab as-is on network error */
    }
    this.busy = false;
  }

  private async onCollect(): Promise<void> {
    if (this.busy) return;
    const pot = this.playerState?.economy?.pendingCollect ?? 0;
    if (pot <= 0) return;
    this.busy = true;

    let result: { collected: number; state: PlayerState };
    try {
      result = await collectRewards();
    } catch {
      this.busy = false;
      return;
    }
    if (!this.scene.isActive()) return; // scene left mid-fetch

    this.adopt(result.state); // repaints the banner to its 0-state
    if (result.collected > 0) this.flyText(`+${result.collected} 🪙`);
    this.busy = false;
  }

  // -- data-driven tier chooser -----------------------------------------

  /** One chooser overlay for every tier. Options derive from BOX_CATALOG,
   *  so adding a SKU changes the chooser with zero UI edits. Reused by the
   *  quest bonus (standard) and the day-7 streak (golden). */
  private openTierChooser(
    tier: BoxConfig['tier'],
    title: string,
    onPick: (boxId: BoxId) => void,
  ): void {
    if (this.busy || this.chooser) return;
    // The trophies grid camera renders AFTER the main camera, so its rows
    // would draw on top of a depth-470 chooser inside the body rect. Hide it
    // while the modal is open (scrollY is preserved on the camera).
    this.trophyCam?.setVisible(false);
    const options = (Object.values(BOX_CATALOG) as BoxConfig[]).filter((b) => b.tier === tier);

    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const w = Math.min(240, width - 40);
    const btnH = 32;
    const gap = 10;
    const h = 56 + options.length * (btnH + gap) + 20;
    const top = cy - h / 2;

    this.chooser = this.add.container(0, 0).setDepth(470);
    const dim = this.add
      .rectangle(0, 0, width, height, 0x0b041a, 0.7)
      .setOrigin(0, 0)
      .setInteractive();
    dim.on('pointerdown', () => this.closeChooser());
    this.chooser.add(dim);

    const panel = this.add
      .rectangle(cx, cy, w, h, 0x1a0a2e, 1)
      .setStrokeStyle(2, 0xffd34d, 0.9)
      .setInteractive();
    panel.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) =>
      e.stopPropagation(),
    );
    this.chooser.add(panel);

    this.chooser.add(
      this.add
        .text(cx, top + 22, title, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '13px',
          color: '#ffd34d',
        })
        .setOrigin(0.5),
    );

    options.forEach((box, i) => {
      const by = top + 48 + i * (btnH + gap) + btnH / 2;
      const bg = this.add
        .rectangle(cx, by, w - 28, btnH, 0x2c1856, 1)
        .setStrokeStyle(2, 0xffd34d, 0.7)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        this.closeChooser();
        onPick(box.id);
      });
      this.chooser!.add(bg);
      this.chooser!.add(
        this.add
          .text(cx, by, `${Rewards.CHOOSER_EMOJI[box.category]}  ${box.displayName}`, {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontStyle: 'bold',
            fontSize: '12px',
            color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    });
  }

  private closeChooser(): void {
    if (this.chooser) {
      this.chooser.destroy(true);
      this.chooser = null;
    }
    // Restore the trophies rows once the modal is gone.
    this.trophyCam?.setVisible(true);
  }

  // -- collect banner state + fly tweens --------------------------------

  /** Paint the collect card for a given pot amount. 0 → greyed button +
   *  "nothing to collect" copy; >0 → gold button + "you earned N" copy. */
  private setPotState(amount: number): void {
    if (!this.potText || !this.collectBg || !this.collectLabel) return;
    if (amount > 0) {
      this.potText.setText(`💰 Your shows earned ${amount} coins while you were away`);
      this.collectBg.setFillStyle(0xffd34d, 1);
      this.collectLabel.setText('COLLECT').setColor('#0b041a');
    } else {
      this.potText.setText('💰 Nothing to collect yet — host shows to earn');
      this.collectBg.setFillStyle(0x3a2b52, 1);
      this.collectLabel.setText('COLLECTED').setColor('#7a6699');
    }
  }

  private flyText(text: string): void {
    const fly = this.add
      .text(this.cardCX, this.cardCY + 4, text, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '15px',
        color: '#ffd34d',
      })
      .setOrigin(0.5)
      .setDepth(460);
    const tween = this.tweens.add({
      targets: fly,
      y: this.cardCY - 30,
      alpha: 0,
      duration: 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        fly.destroy();
        this.flyTweens = this.flyTweens.filter((t) => t !== tween);
      },
    });
    this.flyTweens.push(tween);
  }

  private flyCoins(amount: number): void {
    if (amount > 0) this.flyText(`+${amount} 🪙`);
  }

  shutdown(): void {
    // Kill in-flight fly tweens before their targets are destroyed so the
    // tween manager doesn't hold references to dead game objects.
    this.flyTweens.forEach((t) => t.remove());
    this.flyTweens = [];
    this.closeChooser();
    this.teardownTrophies();
    this.tweens.killAll();
    this.topHud?.destroy();
    this.uiRoot?.destroy();
    this.bodyRoot?.destroy();
    this.topHud = null;
    this.uiRoot = null;
    this.bodyRoot = null;
    this.potText = null;
    this.collectBg = null;
    this.collectLabel = null;
  }
}
