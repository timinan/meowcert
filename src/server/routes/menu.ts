import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});

/**
 * Moderator-only cleanup: remove every post in the current subreddit
 * that's NOT a real published Meowcert show. Real published shows have
 * titles starting with '🎵' (publish.ts → submitCustomPost title is
 * `🎵 ${username}'s show`). Anything else is either:
 *   - a legacy test post made via the default 'Create a new post' menu
 *     (titled just 'Meowcert')
 *   - an experiment / scaffold post
 * Walks the last 100 newest posts, removes the non-matching ones,
 * returns a toast with the count. Re-runnable — only acts on posts
 * that haven't been removed yet.
 */
menu.post('/cleanup-legacy', async (c) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) {
      return c.json<UiResponse>({ showToast: 'no subreddit context' }, 400);
    }
    const posts = await reddit.getNewPosts({ subredditName, limit: 100 }).all();
    let removed = 0;
    let kept = 0;
    for (const post of posts) {
      const title = post.title ?? '';
      if (title.startsWith('🎵')) {
        kept++;
        continue;
      }
      try {
        await post.remove();
        removed++;
      } catch (err) {
        console.warn(`[cleanup-legacy] failed to remove ${post.id}:`, err);
      }
    }
    return c.json<UiResponse>(
      { showToast: `Removed ${removed} legacy posts, kept ${kept} shows.` },
      200,
    );
  } catch (err) {
    console.error('[cleanup-legacy] threw:', err);
    return c.json<UiResponse>({ showToast: 'cleanup failed — see logs' }, 500);
  }
});
