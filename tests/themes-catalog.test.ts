import { describe, it, expect } from 'vitest';
import { THEME_CATALOG } from '@/../shared/state';

describe('THEME_CATALOG', () => {
  it('has at least 3 entries including "default"', () => {
    expect(THEME_CATALOG.length).toBeGreaterThanOrEqual(3);
    expect(THEME_CATALOG.find((t) => t.id === 'default')).toBeDefined();
  });

  it('all theme ids are unique', () => {
    const ids = THEME_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every theme has backdropKey + musicKey', () => {
    for (const t of THEME_CATALOG) {
      expect(t.backdropKey).toBeTruthy();
      expect(t.musicKey).toBeTruthy();
    }
  });
});
