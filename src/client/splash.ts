import { requestExpandedMode } from '@devvit/web/client';

/**
 * Inline splash for Meowcert posts. Shown in the Reddit feed before
 * the user taps. Static HTML + CSS — no Phaser, no fetches, paints
 * immediately so the feed scroll stays fast.
 *
 * Tap → requestExpandedMode('game') swaps the inline embed for the
 * fullscreen modal which loads game.html (full Phaser, VisitPost
 * scene takes over).
 */
const startButton = document.getElementById('start-button') as HTMLButtonElement | null;

startButton?.addEventListener('click', (e) => {
  // 'game' is the entrypoint registered in devvit.json — must differ
  // from the currently-loaded 'default' entry for Devvit to perform
  // a real inline→expanded transition. Same-entry requests are no-ops.
  try { requestExpandedMode(e, 'game'); }
  catch (err) { console.warn('[splash] requestExpandedMode threw:', err); }
});
