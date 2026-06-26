import { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import { loadOrInit, save } from '../core/player-state';

/**
 * Preview-image endpoints. Mounted at /api/preview-image.
 *
 *   POST /          — caller uploads a base64 JPEG data URL of their
 *                     cat-stage snapshot. Stored on the caller's
 *                     PlayerState (overwrites previous on each upload).
 *                     Fire-and-forget from Decorate's SHUTDOWN handler.
 *
 *   GET /?postId=X  — splash.html fetches the post-owner's stored
 *                     image (+ ownerUsername + chart title + leaderboard
 *                     top 3 + total-plays) so the inline feed preview
 *                     can render as a VisitPost mirror in one fetch.
 *                     Returns 404 if the post has no owner mapping or
 *                     the owner hasn't captured a preview yet.
 */
export const preview = new Hono();

preview.post('/', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    if (username === 'anonymous') {
      return c.json({ ok: false, reason: 'must be signed in' }, 401);
    }
    const body = (await c.req.json()) as { image?: string };
    if (!body?.image || !body.image.startsWith('data:image/')) {
      return c.json({ ok: false, reason: 'missing or invalid image' }, 400);
    }
    // Cap the payload at ~300 KB so a runaway capture (e.g. someone
    // bypassing client-side downscale) can't bloat Redis.
    if (body.image.length > 300_000) {
      return c.json({ ok: false, reason: 'image too large' }, 413);
    }
    const state = await loadOrInit(redis, username);
    state.previewImage = body.image;
    await save(redis, state);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[preview POST] failed:', err);
    return c.json({ ok: false, reason: 'server error' }, 500);
  }
});

preview.get('/', async (c) => {
  const postId = c.req.query('postId');
  if (!postId) return c.json({ error: 'missing postId' }, 400);

  const ownerUsername = await redis.get(`meowcert:post-owner:${postId}`);
  if (!ownerUsername) {
    return c.json({ error: 'post has no owner mapping' }, 404);
  }

  const ownerState = await loadOrInit(redis, ownerUsername);
  // Chart metadata for the song-line on the splash. Pull title + vibe
  // + difficulty (the shape splash already uses).
  const chart = ownerState.chart;
  const title = chart?.title ?? 'a rhythm show';
  const vibe = chart?.vibe;
  const difficulty = chart?.difficulty;

  return c.json({
    postId,
    ownerUsername,
    previewImage: ownerState.previewImage ?? null,
    song: { title, vibe, difficulty },
  });
});
