import { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import { loadOrInit, save } from '../core/player-state';
import { pullBox, applyPullToState } from '../core/box-pull';
import {
  BOX_CATALOG,
  type BoxId,
  type CatBreed,
  type CosmeticId,
} from '../../shared/state';

export const state = new Hono();

async function currentUsername(): Promise<string> {
  const username = await reddit.getCurrentUsername();
  return username ?? 'anonymous';
}

/** GET /api/state — current player state, initializes on first hit. */
state.get('/state', async (c) => {
  const username = await currentUsername();
  const player = await loadOrInit(redis, username);
  return c.json({ state: player });
});

/** POST /api/box/open — body: { boxId }. Server rolls + persists. */
state.post('/box/open', async (c) => {
  const { boxId } = (await c.req.json()) as { boxId: BoxId };
  const box = BOX_CATALOG[boxId];
  if (!box) {
    return c.json({ ok: false, reason: 'unknown_box' }, 400);
  }
  const username = await currentUsername();
  const player = await loadOrInit(redis, username);
  if (player.coins < box.cost) {
    return c.json({ ok: false, reason: 'insufficient_coins' }, 400);
  }
  player.coins -= box.cost;
  const pull = pullBox(boxId, player);
  applyPullToState(player, pull);
  await save(redis, player);
  return c.json({ ok: true, pull, state: player });
});

/** POST /api/coins/sync — body: { coinsDelta, bestScore? }.
 * Lets the client push incremental coin gains + best-score updates
 * without round-tripping the whole state. */
state.post('/coins/sync', async (c) => {
  const { coinsDelta, bestScore } = (await c.req.json()) as {
    coinsDelta: number;
    bestScore?: number;
  };
  const username = await currentUsername();
  const player = await loadOrInit(redis, username);
  player.coins = Math.max(0, player.coins + Math.floor(coinsDelta));
  if (bestScore !== undefined && bestScore > player.bestScore) {
    player.bestScore = bestScore;
  }
  await save(redis, player);
  return c.json({ state: player });
});

/** POST /api/cosmetic/equip — body: { breed, cosmeticId | null }. */
state.post('/cosmetic/equip', async (c) => {
  const { breed, cosmeticId } = (await c.req.json()) as {
    breed: CatBreed;
    cosmeticId: CosmeticId | null;
  };
  const username = await currentUsername();
  const player = await loadOrInit(redis, username);
  if (!player.ownedCats.includes(breed)) {
    return c.json({ ok: false, reason: 'cat_not_owned' }, 400);
  }
  if (cosmeticId !== null && !player.ownedCosmetics.includes(cosmeticId)) {
    return c.json({ ok: false, reason: 'cosmetic_not_owned' }, 400);
  }
  if (cosmeticId === null) {
    delete player.equippedCosmetics[breed];
  } else {
    player.equippedCosmetics[breed] = cosmeticId;
  }
  await save(redis, player);
  return c.json({ ok: true, state: player });
});

/** POST /api/onboarding/complete — flips onboardingDone=true. */
state.post('/onboarding/complete', async (c) => {
  const username = await currentUsername();
  const player = await loadOrInit(redis, username);
  player.onboardingDone = true;
  await save(redis, player);
  return c.json({ state: player });
});
