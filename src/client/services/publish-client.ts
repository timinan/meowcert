/**
 * Client wrapper for the publish flow. Single endpoint right now —
 * POST /api/publish/chart — that takes the caller's saved chart and
 * creates a Reddit post for it. Returns the post id + permalink so
 * the caller can show "your show is live" with a tappable URL.
 */

export type PublishResult =
  | { ok: true; postId: string; url: string }
  | { ok: false; reason: string };

export async function publishChart(): Promise<PublishResult> {
  try {
    const res = await fetch('/api/publish/chart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = (await res.json()) as { ok?: boolean; reason?: string; postId?: string; url?: string };
    if (!res.ok || data.ok !== true || !data.postId || !data.url) {
      return { ok: false, reason: data.reason ?? `HTTP ${res.status}` };
    }
    return { ok: true, postId: data.postId, url: data.url };
  } catch (err) {
    console.error('[publishChart] threw:', err);
    return { ok: false, reason: 'network error' };
  }
}
