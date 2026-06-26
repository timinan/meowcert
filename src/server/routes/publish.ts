import { Hono } from 'hono';
import { redis, reddit, context } from '@devvit/web/server';
import { loadOrInit } from '../core/player-state';
import { setPostOwner } from '../core/social';

/**
 * Publish flow — turn an authored chart into a live Reddit post that
 * other players can visit and play. Mounted at /api/publish.
 *
 * POST /chart — create a new Reddit post for the caller's saved chart.
 *   Returns { ok: true, postId, url } on success or { ok: false, reason }
 *   on validation/Devvit failure. Always wires the post-owner mapping
 *   into Redis so the social-loop endpoints can route leaderboard +
 *   inbox entries to the right author when visitors play.
 */
export const publish = new Hono();

publish.post('/chart', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    if (username === 'anonymous') {
      return c.json({ ok: false, reason: 'sign in to post a show' }, 401);
    }

    const state = await loadOrInit(redis, username);
    const chart = state.chart;
    const hasNotes = chart?.steps?.some((s) => s.lanes.length > 0);
    if (!chart || !hasNotes) {
      return c.json(
        { ok: false, reason: 'save a chart with at least one note before posting' },
        400,
      );
    }

    // Devvit creates the post + returns its id. Title carries the
    // author's name so the feed reads as "playing alice's show".
    const post = await reddit.submitCustomPost({
      title: `🎵 ${username}'s show`,
    });

    // Wire the post → owner mapping immediately so submitPlay /
    // leaderboard / inbox endpoints can route to the right author the
    // first time a visitor opens the post.
    await setPostOwner(redis, post.id, username);

    const subreddit = context.subredditName ?? '';
    const url = subreddit
      ? `https://reddit.com/r/${subreddit}/comments/${post.id}`
      : `https://reddit.com/comments/${post.id}`;
    return c.json({ ok: true, postId: post.id, url });
  } catch (err) {
    console.error('[publish] failed to create post:', err);
    return c.json({ ok: false, reason: 'reddit rejected the post' }, 500);
  }
});
