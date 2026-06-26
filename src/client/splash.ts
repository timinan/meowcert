import { context, requestExpandedMode } from '@devvit/web/client';

/**
 * Inline feed-preview splash for Meowcert posts. Mirrors the VisitPost
 * in-game scene's layout:
 *   - top band: captured cat-stage screenshot from the post owner's
 *               last visit to Decorate (or branded fallback if missing)
 *   - middle:   author / song / play count / top 3 leaderboard / your best
 *   - bottom:   TAP TO PLAY button → requestExpandedMode('game') →
 *               fullscreen modal loads game.html → Phaser → VisitPost
 *
 * Single fetch on load (/api/preview-image + /api/social/leaderboard
 * fired in parallel) — feed scroll stays fast.
 */

const stage = document.getElementById('stage') as HTMLDivElement | null;
const marqueeFallback = document.getElementById('marquee-fallback') as HTMLDivElement | null;
const infoPanel = document.getElementById('info') as HTMLDivElement | null;
const authorEl = document.getElementById('author') as HTMLDivElement | null;
const songEl = document.getElementById('song') as HTMLDivElement | null;
const lbEls = [
  document.getElementById('lb-1') as HTMLLIElement | null,
  document.getElementById('lb-2') as HTMLLIElement | null,
  document.getElementById('lb-3') as HTMLLIElement | null,
];
const yourBestEl = document.getElementById('your-best') as HTMLDivElement | null;
const startButton = document.getElementById('start-button') as HTMLButtonElement | null;

startButton?.addEventListener('click', (e) => {
  try { requestExpandedMode(e, 'game'); }
  catch (err) { console.warn('[splash] requestExpandedMode threw:', err); }
});

const postId = context.postId;
if (postId) {
  void Promise.all([
    fetch(`/api/preview-image?postId=${encodeURIComponent(postId)}`).then((r) => r.ok ? r.json() : null),
    fetch(`/api/social/leaderboard?postId=${encodeURIComponent(postId)}`).then((r) => r.ok ? r.json() : null),
  ]).then(([visit, lb]) => {
    if (visit) renderVisit(visit as VisitData);
    if (lb) renderLeaderboard(lb as LeaderboardData);
  }).catch((err) => {
    console.warn('[splash] data fetch failed:', err);
  });
}

interface VisitData {
  ownerUsername?: string;
  previewImage?: string | null;
  song?: { title?: string; vibe?: string; difficulty?: string };
}

interface LeaderboardData {
  top?: Array<{ visitor: string; score: number; accuracy?: number; playedAt?: number }>;
  yourRank?: number | null;
  yourScore?: number | null;
}

function renderVisit(d: VisitData): void {
  if (d.previewImage && stage && marqueeFallback) {
    stage.style.backgroundImage = `url(${d.previewImage})`;
    marqueeFallback.style.display = 'none';
  }
  if (d.ownerUsername && authorEl) {
    authorEl.textContent = `Created by u/${d.ownerUsername}`;
  }
  if (d.song && songEl) {
    const parts = [d.song.title ?? 'a rhythm show'];
    if (d.song.vibe) parts.push(d.song.vibe);
    if (d.song.difficulty) parts.push(d.song.difficulty);
    songEl.textContent = `🎶 ${parts.join(' · ')}`;
  }
  // Only show the info panel once we have a real owner — scaffold /
  // unmapped posts (like the original 'Meowcert' moderator-test post)
  // get just the MEOWCERT marquee + PLAY button, no half-filled
  // 'Created by u/—' / empty leaderboard noise.
  if (d.ownerUsername && infoPanel) {
    infoPanel.style.display = '';
  }
}

function renderLeaderboard(d: LeaderboardData): void {
  const top = d.top ?? [];
  if (statsEl) statsEl.textContent = `${top.length} plays`;
  for (let i = 0; i < 3; i++) {
    const li = lbEls[i];
    if (!li) continue;
    const e = top[i];
    if (!e) {
      li.textContent = `${i + 1}. —`;
      continue;
    }
    // Backend field is `visitor` (the username string), not `username`
    // — this was the missing-score bug.
    const u = e.visitor;
    const name = u.length > 16 ? u.slice(0, 14) + '…' : u;
    li.textContent = `${i + 1}. ${name.padEnd(18)} ${e.score.toLocaleString()}`;
  }
  if (yourBestEl && d.yourRank != null && d.yourScore != null) {
    yourBestEl.textContent = `Your best: #${d.yourRank} · ${d.yourScore.toLocaleString()}`;
  }
}
