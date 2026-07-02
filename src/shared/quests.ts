/**
 * Daily quests + login streak shared module.
 *
 * Pure logic — zero redis / server imports. Safe to import from both the
 * Phaser client and the Devvit Hono server.
 */

import type { Difficulty } from './economy';
import { rolloverEconomy } from './state';
import type { PlayerState } from './state';

// ---------------------------------------------------------------------------
// Quest pool
// ---------------------------------------------------------------------------

export type DailyQuestId =
  | 'play3'
  | 'post1'
  | 'combo20'
  | 'comment1'
  | 'hardplay1'
  | 'openbox1';

export interface DailyQuest {
  id: DailyQuestId;
  label: string;
  target: number;
  coins: number;
}

export const DAILY_QUEST_POOL: DailyQuest[] = [
  { id: 'play3',     label: 'Play 3 shows',             target: 3, coins: 75  },
  { id: 'post1',     label: 'Post a show',               target: 1, coins: 50  },
  { id: 'combo20',   label: 'Hit a 20-combo',            target: 1, coins: 50  },
  { id: 'comment1',  label: 'Comment on a show',         target: 1, coins: 50  },
  { id: 'hardplay1', label: 'Play a hard or insane chart', target: 1, coins: 100 },
  { id: 'openbox1',  label: 'Open a box',                target: 1, coins: 50  },
];

// ---------------------------------------------------------------------------
// Deterministic daily rotation — pick 3 of 6 by hash of the ISO day string
// ---------------------------------------------------------------------------

/**
 * Returns exactly 3 quests for the given UTC ISO day (e.g. '2026-07-01').
 * The selection is deterministic and pseudo-random: the same day always
 * returns the same 3 quests but adjacent days typically differ.
 */
export function dailyQuestsFor(isoDay: string): DailyQuest[] {
  const h = [...isoDay].reduce(
    (a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0,
    7,
  );

  const pool = [...DAILY_QUEST_POOL];
  const selected: DailyQuest[] = [];

  for (let i = 0; i < 3; i++) {
    const idx = Math.abs(h + i * 31) % pool.length;
    selected.push(...pool.splice(idx, 1));
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Quest event recording
// ---------------------------------------------------------------------------

export type QuestEvent =
  | { kind: 'play'; maxCombo: number; difficulty: Difficulty }
  | { kind: 'post' }
  | { kind: 'comment' }
  | { kind: 'openbox' };

/** Map an event to the list of (questId, increment) pairs it may contribute. */
function questContributions(
  ev: QuestEvent,
): Array<{ id: DailyQuestId; inc: number }> {
  switch (ev.kind) {
    case 'play': {
      const contributions: Array<{ id: DailyQuestId; inc: number }> = [
        { id: 'play3', inc: 1 },
      ];
      if (ev.maxCombo >= 20) {
        contributions.push({ id: 'combo20', inc: 1 });
      }
      if (ev.difficulty === 'hard' || ev.difficulty === 'insane') {
        contributions.push({ id: 'hardplay1', inc: 1 });
      }
      return contributions;
    }
    case 'post':    return [{ id: 'post1',    inc: 1 }];
    case 'comment': return [{ id: 'comment1', inc: 1 }];
    case 'openbox': return [{ id: 'openbox1', inc: 1 }];
  }
}

/**
 * Advance quest progress for the given event.
 *
 * - Calls `rolloverEconomy` first to clear stale-day state.
 * - Only advances quests that are active today (per `dailyQuestsFor`).
 * - Skips quests already claimed.
 * - Clamps progress at the quest's target.
 */
export function recordQuestEvent(
  p: PlayerState,
  ev: QuestEvent,
  isoToday: string,
): void {
  rolloverEconomy(p, isoToday);

  const activeIds = new Set(dailyQuestsFor(isoToday).map((q) => q.id));
  const questMap = new Map<DailyQuestId, DailyQuest>(
    DAILY_QUEST_POOL.map((q) => [q.id, q]),
  );

  for (const { id, inc } of questContributions(ev)) {
    if (!activeIds.has(id)) continue;
    if (p.economy.daily.questClaimed[id]) continue;

    const quest = questMap.get(id)!;
    const current = p.economy.daily.questProgress[id] ?? 0;
    p.economy.daily.questProgress[id] = Math.min(quest.target, current + inc);
  }
}

// ---------------------------------------------------------------------------
// Login streak
// ---------------------------------------------------------------------------

/** Coin rewards for days 1-7 of a login streak. Day 7 also grants a Golden box. */
export const STREAK_TRACK: number[] = [25, 40, 55, 70, 85, 100, 100];

/** Returns the ISO date for the day before the given ISO date. */
function yesterdayOf(isoDay: string): string {
  return new Date(Date.parse(isoDay) - 86400000).toISOString().slice(0, 10);
}

/**
 * Advance or reset the login streak on the player's first load of the day.
 *
 * - Calls `rolloverEconomy` first.
 * - Same-day repeat call: no-op.
 * - Consecutive day (yesterday === lastDay, count < 7): increment count.
 * - After a full 7-day cycle OR a gap day: reset count to 1.
 * - Updates `streak.lastDay` to `isoToday`.
 */
export function touchLoginStreak(p: PlayerState, isoToday: string): void {
  rolloverEconomy(p, isoToday);

  const streak = p.economy.streak;

  // Same-day repeat — nothing to do
  if (streak.lastDay === isoToday) return;

  streak.count =
    streak.lastDay === yesterdayOf(isoToday) && streak.count < 7
      ? streak.count + 1
      : 1;

  streak.lastDay = isoToday;
}
