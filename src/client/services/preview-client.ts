/**
 * Upload a cat-stage snapshot to the server. Stored on the player's
 * PlayerState so the splash.html feed preview can render it as the
 * backdrop for posts they author. Called from Decorate's SHUTDOWN
 * handler so every time the player leaves Set Stage we capture the
 * latest version of their cats / cosmetics / background.
 */

export async function savePreviewImage(dataUrl: string): Promise<void> {
  try {
    await fetch('/api/preview-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
  } catch (err) {
    // Non-blocking — the preview is a polish nicety, not load-bearing.
    console.warn('[savePreviewImage] failed:', err);
  }
}
