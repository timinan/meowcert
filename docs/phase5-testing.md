# Phase 5 Core Loop Testing Plan

Living tracker for end-to-end testing of the Phase 5 redesign. Each flow gets tested in order; don't mix flows. Update status + bugs as we go.

**Branch:** `phase5-vertical-gameplay`
**Playtest URL:** https://www.reddit.com/r/pspspsgame_dev/?playtest=pspspsgame
**Spec:** `/Users/timnan/Documents/GitHub/PM-OS/outputs/prds/2026-06-21-pspsps-phase5-spec.md`

---

## Flow status overview

| Flow | Status | Notes |
|---|---|---|
| 0 — Hamburger nav + asset visuals | ✅ FIXED (`ff38071`) | Confirm in next playtest |
| 1 — Purchase (boxes → inventory) | 🟡 SETUP IN PROGRESS | First to test |
| 2 — Decorate + DressingRoom | ⬜ NOT STARTED | Needs Flow 1 inventory |
| 3 — Play (random fallback chart) | ⬜ NOT STARTED | Needs Flow 2 seated cat |
| 4 — Editor (author chart) | ⬜ NOT STARTED | Needs Flows 1-3 |

---

## Flow 0 — Hamburger nav + asset visuals

**Issue summary:** Hamburger drawer item taps froze the Game scene. Lanes / hit zones / falling notes were procedural Rectangles instead of the original Phase 1 art.

**Fix (commit `ff38071`):**
- TopHud drawer item handler now fires `item.onTap()` synchronously (was `delayedCall(180)` which could be cancelled mid-flight by the time manager teardown). Wrapped in try/catch so destination-scene errors surface in console.
- `Game.drawLanes()` now uses `AssetKeys.Image.RhythmBarBackground` (vertical, tinted per lane) for backdrops and `AssetKeys.Image.PspspsTarget` (the original fuzzy ball target) for hit zones.
- `Note` entity now composites `AssetKeys.Image.PspspsElementBall` (lane-tinted) + `PspspsElementLetters` (clean white) instead of a Graphics circle.

**Verify in next playtest:**
- [ ] Hamburger → tap any menu item → scene navigates cleanly
- [ ] Lane backdrops use the bar art (blue/purple/yellow tinted)
- [ ] Hit target is the fuzzy ball
- [ ] Falling notes are the PS ball with letters

---

## Flow 1 — Purchase (inventory gateway)

**Why first:** Nothing else works without inventory. Decorate needs cats; DressingRoom needs cosmetics; Play needs seated cats; Editor cares about authoring (works without inventory but pointless to test alone).

### What to test

1. Open Purchase via hamburger → see 3 boxes (Cat / Cosmetic / Background) with prices
2. Affordable boxes are tappable; unaffordable show red "🪙 N · need N more"
3. Tap a box → box-open animation → item reveal → coins deducted
4. Inventory grows: `ownedCats`, `ownedCosmetics`, `ownedBackgrounds` arrays
5. Duplicate pull → 50-coin refund (buy same box twice; second pull should refund if dupe)
6. Coin balance in topbar updates immediately
7. Hamburger from Purchase → clean nav back to any other scene

### Dev setup (done by me)

- `DEV_RESET_ON_LOAD = true` in `src/server/routes/state.ts:20` — fresh state per reload
- `DEV_STARTER_COINS = 5000` — already set
- Debug inventory panel in Purchase scene (top-right corner) showing current `cats / cosmetics / bgs` counts. Toggle via `DEV_SHOW_INVENTORY` flag.

### Done bar

- Bought at least 2 cats, 2 cosmetics, 1 background
- All show up in your state (counts visible in debug panel)
- No console errors
- No freezes / crashes / weird UI states

### Bugs found

_(Update as we go)_

---

## Flow 2 — Decorate + DressingRoom

**Prereq:** Flow 1 done, inventory populated.

### What to test

