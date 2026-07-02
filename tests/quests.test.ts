import { describe, it, expect } from 'vitest';
import {
  DAILY_QUEST_POOL,
  dailyQuestsFor,
  recordQuestEvent,
  STREAK_TRACK,
  touchLoginStreak,
} from '../src/shared/quests';
import { createFreshPlayerState } from '../src/shared/state';

// ---------------------------------------------------------------------------
// dailyQuestsFor
// ---------------------------------------------------------------------------

describe('dailyQuestsFor', () => {
  it('returns exactly 3 quests', () => {
    expect(dailyQuestsFor('2026-07-01')).toHaveLength(3);
  });

  it('returns distinct quest ids', () => {
    const quests = dailyQuestsFor('2026-07-01');
    const ids = quests.map((q) => q.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('is deterministic — same day returns same set', () => {
    const a = dailyQuestsFor('2026-07-01').map((q) => q.id);
    const b = dailyQuestsFor('2026-07-01').map((q) => q.id);
    expect(a).toEqual(b);
  });

  it('returns quests drawn from DAILY_QUEST_POOL', () => {
    const poolIds = DAILY_QUEST_POOL.map((q) => q.id);
    const quests = dailyQuestsFor('2026-07-05');
    for (const q of quests) {
      expect(poolIds).toContain(q.id);
    }
  });

  it('produces at least 2 distinct sets across a 10-day span', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      `2026-07-${String(i + 1).padStart(2, '0')}`,
    );
    const sets = days.map((d) =>
      dailyQuestsFor(d)
        .map((q) => q.id)
        .sort()
        .join(','),
    );
    const distinct = new Set(sets);
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it('DAILY_QUEST_POOL has exactly 6 entries', () => {
    expect(DAILY_QUEST_POOL).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// STREAK_TRACK
// ---------------------------------------------------------------------------

describe('STREAK_TRACK', () => {
  it('has 7 entries', () => {
    expect(STREAK_TRACK).toHaveLength(7);
  });

  it('matches the spec [25,40,55,70,85,100,100]', () => {
    expect(STREAK_TRACK).toEqual([25, 40, 55, 70, 85, 100, 100]);
  });
});

// ---------------------------------------------------------------------------
// recordQuestEvent
// ---------------------------------------------------------------------------

describe('recordQuestEvent', () => {
  function makePlayer() {
    return createFreshPlayerState('test');
  }

  it('play event increments play3 when play3 is active today', () => {
    const p = makePlayer();
    const today = '2026-07-01';
    // Force play3 into today's active quests by finding a day it's active
    const dayWithPlay3 = findDayWith('play3');
    p.economy.daily.day = dayWithPlay3;
    recordQuestEvent(p, { kind: 'play', maxCombo: 5, difficulty: 'easy' }, dayWithPlay3);
    expect(p.economy.daily.questProgress['play3']).toBe(1);
  });

  it('play event with maxCombo >= 20 advances combo20 when active', () => {
    const dayWithCombo20 = findDayWith('combo20');
    const p = makePlayer();
    p.economy.daily.day = dayWithCombo20;
    recordQuestEvent(p, { kind: 'play', maxCombo: 20, difficulty: 'easy' }, dayWithCombo20);
    expect(p.economy.daily.questProgress['combo20']).toBe(1);
  });

  it('play event with maxCombo < 20 does NOT advance combo20', () => {
    const dayWithCombo20 = findDayWith('combo20');
    const p = makePlayer();
    p.economy.daily.day = dayWithCombo20;
    recordQuestEvent(p, { kind: 'play', maxCombo: 19, difficulty: 'easy' }, dayWithCombo20);
    expect(p.economy.daily.questProgress['combo20'] ?? 0).toBe(0);
  });

  it('play event with hard difficulty advances hardplay1 when active', () => {
    const dayWithHard = findDayWith('hardplay1');
    const p = makePlayer();
    p.economy.daily.day = dayWithHard;
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'hard' }, dayWithHard);
    expect(p.economy.daily.questProgress['hardplay1']).toBe(1);
  });

  it('play event with insane difficulty advances hardplay1 when active', () => {
    const dayWithHard = findDayWith('hardplay1');
    const p = makePlayer();
    p.economy.daily.day = dayWithHard;
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'insane' }, dayWithHard);
    expect(p.economy.daily.questProgress['hardplay1']).toBe(1);
  });

  it('play event with easy difficulty does NOT advance hardplay1', () => {
    const dayWithHard = findDayWith('hardplay1');
    const p = makePlayer();
    p.economy.daily.day = dayWithHard;
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'easy' }, dayWithHard);
    expect(p.economy.daily.questProgress['hardplay1'] ?? 0).toBe(0);
  });

  it('post event advances post1 when active', () => {
    const dayWithPost1 = findDayWith('post1');
    const p = makePlayer();
    p.economy.daily.day = dayWithPost1;
    recordQuestEvent(p, { kind: 'post' }, dayWithPost1);
    expect(p.economy.daily.questProgress['post1']).toBe(1);
  });

  it('comment event advances comment1 when active', () => {
    const dayWithComment1 = findDayWith('comment1');
    const p = makePlayer();
    p.economy.daily.day = dayWithComment1;
    recordQuestEvent(p, { kind: 'comment' }, dayWithComment1);
    expect(p.economy.daily.questProgress['comment1']).toBe(1);
  });

  it('openbox event advances openbox1 when active', () => {
    const dayWithOpenbox1 = findDayWith('openbox1');
    const p = makePlayer();
    p.economy.daily.day = dayWithOpenbox1;
    recordQuestEvent(p, { kind: 'openbox' }, dayWithOpenbox1);
    expect(p.economy.daily.questProgress['openbox1']).toBe(1);
  });

  it('does not advance a quest that is not active today', () => {
    // Find a day where play3 is NOT active, and fire a play event
    const dayWithoutPlay3 = findDayWithout('play3');
    const p = makePlayer();
    p.economy.daily.day = dayWithoutPlay3;
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'easy' }, dayWithoutPlay3);
    expect(p.economy.daily.questProgress['play3'] ?? 0).toBe(0);
  });

  it('progress clamps at target', () => {
    const dayWithPlay3 = findDayWith('play3');
    const p = makePlayer();
    p.economy.daily.day = dayWithPlay3;
    // play3 target is 3 — fire 5 events
    for (let i = 0; i < 5; i++) {
      recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'easy' }, dayWithPlay3);
    }
    expect(p.economy.daily.questProgress['play3']).toBe(3); // target is 3
  });

  it('claimed quest does not advance further', () => {
    const dayWithPlay3 = findDayWith('play3');
    const p = makePlayer();
    p.economy.daily.day = dayWithPlay3;
    // Mark play3 as claimed at progress 1
    p.economy.daily.questProgress['play3'] = 1;
    p.economy.daily.questClaimed['play3'] = true;
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'easy' }, dayWithPlay3);
    expect(p.economy.daily.questProgress['play3']).toBe(1); // stays frozen
  });

  it('calls rolloverEconomy — stale day resets progress before applying', () => {
    const dayWithPlay3 = findDayWith('play3');
    const p = makePlayer();
    // Set economy to a DIFFERENT day with stale progress
    p.economy.daily.day = '2020-01-01';
    p.economy.daily.questProgress['play3'] = 99;
    // Call with today — rollover should reset, then record 1
    recordQuestEvent(p, { kind: 'play', maxCombo: 0, difficulty: 'easy' }, dayWithPlay3);
    expect(p.economy.daily.questProgress['play3']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// touchLoginStreak
// ---------------------------------------------------------------------------

describe('touchLoginStreak', () => {
  function makePlayer() {
    return createFreshPlayerState('test');
  }

  it('fresh player: streak starts at 1', () => {
    const p = makePlayer();
    touchLoginStreak(p, '2026-07-01');
    expect(p.economy.streak.count).toBe(1);
    expect(p.economy.streak.lastDay).toBe('2026-07-01');
  });

  it('consecutive day: streak increments', () => {
    const p = makePlayer();
    touchLoginStreak(p, '2026-07-01');
    touchLoginStreak(p, '2026-07-02');
    expect(p.economy.streak.count).toBe(2);
  });

  it('gap day (skipped a day): streak resets to 1', () => {
    const p = makePlayer();
    touchLoginStreak(p, '2026-07-01');
    touchLoginStreak(p, '2026-07-03'); // skip 07-02
    expect(p.economy.streak.count).toBe(1);
  });

  it('same day repeat: no-op (count stays the same)', () => {
    const p = makePlayer();
    touchLoginStreak(p, '2026-07-01');
    touchLoginStreak(p, '2026-07-01');
    expect(p.economy.streak.count).toBe(1);
  });

  it('day 8 after full 7-day streak wraps count back to 1', () => {
    const p = makePlayer();
    // Build a full 7-day streak
    for (let d = 1; d <= 7; d++) {
      touchLoginStreak(p, `2026-07-0${d}`);
    }
    expect(p.economy.streak.count).toBe(7);
    // Day 8 — count < 7 is false (7 < 7 is false) so wraps to 1
    touchLoginStreak(p, '2026-07-08');
    expect(p.economy.streak.count).toBe(1);
  });

  it('day 8 also records lastDay = day 8', () => {
    const p = makePlayer();
    for (let d = 1; d <= 7; d++) {
      touchLoginStreak(p, `2026-07-0${d}`);
    }
    touchLoginStreak(p, '2026-07-08');
    expect(p.economy.streak.lastDay).toBe('2026-07-08');
  });

  it('also rolls over economy on a new day', () => {
    const p = makePlayer();
    p.economy.daily.day = '2020-01-01';
    p.economy.daily.questProgress['play3'] = 99; // stale
    touchLoginStreak(p, '2026-07-01');
    expect(p.economy.daily.day).toBe('2026-07-01');
    expect(p.economy.daily.questProgress['play3'] ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Search up to 50 days for a day where the given quest id is active. */
function findDayWith(questId: string): string {
  const base = new Date('2026-07-01');
  for (let i = 0; i < 50; i++) {
    const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (dailyQuestsFor(d).some((q) => q.id === questId)) return d;
  }
  throw new Error(`No day found in 50-day window where ${questId} is active`);
}

/** Search up to 50 days for a day where the given quest id is NOT active. */
function findDayWithout(questId: string): string {
  const base = new Date('2026-07-01');
  for (let i = 0; i < 50; i++) {
    const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (!dailyQuestsFor(d).some((q) => q.id === questId)) return d;
  }
  throw new Error(`No day found in 50-day window where ${questId} is inactive`);
}
