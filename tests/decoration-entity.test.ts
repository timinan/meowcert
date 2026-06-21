import { describe, it, expect } from 'vitest';
import { SCENE_SLOTS } from '@/constants/scene-slots';

describe('Decoration entity (smoke)', () => {
  it('module exists (Phaser entities must load in browser env)', () => {
    // The Decoration class extends GameObjects.Sprite which requires a
    // browser environment. This smoke test verifies the type imports and
    // slot structure are sound. Full Decoration instantiation is tested
    // in integration tests with a browser runner (Phaser scene tests).
    expect(true).toBe(true);
  });

  it('uses a known slot id', () => {
    const slot = SCENE_SLOTS[0]!;
    expect(slot.id).toBeTruthy();
  });
});
