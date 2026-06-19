/**
 * Single source of truth for cat / cosmetic / box catalogs and player state.
 *
 * Imported by both the Phaser client and the Devvit Hono server so the two
 * sides can never disagree about drop tables, prices, or item lists. The
 * server uses these to roll boxes and validate adoption; the client uses
 * them to render names, rarity badges, and shop UI.
 */

// -- Item identifiers ---------------------------------------------------

export type CatBreed =
  | 'cat1'
  | 'cat2'
  | 'cat3'
  | 'cat4'
  | 'cat5'
  | 'cat6'
  | 'rainbow';

export type CosmeticId =
  | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9'
  | 'c10' | 'c11' | 'c12' | 'c13' | 'c14' | 'c15' | 'c16' | 'c17';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type BoxId =
  | 'catCrate'
  | 'premiumCatCrate'
  | 'stylePack'
  | 'premiumStylePack';

// -- Catalog entries ----------------------------------------------------

export interface CatEntry {
  id: CatBreed;
  name: string;
  rarity: Rarity;
}

export interface CosmeticEntry {
  id: CosmeticId;
  name: string;
  rarity: Rarity;
}

export interface BoxConfig {
  id: BoxId;
  cost: number;
  rewardKind: 'cat' | 'cosmetic';
  /** Drop weights by rarity. Must sum to 100 (enforced by tests). */
  rates: Record<Rarity, number>;
}

// -- Cat catalog --------------------------------------------------------

export const CAT_CATALOG: readonly CatEntry[] = [
  { id: 'cat1', name: 'Mochi', rarity: 'common' },
  { id: 'cat2', name: 'Biscuit', rarity: 'common' },
  { id: 'cat3', name: 'Pebble', rarity: 'common' },
  { id: 'cat4', name: 'Marble', rarity: 'uncommon' },
  { id: 'cat5', name: 'Saffron', rarity: 'rare' },
  { id: 'cat6', name: 'Inkwell', rarity: 'rare' },
  { id: 'rainbow', name: 'Rainbow Whiskers', rarity: 'legendary' },
];

// -- Cosmetic catalog ---------------------------------------------------

export const COSMETIC_CATALOG: readonly CosmeticEntry[] = [
  // 8 common
  { id: 'c1', name: 'Plain Bandana', rarity: 'common' },
  { id: 'c2', name: 'Bow Tie', rarity: 'common' },
  { id: 'c3', name: 'Tiny Scarf', rarity: 'common' },
  { id: 'c4', name: 'Striped Sock', rarity: 'common' },
  { id: 'c5', name: 'Polka Dot', rarity: 'common' },
  { id: 'c6', name: 'Flower Crown', rarity: 'common' },
  { id: 'c7', name: 'Toy Mouse', rarity: 'common' },
  { id: 'c8', name: 'Yarn Ball', rarity: 'common' },
  // 5 uncommon
  { id: 'c9', name: 'Cowboy Hat', rarity: 'uncommon' },
  { id: 'c10', name: 'Reading Glasses', rarity: 'uncommon' },
  { id: 'c11', name: 'Mustache', rarity: 'uncommon' },
  { id: 'c12', name: 'Tiny Sweater', rarity: 'uncommon' },
  { id: 'c13', name: 'Feather Boa', rarity: 'uncommon' },
  // 3 rare
  { id: 'c14', name: 'Pirate Hat', rarity: 'rare' },
  { id: 'c15', name: 'Cape', rarity: 'rare' },
  { id: 'c16', name: 'Astronaut Helmet', rarity: 'rare' },
  // 1 legendary
  { id: 'c17', name: 'Crown of Treats', rarity: 'legendary' },
];

// -- Box catalog --------------------------------------------------------

export const BOX_CATALOG: Record<BoxId, BoxConfig> = {
  catCrate: {
    id: 'catCrate',
    cost: 200,
    rewardKind: 'cat',
    rates: { common: 70, uncommon: 25, rare: 5, legendary: 0 },
  },
  premiumCatCrate: {
    id: 'premiumCatCrate',
    cost: 1000,
    rewardKind: 'cat',
    rates: { common: 0, uncommon: 40, rare: 50, legendary: 10 },
  },
  stylePack: {
    id: 'stylePack',
    cost: 50,
    rewardKind: 'cosmetic',
    rates: { common: 70, uncommon: 25, rare: 5, legendary: 0 },
  },
  premiumStylePack: {
    id: 'premiumStylePack',
    cost: 250,
    rewardKind: 'cosmetic',
    rates: { common: 0, uncommon: 40, rare: 50, legendary: 10 },
  },
};

// -- Economy constants --------------------------------------------------

/** Fresh users get this many coins on first state load. Enough for one
 * Cat Crate (200) + one Style Pack (50), with 50 left over. */
export const STARTER_COINS = 300;

/** Duplicate pulls return this many coins as a soft refund. */
export const DUPLICATE_REFUND = 50;

// -- Player state -------------------------------------------------------

export interface PlayerState {
  /** Reddit username — the key under which this lives in Redis. */
  username: string;
  coins: number;
  ownedCats: CatBreed[];
  ownedCosmetics: CosmeticId[];
  /** Map of catBreed -> cosmeticId currently worn by that cat. */
  equippedCosmetics: Partial<Record<CatBreed, CosmeticId>>;
  bestScore: number;
  /** True after the player has completed the Welcome scene. */
  onboardingDone: boolean;
  /** Unix-ms of last write. */
  updatedAt: number;
}
