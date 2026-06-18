export type CatBreed = 'cat1' | 'cat2' | 'cat3';

export type CatAnimationState =
  | 'idle'
  | 'lick'
  | 'meow'
  | 'sleep'
  | 'stretch'
  | 'happy'
  | 'hiss';

export interface CatModel {
  id: string;
  breed: CatBreed;
  animation: CatAnimationState;
  x: number; // 0–100 percent of background width
  y: number; // 0–100 percent of background height
}

export type InteractionType = 'pet' | 'chinScratch' | 'bellyRub';

export type InteractionOutcome = 'success' | 'fail';

export interface RhythmTapResult {
  kind: 'miss' | 'hit' | 'perfect';
  pointsAwarded: number;
}
