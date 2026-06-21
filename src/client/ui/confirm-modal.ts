import { GameObjects, Scene } from 'phaser';

/**
 * Centered modal with a title, body, and Cancel / Confirm buttons.
 * Used for destructive actions (Rehome). Self-destroys when either
 * button is pressed.
 */
export class ConfirmModal {
  private container: GameObjects.Container | null = null;

  constructor(private scene: Scene) {}

  open(args: {
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }): void {
    this.close();
    const { width, height } = this.scene.scale;
    const w = 240;
    const h = 140;

    this.container = this.scene.add.container(0, 0).setDepth(300);

    // Scrim
    const scrim = this.scene.add
      .rectangle(0, 0, width, height, 0x0b041a, 0.7)
      .setOrigin(0, 0)
      .setInteractive();
    scrim.on('pointerdown', () => {
      args.onCancel?.();
      this.close();
    });
    this.container.add(scrim);

    // Panel
    const cx = width / 2;
    const cy = height / 2;
    const panel = this.scene.add
      .rectangle(cx, cy, w, h, 0x2c1856, 1)
      .setStrokeStyle(2, 0xffd34d, 1)
      .setInteractive();
    panel.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.container.add(panel);

    const title = this.scene.add
      .text(cx, cy - h / 2 + 18, args.title, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '14px',
        color: '#ffd34d',
      })
      .setOrigin(0.5);
    this.container.add(title);

    const body = this.scene.add
      .text(cx, cy - 10, args.body, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '11px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: w - 24 },
      })
      .setOrigin(0.5);
    this.container.add(body);

    // Buttons
    const buttonY = cy + h / 2 - 22;
    const cancelBg = this.scene.add
      .rectangle(cx - 54, buttonY, 90, 28, 0x0b041a, 1)
      .setStrokeStyle(1, 0xc0a0e6, 0.5)
      .setInteractive({ useHandCursor: true });
    const cancelLabel = this.scene.add
      .text(cx - 54, buttonY, 'Cancel', {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontSize: '11px',
        color: '#c0a0e6',
      })
      .setOrigin(0.5);
    cancelBg.on('pointerdown', () => {
      args.onCancel?.();
      this.close();
    });

    const confirmBg = this.scene.add
      .rectangle(cx + 54, buttonY, 90, 28, 0xff5050, 1)
      .setInteractive({ useHandCursor: true });
    const confirmLabel = this.scene.add
      .text(cx + 54, buttonY, args.confirmLabel, {
        fontFamily: 'Pixeloid Sans, sans-serif',
        fontStyle: 'bold',
        fontSize: '11px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    confirmBg.on('pointerdown', () => {
      args.onConfirm();
      this.close();
    });

    this.container.add([cancelBg, cancelLabel, confirmBg, confirmLabel]);
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
}
