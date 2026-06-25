import { GameObjects, Scene } from 'phaser';
import {
  fetchInbox,
  markInboxRead,
} from '@/services/social-client';
import type {
  InboxEvent,
  PlayEventData,
  GiftEventData,
  CommentEventData,
} from '@/../shared/social-loop';

/**
 * Owner-side inbox modal — shows recent activity on the owner's posts.
 * Opens from the hamburger drawer (📬 INBOX entry). Auto-marks all
 * events as seen when opened so the unread badge on the drawer clears.
 *
 * Each event renders as a compact row:
 *   play           — "u/<visitor> played — 87% (PERFECT) 1,240 pts"
 *   comment_posted — "u/<visitor> commented: \"nice run! 🐱\""
 *   gift_received  — "u/<visitor> sent +200 coins + 1 cosmetic"
 */
export class InboxModal {
  private container: GameObjects.Container | null = null;

  constructor(private scene: Scene) {}

  async open(args: { onClose?: () => void } = {}): Promise<void> {
    this.close();
    const { width, height } = this.scene.scale;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = Math.min(300, width - 24);
    const panelH = Math.min(460, height - 60);
    const panelX = cx - panelW / 2;
    const panelY = cy - panelH / 2;

    this.container = this.scene.add.container(0, 0).setDepth(450);

    const scrim = this.scene.add
      .rectangle(0, 0, width, height, 0x0b041a, 0.78)
      .setOrigin(0, 0)
      .setInteractive();
    scrim.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) =>
      e.stopPropagation(),
    );
    this.container.add(scrim);

    const panel = this.scene.add
      .rectangle(cx, cy, panelW, panelH, 0x1a0a2e, 1)
      .setStrokeStyle(2, 0xffd34d, 0.85)
      .setInteractive();
    panel.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) =>
      e.stopPropagation(),
    );
    this.container.add(panel);

    this.container.add(
      this.scene.add
        .text(cx, panelY + 22, '📬 INBOX', {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '18px',
          color: '#ffd34d',
        })
        .setOrigin(0.5),
    );
    this.container.add(
      this.scene.add
        .text(cx, panelY + 44, 'recent activity on your posts', {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontSize: '10px',
          color: '#c0a0e6',
        })
        .setOrigin(0.5),
    );

    // ✕ close
    const closeBg = this.scene.add
      .circle(panelX + panelW - 18, panelY + 18, 12, 0xff5050, 1)
      .setStrokeStyle(2, 0x0b041a, 1)
      .setInteractive({ useHandCursor: true });
    closeBg.on('pointerdown', () => {
      this.close();
      args.onClose?.();
    });
    this.container.add(closeBg);
    this.container.add(
      this.scene.add
        .text(panelX + panelW - 18, panelY + 18, '✕', {
          fontFamily: 'Pixeloid Sans, sans-serif',
          fontStyle: 'bold',
          fontSize: '12px',
          color: '#ffffff',
        })
        .setOrigin(0.5),
    );

    // Loading text — replaced once fetch resolves
    const loading = this.scene.add
      .text(cx, cy, 'loading…', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '12px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    this.container.add(loading);

    let events: InboxEvent[] = [];
    const res = await fetchInbox();
    if (!this.container) return; // closed mid-fetch
    if (res.ok) events = res.events;
    loading.destroy();

    if (events.length === 0) {
      this.container.add(
        this.scene.add
          .text(cx, cy, 'no activity yet — share your post!', {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontSize: '11px',
            color: '#c0a0e6',
          })
          .setOrigin(0.5),
      );
    } else {
      // Scrollable list area (no scroll yet — fits ~12 rows). Bounded
      // by INBOX_MAX_EVENTS = 100 on the server side; UI shows top 12,
      // older events visible only via future scroll wiring.
      const listTop = panelY + 72;
      const rowH = 28;
      const rowGap = 4;
      const rowW = panelW - 24;
      const maxRows = Math.min(events.length, 12);
      for (let i = 0; i < maxRows; i++) {
        const ev = events[i]!;
        const y = listTop + i * (rowH + rowGap) + rowH / 2;
        const bg = this.scene.add
          .rectangle(cx, y, rowW, rowH, 0x2c1856, 1)
          .setStrokeStyle(1, ev.seen ? 0xc0a0e6 : 0xffd34d, ev.seen ? 0.3 : 0.85);
        const txt = this.scene.add
          .text(cx - rowW / 2 + 10, y, this.formatEvent(ev), {
            fontFamily: 'Pixeloid Sans, sans-serif',
            fontSize: '9px',
            color: ev.seen ? '#c0a0e6' : '#ffffff',
            wordWrap: { width: rowW - 20 },
          })
          .setOrigin(0, 0.5);
        this.container!.add([bg, txt]);
      }
    }

    // Mark-as-seen — fire-and-forget on open so the badge clears on next render
    void markInboxRead();
  }

  close(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
  }

  destroy(): void {
    this.close();
  }

  private formatEvent(ev: InboxEvent): string {
    const when = this.formatTimeAgo(ev.at);
    switch (ev.kind) {
      case 'play': {
        const d = ev.data as PlayEventData;
        const tierLabel = d.tier === 'fail' ? 'didn\'t pass' : d.tier.toUpperCase();
        const pct = Math.round(d.accuracy * 100);
        return `${when} u/${ev.visitor} played — ${pct}% ${tierLabel} · ${d.score.toLocaleString()}`;
      }
      case 'gift_received': {
        const d = ev.data as GiftEventData;
        const parts: string[] = [];
        if (d.coins > 0) parts.push(`+${d.coins} coins`);
        if (d.itemCount > 0) parts.push(`${d.itemCount} cosmetic${d.itemCount > 1 ? 's' : ''}`);
        return `${when} 🎁 u/${ev.visitor} sent ${parts.join(' + ') || 'a gift'}`;
      }
      case 'comment_posted': {
        const d = ev.data as CommentEventData;
        return `${when} 💬 u/${ev.visitor}: "${d.preview}"`;
      }
      default:
        return `${when} u/${ev.visitor} did something`;
    }
  }

  /** "5m ago" / "2h ago" / "3d ago" — coarse but readable. */
  private formatTimeAgo(at: number): string {
    const dt = Date.now() - at;
    if (dt < 60_000) return 'just now ·';
    if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago ·`;
    if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago ·`;
    return `${Math.floor(dt / 86_400_000)}d ago ·`;
  }
}
