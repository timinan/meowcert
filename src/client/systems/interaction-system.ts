import { Balance } from '@/constants/balance';
import type { InteractionType, InteractionOutcome } from '@/types/game';

export interface InteractionResult {
  outcome: InteractionOutcome;
  coinsAwarded: number;
}

/**
 * Resolves a petting attempt by checking whether the marker on the timing
 * bar was inside the chosen action's "green zone" at the moment the
 * player tapped. Each action gets a different zone width (Pet large /
 * Chin Scratch medium / Belly Rub small) with rewards scaling inversely
 * so harder targets pay more.
 */
export class InteractionSystem {
  static zoneFor(type: InteractionType): number {
    return Balance.interactionZones[type];
  }

  static rewardFor(type: InteractionType): number {
    return Balance.interactionRewards[type];
  }

  /** True if the marker fraction is inside the action's green zone. */
  static isInZone(type: InteractionType, markerFraction: number): boolean {
    const halfZone = Balance.interactionZones[type] / 2;
    return Math.abs(markerFraction - 0.5) <= halfZone;
  }

  /** Resolve a petting tap at the given marker fraction (0 = left edge, 1 = right). */
  resolve(type: InteractionType, markerFraction: number): InteractionResult {
    const success = InteractionSystem.isInZone(type, markerFraction);
    return {
      outcome: success ? 'success' : 'fail',
      coinsAwarded: success ? InteractionSystem.rewardFor(type) : 0,
    };
  }
}
