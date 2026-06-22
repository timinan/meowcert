import { GameObjects, Scene, Scenes } from 'phaser';
import { SceneKeys } from '@/constants/scenes';
import { CAT_CATALOG, COSMETIC_CATALOG } from '@/../shared/state';
import { AssetKeys } from '@/constants/assets';
import { equipCosmetic } from '@/services/state-client';
import { parentIdFor } from '@/entities/cat';
import type { PlayerState, CatBreed } from '@/../shared/state';

const COSMETICS_PER_PAGE = 19;
const SLOT_TABS: { key: string; label: string }[] = [
  { key: 'head', label: 'HEAD' },
  { key: 'face', label: 'FACE' },
  { key: 'neck', label: 'NECK' },
];

export class DressingRoom extends Scene {
  private catId!: CatBreed;
  private playerState!: PlayerState;
  private page = 0;
  /** Which slot the player is currently browsing in the cosmetics tray. */
  private activeSlot: string = 'head';
  private gridContainer!: GameObjects.Container;
  private heroSprite!: GameObjects.Image;
  /** One layered sprite per equipped slot — keyed by slot name. */
  private heroCosmetics: Record<string, GameObjects.Sprite> = {};
  private wearingLabel!: GameObjects.Text;
  private pageLabel!: GameObjects.Text;
  private prevBtn!: GameObjects.Container;
  private nextBtn!: GameObjects.Container;
  private slotTabsContainer!: GameObjects.Container;

  constructor() {
    super(SceneKeys.DressingRoom);
  }

  init(data: { catId: CatBreed; playerState: PlayerState }): void {
    this.catId = data.catId;
    this.playerState = data.playerState;
    this.page = 0;
    this.activeSlot = 'head';
    this.heroCosmetics = {};
  }

