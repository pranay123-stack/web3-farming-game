import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { create } from 'zustand'
import { TARGET_CHAIN, TARGET_CHAIN_ID, isSupportedChain, toHexChainId } from '../chains'

export type WalletStatus =
  | 'detecting'     // still checking for an injected provider (SSR + first paint)
  | 'unavailable'   // no injected provider
  | 'disconnected'
  | 'connecting'
  | 'connected'

export interface WalletState {
  status: WalletStatus
  /**
   * Whether an injected provider exists. `null` until the client has looked.
   *
   * Kept in state rather than computed during render: `window.ethereum` does
   * not exist on the server, so calling the detector inline made the server
   * and the client disagree on the first paint - a hydration mismatch that
   * flashed an "install a wallet" prompt at people who already had one.
   */
  walletDetected: boolean | null
  address: string | null
  chainId: number | null
  nativeBalance: bigint | null
  provider: BrowserProvider | null
  signer: JsonRpcSigner | null
  error: string | null
  /** Bumped whenever the account or chain changes, so consumers can refetch. */
  epoch: number
}

const INITIAL: WalletState = {
  status: 'detecting',
  walletDetected: null,
  address: null,
  chainId: null,
  nativeBalance: null,
  provider: null,
  signer: null,
  error: null,
  epoch: 0,
}

export const useWalletStore = create<WalletState>(() => ({ ...INITIAL }))

/**
 * Actions live outside the store hook and mutate via `setState`.
 *
 * This is the fix for the old `useWallet`: it read the whole Zustand store
 * object inside `useCallback` dependency arrays, so every render produced a
 * new `connect` identity, which re-triggered the effect that called `connect`,
 * which re-rendered... a render loop that spammed MetaMask with account
 * requests. Keeping actions as module-level constants makes their identity
 * permanently stable.
 */

function getEthereum(): any | null {
  if (typeof window === 'undefined') return null
  return (window as any).ethereum ?? null
}

export function hasInjectedWallet(): boolean {
  return getEthereum() !== null
}

// Tracks WHICH provider object listeners are bound to, not merely that they
// were bound once. A wallet installed after page load, or an extension that
// replaces window.ethereum, would otherwise never get listeners attached.
let listenedProvider: unknown = null
let refreshInFlight: Promise<void> | null = null

/** Rebuilds provider + signer from scratch. Never reuses a stale signer. */
async function rebuildSession(accounts: string[]): Promise<void> {
  const ethereum = getEthereum()
  if (!ethereum || accounts.length === 0) {
    walletActions.handleDisconnect()
    return
  }

  const provider = new BrowserProvider(ethereum)
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)
  const address = accounts[0]

  // The signer must be derived after the account is known; carrying an old
  // signer across an account switch would sign as the previous wallet.
  const signer = await provider.getSigner(address)

  let nativeBalance: bigint | null = null
  try {
    nativeBalance = await provider.getBalance(address)
  } catch {
    nativeBalance = null
  }

  useWalletStore.setState((prev) => ({
    status: 'connected',
    address,
    chainId,
    provider,
    signer,
    nativeBalance,
    error: null,
    epoch: prev.epoch + 1,
  }))
}