1. Open Decorate via hamburger
2. Top half: 3-cat preview with current backdrop
3. CATS tab tray: shows your owned cats; tap → seats into next open slot; tap a seated one (✓ badge) → unseats
4. Tap a seated cat in the preview → DressingRoom opens with that cat
5. DressingRoom: cat preview + owned cosmetics; tap a cosmetic → equips; tap back → Decorate shows the equipped cosmetic
6. BACKGROUNDS tab: shows owned backgrounds; tap one → backdrop swaps live, ✓ moves
7. Hamburger from Decorate / DressingRoom → clean nav

### Dev setup (TBD)

- `DEV_SKIP_ONBOARDING` flag so we can land straight in Decorate with seeded inventory (skip Welcome)
- Confirm `setBackground` endpoint persists choice across reloads

### Done bar

- 3 seated cats, each wearing a different cosmetic
- Non-default background active
- Reload page → setup persists

### Bugs found

_(empty)_

---

## Flow 3 — Play (random fallback chart)

**Prereq:** Flow 2 done — at least 1 seated cat.

### What to test

1. Open Game via hamburger
2. Backdrop + seated cats render above lanes (matches Decorate preview)
3. Lane bars show with target balls at the bottom
4. Notes fall from top
5. Tap (or 1/2/3 keys) catches notes → lane's cat plays happy
6. Miss → cat plays angry, combo resets
7. Round finishes (8 loops) → summary overlay with score / accuracy / max combo / misses
8. Skip button → back to Decorate
9. Hamburger during play → clean nav (this was the bug we just fixed)

### Dev setup (TBD)

- Replace dev fallback `emptyChart('dev','test')` in `Game.initChartPlayer()` with a `RandomChartSource` that spawns notes at a fixed BPM with random lanes. Faithful to old Phase 1 RhythmSystem feel.
- Make it kick in when `playerState.chart.steps` is all empty (so Flow 4's authored chart takes priority once it exists)

### Done bar

- Played 2-3 full rounds without crashes
- Hits + misses register correctly
- Cats react in the right lanes
- Summary stats look right
- Navigation works mid-round and post-round

### Bugs found

_(empty)_

---

## Flow 4 — Editor (author a chart)

**Prereq:** Flows 1-3 done.

### What to test

1. Open ChartEditor via hamburger (Post tab)
2. 3×8 grid, lane labels in lane colors
3. Tap a cell → toggles note (lit in lane color); tap again → un-toggles
4. Toggle ~10 cells across all 3 lanes
5. Tap ▶ Play preview → scan line scrolls top→bottom; lit cells flash on the beat
6. Tap Clear → all cells reset
7. Tap BPM button → cycles 80/100/120/140/160; preview restarts if playing
8. Tap POST → saves chart, routes back to Game
9. Game plays your authored chart (not the random one)
10. Reload page → chart persists from server

### Dev setup (TBD)

- Verify `validateChart()` rejects invalid input at POST time
- Maybe: loopable preview mode for easier editing
- **Defer:** HTML input for editable title (currently read-only)
- **Defer:** Devvit `Reddit.submitPost` real call (currently stubbed log+route)

### Done bar

- Author a chart, save it, exit, come back, play your own beat
- End-to-end loop complete

### Bugs found

_(empty)_

---

## Pre-ship cleanup (after Flow 4 green)

- [ ] `DEV_RESET_ON_LOAD = false`
- [ ] `DEV_STARTER_COINS` removed or `STARTER_COINS` (currently 600) — decide ship value
- [ ] `DEV_SHOW_INVENTORY` removed or guarded
- [ ] `DEV_SKIP_ONBOARDING` removed
- [ ] Update `outputs/portfolio/pspsps-session-state.md` with Phase 5 shipped state
- [ ] Devvit submit-post wired (for real comment posting on round end)
- [ ] HTML title input in ChartEditor (or accept the read-only fallback for v1)
