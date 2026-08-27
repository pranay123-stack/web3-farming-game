/**
 * Cosmetic metadata only.
 *
 * Every number that matters - growth time, cost, yield, XP, level gate - is
 * read from `GameManager` at runtime. This file holds nothing but the artwork
 * layer, keyed by the on-chain id. The previous version hardcoded eight seed
 * types and four recipes that did not exist on-chain, with ids offset by one
 * from the real registry, so the UI described a game the contracts had never
 * heard of.
 *
 * An id with no entry here still renders, using {fallbackSeedMeta} /
 * {fallbackRecipeMeta} - adding content on-chain never breaks the client.
 */

export interface SeedMeta {
  name: string
  emoji: string
  cropEmoji: string
  description: string
  accent: string
}

export interface RecipeMeta {
  name: string
  emoji: string
  description: string
}

export const SEED_META: Record<number, SeedMeta> = {
  0: {
    name: 'Wheat',
    emoji: '🌱',
    cropEmoji: '🌾',
    description: 'Fast and dependable. The bread and butter of a new farm.',
    accent: '#d9a441',
  },
  1: {
    name: 'Corn',
    emoji: '🌱',
    cropEmoji: '🌽',
    description: 'A longer wait for a noticeably better margin.',
    accent: '#f2c14e',
  },
  2: {
    name: 'Tomato',
    emoji: '🌱',
    cropEmoji: '🍅',
    description: 'An hour in the ground, and worth every minute.',
    accent: '#e2574c',
  },
  3: {
    name: 'Golden Apple',
    emoji: '✨',
    cropEmoji: '🍎',
    description: 'The endgame crop. Four hours, and a fortune.',
    accent: '#f5d76e',
  },
}

export const RECIPE_META: Record<number, RecipeMeta> = {
  0: { name: 'Basic Hoe', emoji: '🪓', description: 'A sturdy starter tool.' },
  1: { name: 'Watering Can', emoji: '🪣', description: 'Every farm needs one.' },
  2: { name: 'Fertilizer', emoji: '🧪', description: 'Brewed down from your own harvest.' },
  3: { name: 'Steel Hoe', emoji: '⛏️', description: 'Forged for a serious operation.' },
  4: { name: 'Golden Scythe', emoji: '🌟', description: 'The mark of a master farmer.' },
}

export function fallbackSeedMeta(seedTypeId: number): SeedMeta {
  return {
    name: `Seed #${seedTypeId}`,
    emoji: '🌱',
    cropEmoji: '🌿',
    description: 'A crop the world has only just learned to grow.',
    accent: '#7bb662',
  }
}

export function fallbackRecipeMeta(recipeId: number): RecipeMeta {
  return {
    name: `Recipe #${recipeId}`,
    emoji: '🔨',
    description: 'A newly published blueprint.',
  }
}

export function seedMeta(seedTypeId: number): SeedMeta {
  return SEED_META[seedTypeId] ?? fallbackSeedMeta(seedTypeId)
}

export function recipeMeta(recipeId: number): RecipeMeta {
  return RECIPE_META[recipeId] ?? fallbackRecipeMeta(recipeId)
}

// Mirrors FarmNFT.ItemType
export enum ItemType {
  TOOL = 0,
  SEED = 1,
  CROP = 2,
  AVATAR = 3,
  CONSUMABLE = 4,
}

// Mirrors FarmNFT.Rarity
export enum Rarity {
  COMMON = 0,
  UNCOMMON = 1,
  RARE = 2,
  EPIC = 3,
  LEGENDARY = 4,
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  [ItemType.TOOL]: 'Tool',
  [ItemType.SEED]: 'Seed',
  [ItemType.CROP]: 'Crop',
  [ItemType.AVATAR]: 'Avatar',
  [ItemType.CONSUMABLE]: 'Consumable',
}

export const RARITY_LABEL: Record<Rarity, string> = {
  [Rarity.COMMON]: 'Common',
  [Rarity.UNCOMMON]: 'Uncommon',
  [Rarity.RARE]: 'Rare',
  [Rarity.EPIC]: 'Epic',
  [Rarity.LEGENDARY]: 'Legendary',
}

export const RARITY_COLOR: Record<Rarity, string> = {
  [Rarity.COMMON]: '#9aa4b2',
  [Rarity.UNCOMMON]: '#5cb85c',
  [Rarity.RARE]: '#4a9ede',
  [Rarity.EPIC]: '#a06fd6',
  [Rarity.LEGENDARY]: '#e8b339',
}

/** Emoji for an inventory item, preferring the crop art for harvested goods. */
export function itemEmoji(itemType: number, seedTypeId: number): string {
  if (itemType === ItemType.CROP) return seedMeta(seedTypeId).cropEmoji
  if (itemType === ItemType.SEED) return seedMeta(seedTypeId).emoji
  if (itemType === ItemType.CONSUMABLE) return '🧪'
  if (itemType === ItemType.AVATAR) return '🧑‍🌾'
  return '🔨'
}

export function itemName(itemType: number, seedTypeId: number): string {
  if (itemType === ItemType.CROP) return `${seedMeta(seedTypeId).name} Crop`
  if (itemType === ItemType.SEED) return `${seedMeta(seedTypeId).name} Seed`
  return ITEM_TYPE_LABEL[itemType as ItemType] ?? 'Item'
}