export const walletActions = {
  /** Silent restore. Uses eth_accounts, which never prompts. */
  async restore(): Promise<void> {
    const ethereum = getEthereum()
    if (!ethereum) {
      useWalletStore.setState({ status: 'unavailable', walletDetected: false })
      return
    }
    useWalletStore.setState({ walletDetected: true })
    walletActions.attachListeners()
    try {
      const accounts: string[] = await ethereum.request({ method: 'eth_accounts' })
      if (accounts.length > 0) {
        await rebuildSession(accounts)
      } else {
        useWalletStore.setState({ status: 'disconnected' })
      }
    } catch {
      useWalletStore.setState({ status: 'disconnected' })
    }
  },

  /** Explicit connect. Prompts the wallet. */
  async connect(): Promise<boolean> {
    const ethereum = getEthereum()
    if (!ethereum) {
      useWalletStore.setState({
        status: 'unavailable',
        walletDetected: false,
        error: 'No Ethereum wallet detected.',
      })
      return false
    }

    useWalletStore.setState({ status: 'connecting', walletDetected: true, error: null })
    walletActions.attachListeners()

    try {
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts || accounts.length === 0) {
        useWalletStore.setState({ status: 'disconnected', error: 'No accounts available.' })
        return false
      }
      await rebuildSession(accounts)
      return true
    } catch (error: any) {
      const rejected = error?.code === 4001
      useWalletStore.setState({
        status: 'disconnected',
        error: rejected ? null : (error?.message ?? 'Failed to connect wallet.'),
      })
      return false
    }
  },

  /**
   * Clears local session state.
   *
   * EIP-1193 has no "disconnect" - this forgets the wallet for this tab only,
   * and the UI says so rather than implying the wallet was revoked.
   */
  disconnect(): void {
    useWalletStore.setState((prev) => ({
      ...INITIAL,
      status: 'disconnected',
      walletDetected: prev.walletDetected,
      epoch: prev.epoch + 1,
    }))
  },

  handleDisconnect(): void {
    useWalletStore.setState((prev) => ({
      ...INITIAL,
      status: 'disconnected',
      walletDetected: prev.walletDetected,
      epoch: prev.epoch + 1,
    }))
  },

  /** Asks the wallet to switch to the target chain, adding it if unknown. */
  async switchToTargetChain(): Promise<boolean> {
    const ethereum = getEthereum()
    if (!ethereum) return false
    const hexChainId = toHexChainId(TARGET_CHAIN_ID)

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      })
      return true
    } catch (error: any) {
      const code = error?.code ?? error?.data?.originalError?.code
      if (code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hexChainId,
              chainName: TARGET_CHAIN.name,
              rpcUrls: TARGET_CHAIN.rpcUrls,
              blockExplorerUrls: TARGET_CHAIN.blockExplorer ? [TARGET_CHAIN.blockExplorer] : [],
              nativeCurrency: TARGET_CHAIN.nativeCurrency,
            }],
          })
          return true
        } catch {
          return false
        }
      }
      if (code === 4001) return false
      return false
    }
  },

  async refreshNativeBalance(): Promise<void> {
    if (refreshInFlight) return refreshInFlight
    const { provider, address } = useWalletStore.getState()
    if (!provider || !address) return
    refreshInFlight = (async () => {
      try {
        const balance = await provider.getBalance(address)
        useWalletStore.setState({ nativeBalance: balance })
      } catch {
        // Leave the previous value rather than showing a wrong one.
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  },

  /** Idempotent per provider. EIP-1193 events drive every session rebuild. */
  attachListeners(): void {
    const ethereum = getEthereum()
    if (!ethereum || listenedProvider === ethereum) return
    listenedProvider = ethereum

    ethereum.on('accountsChanged', (accounts: string[]) => {
      if (!accounts || accounts.length === 0) {
        walletActions.handleDisconnect()
      } else {
        // Full rebuild: a new account needs a new signer, not a patched address.
        void rebuildSession(accounts)
      }
    })

    ethereum.on('chainChanged', () => {
      // The provider caches the network, so it must be rebuilt outright.
      void (async () => {
        try {
          const accounts: string[] = await ethereum.request({ method: 'eth_accounts' })
          if (accounts.length > 0) {
            await rebuildSession(accounts)
          } else {
            walletActions.handleDisconnect()
          }
        } catch {
          walletActions.handleDisconnect()
        }
      })()
    })

    ethereum.on('disconnect', () => {
      walletActions.handleDisconnect()
    })
  },
} as const

// --- selectors ------------------------------------------------------------

export const selectIsConnected = (s: WalletState) => s.status === 'connected' && !!s.address
export const selectIsOnTargetChain = (s: WalletState) => s.chainId === TARGET_CHAIN_ID
export const selectIsWrongNetwork = (s: WalletState) =>
  s.status === 'connected' && s.chainId !== null && s.chainId !== TARGET_CHAIN_ID
export const selectCanTransact = (s: WalletState) =>
  s.status === 'connected' && !!s.signer && s.chainId === TARGET_CHAIN_ID && isSupportedChain(s.chainId)

/**
 * Resets module-level session state. Exported for tests only - the guards it
 * clears are process-lifetime by design in the browser.
 */
export function __resetWalletModuleState(): void {
  listenedProvider = null
  refreshInFlight = null
  useWalletStore.setState({ ...INITIAL })
}
