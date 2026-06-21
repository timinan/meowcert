import { describe, it, expect, vi } from 'vitest';
import { BackgroundManager } from '@/entities/background-manager';
import type { BackgroundId } from '@/../shared/state';

function makeFakeScene() {
  const makeText = () => ({ setAlpha: vi.fn().mockReturnThis() });
  const container = {
    add: vi.fn(),
    removeAll: vi.fn(),
    setDepth: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
  return {
    add: {
      container: vi.fn().mockReturnValue(container),
      rectangle: vi.fn().mockReturnValue({ setOrigin: vi.fn().mockReturnThis() }),
      text: vi.fn().mockImplementation(() => makeText()),
    },
    scale: { width: 400, height: 700 },
  } as unknown as Phaser.Scene;
}

describe('BackgroundManager', () => {
  it('setBackground switches the active background id', () => {
    const scene = makeFakeScene();
    const bg = new BackgroundManager(scene);
    bg.create();
    bg.setBackground('cozy');
    expect(bg.active).toBe('cozy');
  });

  it('setBackground falls back to default if unknown id', () => {
    const scene = makeFakeScene();
    const bg = new BackgroundManager(scene);
    bg.create();
    bg.setBackground('alien' as BackgroundId);
    expect(bg.active).toBe('default');
  });
});
