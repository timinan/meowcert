import { describe, it, expect } from 'vitest';
import type { DecorationId, ThemeId, SlotId, DecorationEntry, ThemeEntry } from '@/../shared/state';

describe('decoration + theme types', () => {
  it('DecorationId is a string', () => {
    const id: DecorationId = 'd1';
    expect(typeof id).toBe('string');
  });

  it('ThemeId is a string', () => {
    const id: ThemeId = 'default';
    expect(typeof id).toBe('string');
  });

  it('SlotId is a string', () => {
    const id: SlotId = 'window-sill';
    expect(typeof id).toBe('string');
  });

  it('DecorationEntry has required fields', () => {
    const e: DecorationEntry = {
      id: 'd1',
      displayName: 'Cozy Lamp',
      frame: 'd1',
      rarity: 'common',
    };
    expect(e.id).toBe('d1');
  });

  it('ThemeEntry has required fields', () => {
    const e: ThemeEntry = {
      id: 'default',
      displayName: 'Default',
      backdropKey: 'theme-default-bg',
      musicKey: 'theme-default-music',
      rarity: 'common',
    };
    expect(e.id).toBe('default');
  });
});
