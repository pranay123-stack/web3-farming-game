import { Interface, formatUnits } from 'ethers'
import {
  FARM_TOKEN_ABI, FARM_NFT_ABI, FARM_LAND_ABI, GAME_MANAGER_ABI, MARKETPLACE_ABI,
} from './generated/abis'

/** Categories the UI reacts to differently. */
export type TxErrorKind =
  | 'rejected'          // user declined in the wallet
  | 'insufficient-gas'  // not enough native ETH
  | 'insufficient-funds'// not enough FGOLD
  | 'needs-approval'    // ERC-20 allowance too low
  | 'contract'          // a revert the contract raised deliberately
  | 'network'           // RPC unreachable / timeout
  | 'replaced'          // sped up or cancelled in the wallet
  | 'unknown'

export interface DecodedTxError {
  kind: TxErrorKind
  /** Short, player-facing. Safe to render directly. */
  title: string
  /** One sentence of actionable detail, when there is one. */
  detail?: string
  /** The raw revert name, for logs and bug reports. */
  raw?: string
  /** True when retrying unchanged could plausibly succeed. */
  retryable: boolean
}

const ERROR_INTERFACES = [
  new Interface(FARM_TOKEN_ABI as unknown as any[]),
  new Interface(FARM_NFT_ABI as unknown as any[]),
  new Interface(FARM_LAND_ABI as unknown as any[]),
  new Interface(GAME_MANAGER_ABI as unknown as any[]),
  new Interface(MARKETPLACE_ABI as unknown as any[]),
]

/**
 * Human copy for each custom error the contracts can raise. Anything absent
 * falls through to the raw name rather than a generic "transaction failed",
 * so a new contract error is still legible in the UI.
 */
type Formatter = (args: readonly unknown[]) => { title: string; detail?: string; kind?: TxErrorKind }

