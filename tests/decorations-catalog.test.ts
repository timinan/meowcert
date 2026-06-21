import { describe, it, expect } from 'vitest';
import { DECORATION_CATALOG } from '@/../shared/state';

describe('DECORATION_CATALOG', () => {
  it('has at least 6 entries', () => {
    expect(DECORATION_CATALOG.length).toBeGreaterThanOrEqual(6);
  });

  it('all decoration ids are unique', () => {
    const ids = DECORATION_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every decoration has required fields', () => {
    for (const d of DECORATION_CATALOG) {
      expect(d.id).toBeTruthy();
      expect(d.displayName).toBeTruthy();
      expect(d.frame).toBeTruthy();
      expect(['common', 'uncommon', 'rare', 'legendary']).toContain(d.rarity);
    }
  });
});
