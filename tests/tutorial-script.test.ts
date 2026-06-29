import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_DIALOGUE,
  getTutorialDialogue,
  personalize,
} from '../src/shared/tutorial-script';
import { TUTORIAL_STEP_ORDER } from '../src/shared/tutorial-types';

describe('TUTORIAL_DIALOGUE', () => {
  it('has dialogue for every step', () => {
    for (const step of TUTORIAL_STEP_ORDER) {
      expect(TUTORIAL_DIALOGUE[step], `missing dialogue for ${step}`).toBeDefined();
    }
  });

  it('every step normalizes to a non-empty array', () => {
    for (const step of TUTORIAL_STEP_ORDER) {
      const lines = getTutorialDialogue(step);
      expect(lines.length, `empty dialogue for ${step}`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.length, `empty line in ${step}`).toBeGreaterThan(0);
      }
    }
  });

  it('play-tutorial has one line per gameplay phase + outro (8 total)', () => {
    // 8 phases: taps+chords, lane-styling, holds, slides, 2-slides,
    // double-slides, insane, outro+menu-mock.
    expect(getTutorialDialogue('play-tutorial').length).toBe(8);
  });

  it('stage-set-confirm exists (replaces dressing-walkthrough — the orchestrator now handles auto-equip itself)', () => {
    expect(getTutorialDialogue('stage-set-confirm').length).toBeGreaterThan(0);
  });
});

describe('personalize', () => {
  it('replaces <poster> with u/<username>', () => {
    expect(personalize("back to <poster>'s show!", 'timmymmit')).toBe(
      "back to u/timmymmit's show!",
    );
  });

  it("falls back to 'your friend' when no username is provided", () => {
    expect(personalize("back to <poster>'s show!", undefined)).toBe(
      "back to your friend's show!",
    );
  });

  it('leaves lines without <poster> unchanged', () => {
    expect(personalize("you're all set!", 'anyone')).toBe("you're all set!");
  });
});