  create(): void {
    this.events.once(Scenes.Events.SHUTDOWN, () => this.cleanup());
    const { width, height } = this.scale;

    // Background
    this.add.rectangle(0, 0, width, height, 0x1a0a2e, 1).setOrigin(0, 0);

    // Top bar
    this.add.rectangle(0, 0, width, 44, 0x0b041a, 0.78).setOrigin(0, 0);
    const back = this.add
      .rectangle(40, 22, 64, 26, 0x0b041a, 1)
      .setStrokeStyle(1, 0xc0a0e6, 0.4)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(40, 22, '← Back', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '11px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    back.on('pointerdown', () => this.exit());

    const catEntry = CAT_CATALOG.find((c) => c.id === this.catId);
    const heroName = catEntry?.name ?? this.catId;
    this.add
      .text(width / 2, 22, `DRESSING ${heroName.toUpperCase()}`, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '12px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);

    // Hero shot — match Collection.ts frame pattern
    const heroFrame =
      this.catId === 'rainbow' ? 'cat6_idle_00' : `${this.catId}_idle_00`;
    const heroY = Math.max(120, height * 0.25);
    const heroScale = Math.min(2.5, width / 200);
    this.heroSprite = this.add
      .image(width / 2, heroY, AssetKeys.Atlas.Cats, heroFrame)
      .setScale(heroScale);
    this.renderEquippedCosmetic();

    // Wearing label
    this.wearingLabel = this.add
      .text(width / 2, this.heroSprite.y + 80, '', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '10px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    this.updateWearingLabel();

    // Slot tabs (HEAD / FACE / NECK) — pick which slot you're shopping for.
    this.slotTabsContainer = this.add.container(0, this.heroSprite.y + 102);
    this.renderSlotTabs();

    // Grid container — filtered by activeSlot
    this.gridContainer = this.add.container(0, this.heroSprite.y + 140);
    this.renderGrid();

    // Pagination
    const paginationY = height - 32;
    this.pageLabel = this.add
      .text(width / 2, paginationY, '', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '10px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    this.prevBtn = this.makeArrow(40, paginationY, '◀', () => this.changePage(-1));
    this.nextBtn = this.makeArrow(width - 40, paginationY, '▶', () => this.changePage(1));
    this.updatePagination();
  }

  private makeArrow(
    x: number,
    y: number,
    label: string,
    onTap: () => void,
  ): GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add
      .rectangle(0, 0, 36, 28, 0x2c1856, 1)
      .setStrokeStyle(1, 0xc0a0e6, 0.5)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(0, 0, label, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '14px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    c.add([bg, text]);
    bg.on('pointerdown', onTap);
    return c;
  }

  private renderEquippedCosmetic(): void {
    // Destroy any existing layered cosmetics first.
    for (const slot of Object.keys(this.heroCosmetics)) {
      this.heroCosmetics[slot]?.destroy();
    }
    this.heroCosmetics = {};

    const slots = this.playerState.equippedCosmetics[this.catId];
    if (!slots) return;

    // One sprite per equipped slot, all stacked on the cat with increasing
    // depth so newer additions render on top.
    let i = 1;
    for (const [slotKey, cosId] of Object.entries(slots)) {
      if (!cosId) continue;
      const cos = COSMETIC_CATALOG.find((c) => c.id === cosId);
      if (!cos) continue;
      const renderId = parentIdFor(cos) ?? cos.id;
      const frame = `cosmetic_${renderId}_idle_00`;
      const sprite = this.add
        .sprite(this.heroSprite.x, this.heroSprite.y, AssetKeys.Atlas.Cosmetics, frame)
        .setScale(this.heroSprite.scaleX, this.heroSprite.scaleY)
        .setOrigin(this.heroSprite.originX, this.heroSprite.originY)
        .setDepth(this.heroSprite.depth + i++);
      if (cos.tint) {
        const colorInt = parseInt(cos.tint.replace('#', ''), 16);
        sprite.setTint(colorInt);
      }
      this.heroCosmetics[slotKey] = sprite;
    }
  }

  private updateWearingLabel(): void {
    const slots = this.playerState.equippedCosmetics[this.catId] ?? {};
    const cosId = slots[this.activeSlot];
    const cos = cosId ? COSMETIC_CATALOG.find((c) => c.id === cosId) : null;
    this.wearingLabel.setText(
      `${this.activeSlot.toUpperCase()}: ${cos?.name ?? 'empty'}`,
    );
  }

  /** Render the HEAD / FACE / NECK tab row. */
  private renderSlotTabs(): void {
    this.slotTabsContainer.removeAll(true);
    const { width } = this.scale;
    const tabW = 88;
    const tabH = 26;
    const gap = 6;
    const totalW = SLOT_TABS.length * tabW + (SLOT_TABS.length - 1) * gap;
    const startX = (width - totalW) / 2;
    SLOT_TABS.forEach((tab, i) => {
      const x = startX + i * (tabW + gap);
      const isActive = this.activeSlot === tab.key;
      const equipped = this.playerState.equippedCosmetics[this.catId]?.[tab.key];
      const bg = this.add
        .rectangle(x, 0, tabW, tabH, isActive ? 0x2c1856 : 0x0b041a, isActive ? 1 : 0.6)
        .setOrigin(0, 0)
        .setStrokeStyle(2, isActive ? 0xffd34d : 0xc0a0e6, isActive ? 1 : 0.35)
        .setInteractive({ useHandCursor: true });
      const text = this.add
        .text(x + tabW / 2, tabH / 2, equipped ? `${tab.label} •` : tab.label, {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '11px',
          color: isActive ? '#ffd34d' : '#c0a0e6',
        })
        .setOrigin(0.5);
      this.slotTabsContainer.add([bg, text]);
      bg.on('pointerdown', () => {
        this.activeSlot = tab.key;
        this.page = 0;
        this.renderSlotTabs();
        this.renderGrid();
        this.updateWearingLabel();
        this.updatePagination();
      });
    });
  }

  private renderGrid(): void {
    this.gridContainer.removeAll(true);

    // Filter owned cosmetics to those that fit the active slot. Each catalog
    // entry has a `slot` field — entries without one are treated as 'head'.
    const ownedInSlot = this.playerState.ownedCosmetics.filter((cosId) => {
      const cos = COSMETIC_CATALOG.find((c) => c.id === cosId);
      const slot = cos?.slot ?? 'head';
      return slot === this.activeSlot;
    });

    const start = this.page * COSMETICS_PER_PAGE;
    const slice = ownedInSlot.slice(start, start + COSMETICS_PER_PAGE);
    const cellSize = 48;
    const gap = 8;
    const cols = 5;
    const gridStartX = (this.scale.width - (cellSize * cols + gap * (cols - 1))) / 2;
    const equippedInSlot = this.playerState.equippedCosmetics[this.catId]?.[this.activeSlot];

    slice.forEach((cosId, i) => {
      const cos = COSMETIC_CATALOG.find((c) => c.id === cosId);
      if (!cos) return;
      const renderId = parentIdFor(cos) ?? cos.id;
      const frame = `cosmetic_${renderId}_idle_00`;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gridStartX + col * (cellSize + gap) + cellSize / 2;
      const y = row * (cellSize + gap) + cellSize / 2;
      const isEquipped = equippedInSlot === cosId;
      const bg = this.add
        .rectangle(x, y, cellSize, cellSize, 0x0b041a, 0.6)
        .setStrokeStyle(2, isEquipped ? 0xffd34d : 0xc0a0e6, isEquipped ? 1 : 0.3)
        .setInteractive({ useHandCursor: true });
      const sprite = this.add
        .sprite(x, y, AssetKeys.Atlas.Cosmetics, frame)
        .setScale(0.7);
      if (cos.tint) {
        const colorInt = parseInt(cos.tint.replace('#', ''), 16);
        sprite.setTint(colorInt);
      }
      this.gridContainer.add([bg, sprite]);
      bg.on('pointerdown', () => this.equipInSlot(cosId));
    });

    // ✕ "clear slot" tile at the end of the slice
    const noneIdx = slice.length;
    const col = noneIdx % cols;
    const row = Math.floor(noneIdx / cols);
    if (row < 4) {
      const x = gridStartX + col * (cellSize + gap) + cellSize / 2;
      const y = row * (cellSize + gap) + cellSize / 2;
      const isNone = !equippedInSlot;
      const bg = this.add
        .rectangle(x, y, cellSize, cellSize, 0xff5050, isNone ? 0.4 : 0.15)
        .setStrokeStyle(2, 0xff5050, isNone ? 1 : 0.5)
        .setInteractive({ useHandCursor: true });
      const text = this.add
        .text(x, y, '✕', {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '18px',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      this.gridContainer.add([bg, text]);
      bg.on('pointerdown', () => this.equipInSlot(null));
    }
  }

  /** Equip / clear a cosmetic in the currently-active slot. */
  private async equipInSlot(cosId: string | null): Promise<void> {
    const slot = this.activeSlot;
    if (!this.playerState.equippedCosmetics[this.catId]) {
      this.playerState.equippedCosmetics[this.catId] = {};
    }
    const slots = this.playerState.equippedCosmetics[this.catId]!;
    const previous = slots[slot];

    // Optimistic mutation
    if (cosId === null) {
      delete slots[slot];
    } else {
      slots[slot] = cosId;
    }
    if (Object.keys(slots).length === 0) {
      delete this.playerState.equippedCosmetics[this.catId];
    }
    this.renderEquippedCosmetic();
    this.updateWearingLabel();
    this.renderSlotTabs();
    this.renderGrid();

    // Server sync
    try {
      const result = await equipCosmetic(this.catId, slot, cosId);
      if (!result.ok) {
        // Revert
        const slotsAfterRevert =
          this.playerState.equippedCosmetics[this.catId] ?? {};
        if (previous === undefined) {
          delete slotsAfterRevert[slot];
        } else {
          slotsAfterRevert[slot] = previous;
        }
        if (Object.keys(slotsAfterRevert).length === 0) {
          delete this.playerState.equippedCosmetics[this.catId];
        } else {
          this.playerState.equippedCosmetics[this.catId] = slotsAfterRevert;
        }
        this.renderEquippedCosmetic();
        this.updateWearingLabel();
        this.renderSlotTabs();
        this.renderGrid();
      } else {
        Object.assign(this.playerState, result.state);
      }
    } catch (e) {
      console.warn('[DressingRoom] equip failed:', e);
    }
  }

  private countOwnedInSlot(): number {
    return this.playerState.ownedCosmetics.filter((cosId) => {
      const cos = COSMETIC_CATALOG.find((c) => c.id === cosId);
      const slot = cos?.slot ?? 'head';
      return slot === this.activeSlot;
    }).length;
  }

  private changePage(delta: number): void {
    const total = Math.max(
      1,
      Math.ceil(this.countOwnedInSlot() / COSMETICS_PER_PAGE),
    );
    this.page = Math.max(0, Math.min(total - 1, this.page + delta));
    this.renderGrid();
    this.updatePagination();
  }

  private updatePagination(): void {
    const total = Math.max(
      1,
      Math.ceil(this.countOwnedInSlot() / COSMETICS_PER_PAGE),
    );
    this.pageLabel.setText(`page ${this.page + 1} / ${total}`);
    this.prevBtn.setAlpha(this.page === 0 ? 0.35 : 1);
    this.nextBtn.setAlpha(this.page === total - 1 ? 0.35 : 1);
  }

  private exit(): void {
    // Phase 5: navigation = scene.start() only — never pause+resume.
    // Pass playerState back so Decorate re-reads latest equippedCosmetics.
    this.scene.start(SceneKeys.Decorate, { playerState: this.playerState });
  }

  private cleanup(): void {
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.scale.off('resize');
    for (const slot of Object.keys(this.heroCosmetics)) {
      this.heroCosmetics[slot]?.destroy();
    }
    this.heroCosmetics = {};
    this.gridContainer?.destroy(true);
    this.slotTabsContainer?.destroy(true);
  }
}