const CONTRACT_ERRORS: Record<string, Formatter> = {
  // --- GameManager -------------------------------------------------------
  StarterPackAlreadyClaimed: () => ({
    title: 'Starter pack already claimed',
    detail: 'Each wallet can claim the starter pack once.',
  }),
  StarterPackDisabled: () => ({
    title: 'Starter pack is closed',
    detail: 'The faucet has been turned off for this deployment.',
  }),
  LevelTooLow: (args) => ({
    title: `Requires level ${args[0]}`,
    detail: `You are level ${args[1]}. Harvest more crops to level up.`,
  }),
  NotLandOwner: () => ({
    title: 'That plot is not yours',
    detail: 'You can only farm land your wallet owns.',
  }),
  NotSeedOwner: () => ({
    title: 'You do not own that item',
  }),
  LandInUse: () => ({
    title: 'Plot is already planted',
    detail: 'Harvest the current crop before planting again.',
  }),
  NotASeed: () => ({
    title: 'That item is not a seed',
  }),
  NoActiveFarm: () => ({
    title: 'Nothing planted here',
  }),
  NotReadyToHarvest: (args) => {
    const readyAt = Number(args[1] ?? 0) * 1000
    return {
      title: 'Crop is still growing',
      detail: readyAt ? `Ready at ${new Date(readyAt).toLocaleTimeString()}.` : undefined,
    }
  },
  InvalidSeedType: () => ({ title: 'Unknown seed type' }),
  SeedTypeInactive: () => ({
    title: 'That seed is no longer sold',
    detail: 'It has been retired from the shop.',
  }),
  InvalidRecipe: () => ({ title: 'Unknown recipe' }),
  RecipeInactive: () => ({ title: 'That recipe has been retired' }),
  MaxLevelReached: () => ({
    title: 'Plot is fully upgraded',
    detail: 'This plot is already at the maximum level.',
  }),
  WrongMaterialCount: (args) => ({
    title: 'Wrong number of materials',
    detail: `This recipe needs exactly ${args[0]}; you selected ${args[1]}.`,
  }),
  WrongMaterialType: () => ({
    title: 'Wrong material type',
    detail: 'One of the selected items is not accepted by this recipe.',
  }),
  DuplicateMaterial: () => ({
    title: 'An item was selected twice',
  }),
  HarvestBonusTooHigh: () => ({ title: 'Harvest bonus exceeds the cap' }),

  // --- FarmLand ----------------------------------------------------------
  PlotIsLocked: () => ({
    title: 'Plot is locked',
    detail: 'Land with a crop growing on it cannot be transferred or upgraded.',
  }),
  PlotDoesNotExist: () => ({ title: 'That plot has not been minted' }),
  CoordinateTaken: (args) => ({
    title: 'Those coordinates are taken',
    detail: `Someone already owns the plot at (${args[0]}, ${args[1]}).`,
  }),
  CoordinateOutOfBounds: () => ({ title: 'Those coordinates are off the map' }),
  MaxSupplyReached: () => ({
    title: 'Every plot has been claimed',
    detail: 'The land supply is capped at 1000 plots.',
  }),
  NoAvailableCoordinates: () => ({ title: 'No free plots remain' }),
  InsufficientPayment: (args) => ({
    kind: 'insufficient-gas' as TxErrorKind,
    title: 'Not enough ETH sent',
    detail: `This mint costs ${formatUnits(BigInt(String(args[1] ?? 0)), 18)} ETH.`,
  }),

  // --- Marketplace -------------------------------------------------------
  ListingNotActive: () => ({
    title: 'That listing is gone',
    detail: 'It was bought or cancelled. Refresh the marketplace.',
  }),
  PriceExceedsMaximum: (args) => ({
    title: 'Price changed before your purchase',
    detail: `It now costs ${formatUnits(BigInt(String(args[0] ?? 0)), 18)} FGOLD. Refresh and try again.`,
  }),
  PriceJustChanged: () => ({
    title: 'The seller just repriced this item',
    detail: 'Wait a block and try again.',
  }),
  CannotBuyOwnItem: () => ({ title: 'That is your own listing' }),
  NotSeller: () => ({ title: 'Only the seller can do that' }),
  NotApproved: () => ({
    title: 'Marketplace is not approved',
    detail: 'Approve the marketplace to transfer this collection first.',
  }),
  NotWhitelisted: () => ({ title: 'That collection cannot be traded here' }),
  AlreadyListed: () => ({ title: 'That item is already listed' }),
  PriceMustBePositive: () => ({ title: 'Set a price above zero' }),
  TokenIsListed: () => ({ title: 'That item is in an active listing' }),
  NotTokenOwner: () => ({ title: 'You do not own that token' }),

  // --- Tokens / NFT ------------------------------------------------------
  NotMinter: () => ({
    title: 'Game contract lost its permissions',
    detail: 'This deployment is misconfigured; contact the operator.',
  }),
  UnexpectedOwner: () => ({ title: 'That item changed hands' }),
  NotOwnerNorApproved: () => ({ title: 'You are not allowed to burn that item' }),
  ItemDoesNotExist: () => ({ title: 'That item no longer exists' }),

  // --- OpenZeppelin ------------------------------------------------------
  ERC20InsufficientBalance: (args) => ({
    kind: 'insufficient-funds' as TxErrorKind,
    title: 'Not enough FGOLD',
    detail: `You need ${formatUnits(BigInt(String(args[2] ?? 0)), 18)} FGOLD but have ${formatUnits(BigInt(String(args[1] ?? 0)), 18)}.`,
  }),
  ERC20InsufficientAllowance: (args) => ({
    kind: 'needs-approval' as TxErrorKind,
    title: 'Spending approval needed',
    detail: `Approve the game to spend at least ${formatUnits(BigInt(String(args[2] ?? 0)), 18)} FGOLD.`,
  }),
  ERC721InsufficientApproval: () => ({
    kind: 'needs-approval' as TxErrorKind,
    title: 'NFT approval needed',
  }),
  ERC721NonexistentToken: () => ({ title: 'That token does not exist' }),
  ERC721IncorrectOwner: () => ({ title: 'You do not own that token' }),
  OwnableUnauthorizedAccount: () => ({
    title: 'Admin only',
    detail: 'This action is restricted to the contract owner.',
  }),
  EnforcedPause: () => ({
    title: 'The game is paused',
    detail: 'An operator has paused play. Try again shortly.',
  }),
  ReentrancyGuardReentrantCall: () => ({ title: 'Re-entrant call rejected' }),
}

function findRevertData(error: unknown): string | null {
  const seen = new Set<unknown>()
  let current: any = error
  let depth = 0
  while (current && typeof current === 'object' && depth < 8) {
    if (seen.has(current)) break
    seen.add(current)
    for (const key of ['data', 'error', 'info', 'cause', 'originalError']) {
      const value = current[key]
      if (typeof value === 'string' && value.startsWith('0x') && value.length >= 10) {
        return value
      }
    }
    current = current.error ?? current.info ?? current.cause ?? current.originalError
    depth++
  }
  return null
}

function collectMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const anyError = error as any
  return String(
    anyError.shortMessage ?? anyError.reason ?? anyError.message ?? ''
  )
}

/** Decodes any wallet/RPC/contract failure into a message worth showing. */
export function decodeTxError(error: unknown): DecodedTxError {
  const anyError = error as any
  const message = collectMessage(error)
  const lower = message.toLowerCase()

  // 1. User rejection. Never surfaced as a failure - it is a normal choice.
  if (
    anyError?.code === 'ACTION_REJECTED' ||
    anyError?.code === 4001 ||
    anyError?.info?.error?.code === 4001 ||
    lower.includes('user rejected') ||
    lower.includes('user denied')
  ) {
    return {
      kind: 'rejected',
      title: 'Transaction cancelled',
      detail: 'You declined the request in your wallet.',
      retryable: true,
    }
  }

  // 2. Replaced / sped up.
  if (anyError?.code === 'TRANSACTION_REPLACED') {
    const replaced = anyError.replacement?.hash
    return anyError.cancelled
      ? { kind: 'replaced', title: 'Transaction cancelled in your wallet', retryable: true }
      : {
          kind: 'replaced',
          title: 'Transaction was sped up',
          detail: replaced ? `Replaced by ${replaced.slice(0, 10)}…` : undefined,
          retryable: false,
        }
  }

  // 3. A decodable custom error from one of our contracts.
  const data = findRevertData(error) ?? (typeof anyError?.data === 'string' ? anyError.data : null)
  if (data && data !== '0x') {
    for (const iface of ERROR_INTERFACES) {
      try {
        const parsed = iface.parseError(data)
        if (!parsed) continue
        const formatter = CONTRACT_ERRORS[parsed.name]
        if (formatter) {
          const out = formatter(parsed.args as unknown as readonly unknown[])
          return {
            kind: out.kind ?? 'contract',
            title: out.title,
            detail: out.detail,
            raw: parsed.name,
            retryable: false,
          }
        }
        return {
          kind: 'contract',
          title: 'The game rejected this action',
          detail: humanizeErrorName(parsed.name),
          raw: parsed.name,
          retryable: false,
        }
      } catch {
        // Not this interface's error; keep looking.
      }
    }
  }

  // 4. Plain string reverts (require(...)).
  if (anyError?.reason && typeof anyError.reason === 'string' && anyError.reason.length > 0) {
    return {
      kind: 'contract',
      title: 'The game rejected this action',
      detail: anyError.reason,
      raw: anyError.reason,
      retryable: false,
    }
  }

  // 5. Gas / balance.
  if (
    anyError?.code === 'INSUFFICIENT_FUNDS' ||
    lower.includes('insufficient funds') ||
    lower.includes('gas required exceeds')
  ) {
    return {
      kind: 'insufficient-gas',
      title: 'Not enough ETH for gas',
      detail: 'Top up your wallet with testnet ETH from a Sepolia faucet.',
      retryable: true,
    }
  }

  // 6. Network trouble.
  if (
    anyError?.code === 'NETWORK_ERROR' ||
    anyError?.code === 'TIMEOUT' ||
    anyError?.code === 'SERVER_ERROR' ||
    lower.includes('timeout') ||
    lower.includes('failed to fetch') ||
    lower.includes('could not coalesce')
  ) {
    return {
      kind: 'network',
      title: 'Network problem',
      detail: 'The RPC endpoint did not respond. Check your connection and retry.',
      retryable: true,
    }
  }

  if (anyError?.code === 'NONCE_EXPIRED' || lower.includes('nonce too low')) {
    return {
      kind: 'network',
      title: 'Transaction out of order',
      detail: 'A previous transaction is still pending. Wait for it to settle.',
      retryable: true,
    }
  }

  if (lower.includes('call_exception') || anyError?.code === 'CALL_EXCEPTION') {
    return {
      kind: 'contract',
      title: 'The game rejected this action',
      detail: 'The transaction would revert. Your state may be out of date - try refreshing.',
      retryable: false,
    }
  }

  return {
    kind: 'unknown',
    title: 'Transaction failed',
    detail: message ? message.slice(0, 180) : undefined,
    raw: message || undefined,
    retryable: true,
  }
}

function humanizeErrorName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/** True when the failure was the player choosing not to sign. */
export function isUserRejection(error: unknown): boolean {
  return decodeTxError(error).kind === 'rejected'
}
