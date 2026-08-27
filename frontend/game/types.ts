import type { Facing } from '@/shared/protocol'

/** A plot as the renderer needs it - chain data flattened for drawing. */
export interface ScenePlot {
  tokenId: string
  x: number
  y: number
  level: number
  fertility: number
  /** null when nothing is planted. */
  crop: {
    seedTypeId: number
    plantedAt: number
    harvestAt: number
    emoji: string
    cropEmoji: string
    accent: string
  } | null
}

export interface SceneRemotePlayer {
  id: string
  username: string
  x: number
  y: number
  facing: Facing
  moving: boolean
}

/**
 * Everything the scene is allowed to know about the outside world.
 *
 * Deliberately narrow: the scene renders plots and reports intent. It never
 * reads balances, submits transactions, or decides whether an action is legal
 * - that is the contract's job, mediated by React.
 */
export interface SceneBridge {
  /** Server-anchored clock, in seconds. */
  now(): number
  /** Called when the player clicks a plot they own. */
  onPlotSelected(tokenId: string | null): void
  /** Called when the player clicks a ready crop. */
  onHarvestRequested(tokenId: string): void
  /** Throttled local movement, forwarded to the multiplayer server. */
  onMove(x: number, y: number, facing: Facing, moving: boolean): void
}

export interface SceneInit {
  bridge: SceneBridge
  playerAddress: string | null
}

export const TILE_SIZE = 32
