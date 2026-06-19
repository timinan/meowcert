import { describe, it, expect } from 'vitest';
import { InteractionSystem } from '@/systems/interaction-system';
import { Balance } from '@/constants/balance';

describe('InteractionSystem (timing bar)', () => {
  const sys = new InteractionSystem();

  it('exposes the displayed zone size per action', () => {
    expect(InteractionSystem.zoneFor('pet')).toBe(Balance.interactionZones.pet);
    expect(InteractionSystem.zoneFor('chinScratch')).toBe(Balance.interactionZones.chinScratch);
    expect(InteractionSystem.zoneFor('bellyRub')).toBe(Balance.interactionZones.bellyRub);
  });

  it('exposes the reward per action', () => {
    expect(InteractionSystem.rewardFor('pet')).toBe(Balance.interactionRewards.pet);
    expect(InteractionSystem.rewardFor('chinScratch')).toBe(Balance.interactionRewards.chinScratch);
    expect(InteractionSystem.rewardFor('bellyRub')).toBe(Balance.interactionRewards.bellyRub);
  });

  it('marker exactly on center is a success for every action', () => {
    expect(sys.resolve('pet', 0.5).outcome).toBe('success');
    expect(sys.resolve('chinScratch', 0.5).outcome).toBe('success');
    expect(sys.resolve('bellyRub', 0.5).outcome).toBe('success');
  });

  it('marker just inside the zone edge is a success', () => {
    const inside = (zone: number) => 0.5 + zone / 2 - 0.001;
    expect(sys.resolve('pet', inside(Balance.interactionZones.pet)).outcome).toBe('success');
    expect(sys.resolve('chinScratch', inside(Balance.interactionZones.chinScratch)).outcome).toBe('success');
    expect(sys.resolve('bellyRub', inside(Balance.interactionZones.bellyRub)).outcome).toBe('success');
  });

  it('marker just outside the zone edge is a fail', () => {
    const outside = (zone: number) => 0.5 + zone / 2 + 0.001;
    expect(sys.resolve('pet', outside(Balance.interactionZones.pet)).outcome).toBe('fail');
    expect(sys.resolve('chinScratch', outside(Balance.interactionZones.chinScratch)).outcome).toBe('fail');
    expect(sys.resolve('bellyRub', outside(Balance.interactionZones.bellyRub)).outcome).toBe('fail');
  });

  it('marker that lands in the bellyRub zone is ALSO inside the wider zones', () => {
    // The zones are concentric around 0.5, so a perfect-center hit succeeds
    // on every action — risk/reward is a player choice, not a positional one.
    const inBellyRub = 0.5;
    expect(sys.resolve('pet', inBellyRub).outcome).toBe('success');
    expect(sys.resolve('chinScratch', inBellyRub).outcome).toBe('success');
    expect(sys.resolve('bellyRub', inBellyRub).outcome).toBe('success');
  });

  it('a marker that lands in the wide Pet zone but outside Belly Rub fails Belly Rub', () => {
    const inPetButOutsideRub = 0.5 + Balance.interactionZones.bellyRub / 2 + 0.01;
    expect(sys.resolve('pet', inPetButOutsideRub).outcome).toBe('success');
    expect(sys.resolve('bellyRub', inPetButOutsideRub).outcome).toBe('fail');
  });

  it('successful taps award the configured coin reward; misses award nothing', () => {
    const winPet = sys.resolve('pet', 0.5);
    expect(winPet.outcome).toBe('success');
    expect(winPet.coinsAwarded).toBe(Balance.interactionRewards.pet);

    const winRub = sys.resolve('bellyRub', 0.5);
    expect(winRub.coinsAwarded).toBe(Balance.interactionRewards.bellyRub);

    const miss = sys.resolve('bellyRub', 0);
    expect(miss.outcome).toBe('fail');
    expect(miss.coinsAwarded).toBe(0);
  });
});
