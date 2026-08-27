import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useWalletStore, walletActions, selectCanTransact, selectIsWrongNetwork,
  __resetWalletModuleState,
} from '@/lib/state/walletStore'
import { useWallet, __resetRestoreGuard } from '@/hooks/useWallet'
import { TARGET_CHAIN_ID } from '@/lib/chains'

/**
 * Wallet session behaviour.
 *
 * The regression that matters most here: the old hook put the whole Zustand
 * store object in its `useCallback` deps, so `connect` had a new identity on
 * every render, which re-fired the effect that called `connect`, which
 * re-rendered - an unbounded loop of MetaMask account requests.
 */

interface MockEthereum {
  isMetaMask: boolean
  request: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  _handlers: Record<string, (...args: unknown[]) => void>
  _emit(event: string, ...args: unknown[]): void
}

function installMockWallet(options: {
  accounts?: string[]
  chainId?: number
  rejectRequest?: boolean
} = {}): MockEthereum {
  const {
    accounts = ['0x1111111111111111111111111111111111111111'],
    chainId = TARGET_CHAIN_ID,
    rejectRequest = false,
  } = options

  const handlers: Record<string, (...args: unknown[]) => void> = {}

  const ethereum: MockEthereum = {
    isMetaMask: true,
    _handlers: handlers,
    request: vi.fn(async ({ method }: { method: string }) => {
      if (rejectRequest && method === 'eth_requestAccounts') {
        throw { code: 4001, message: 'User rejected the request' }
      }
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return accounts
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'wallet_switchEthereumChain':
          return null
        case 'eth_getBalance':
          return '0x' + (10n ** 18n).toString(16)
        case 'net_version':
          return String(chainId)
        default:
          return null
      }
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler
    }),
    removeListener: vi.fn(),
    _emit(event, ...args) {
      handlers[event]?.(...args)
    },
  }

  ;(window as unknown as { ethereum: MockEthereum }).ethereum = ethereum
  return ethereum
}

beforeEach(() => {
  __resetWalletModuleState()
  __resetRestoreGuard()
  delete (window as unknown as { ethereum?: unknown }).ethereum
})

describe('walletActions', () => {
  it('reports an unavailable wallet when nothing is injected', async () => {
    await walletActions.restore()
    expect(useWalletStore.getState().status).toBe('unavailable')
  })

  it('restores silently with eth_accounts, never eth_requestAccounts', async () => {
    const ethereum = installMockWallet()
    await walletActions.restore()

    const methods = ethereum.request.mock.calls.map((call) => call[0].method)
    expect(methods).toContain('eth_accounts')
    // A silent restore must never open the wallet prompt.
    expect(methods).not.toContain('eth_requestAccounts')
  })

  it('stays disconnected when no account is authorised', async () => {
    installMockWallet({ accounts: [] })
    await walletActions.restore()
    expect(useWalletStore.getState().status).toBe('disconnected')
  })

  it('records a rejection without treating it as an error to display', async () => {
    installMockWallet({ rejectRequest: true })
    const connected = await walletActions.connect()

    expect(connected).toBe(false)
    const state = useWalletStore.getState()
    expect(state.status).toBe('disconnected')
    // Declining is a choice, not a failure worth shouting about.
    expect(state.error).toBeNull()
  })

  it('reports an error when there is no wallet to connect to', async () => {
    const connected = await walletActions.connect()
    expect(connected).toBe(false)
    expect(useWalletStore.getState().status).toBe('unavailable')
  })

  it('clears the session on disconnect and bumps the epoch', () => {
    useWalletStore.setState({
      status: 'connected',
      address: '0xabc',
      chainId: TARGET_CHAIN_ID,
      epoch: 3,
    })
    walletActions.disconnect()

    const state = useWalletStore.getState()
    expect(state.status).toBe('disconnected')
    expect(state.address).toBeNull()
    expect(state.signer).toBeNull()
    // Consumers key their refetch on the epoch, so it must advance.
    expect(state.epoch).toBe(4)
  })

  it('attaches EIP-1193 listeners exactly once', async () => {
    const ethereum = installMockWallet()
    walletActions.attachListeners()
    walletActions.attachListeners()
    walletActions.attachListeners()

    const accountListeners = ethereum.on.mock.calls.filter((c) => c[0] === 'accountsChanged')
    expect(accountListeners).toHaveLength(1)
  })
})

describe('selectors', () => {
  it('flags a wrong network only while connected', () => {
    expect(selectIsWrongNetwork({ status: 'disconnected', chainId: 1 } as never)).toBe(false)
    expect(selectIsWrongNetwork({ status: 'connected', chainId: 1 } as never)).toBe(true)
    expect(selectIsWrongNetwork({ status: 'connected', chainId: TARGET_CHAIN_ID } as never)).toBe(false)
  })

  it('requires a signer on the right chain before allowing writes', () => {
    const base = { status: 'connected', signer: {}, chainId: TARGET_CHAIN_ID } as never
    expect(selectCanTransact(base)).toBe(true)
    expect(selectCanTransact({ ...(base as object), signer: null } as never)).toBe(false)
    expect(selectCanTransact({ ...(base as object), chainId: 1 } as never)).toBe(false)
    expect(selectCanTransact({ ...(base as object), status: 'connecting' } as never)).toBe(false)
  })
})

describe('useWallet', () => {
  /**
   * Directly targets the render loop: if the returned actions were unstable,
   * the restore effect would re-run and the request count would climb.
   */
  it('returns a stable action surface across re-renders', () => {
    installMockWallet()
    const { result, rerender } = renderHook(() => useWallet())

    const first = {
      connect: result.current.connect,
      disconnect: result.current.disconnect,
      switchNetwork: result.current.switchNetwork,
    }

    rerender()
    rerender()
    rerender()

    expect(result.current.connect).toBe(first.connect)
    expect(result.current.disconnect).toBe(first.disconnect)
    expect(result.current.switchNetwork).toBe(first.switchNetwork)
  })

  it('does not re-request accounts on every render', async () => {
    const ethereum = installMockWallet()
    const { rerender } = renderHook(() => useWallet())

    // Let the initial silent restore finish before taking a baseline; it makes
    // several legitimate calls (accounts, chain id, signer, balance).
    await waitFor(() => {
      expect(useWalletStore.getState().status).toBe('connected')
    })
    await new Promise((r) => setTimeout(r, 50))

    const callsAfterMount = ethereum.request.mock.calls.length
    rerender()
    rerender()
    rerender()
    await new Promise((r) => setTimeout(r, 50))

    // The old hook re-ran its restore effect on every render, so this count
    // grew without bound and MetaMask was hammered with account requests.
    expect(ethereum.request.mock.calls.length).toBe(callsAfterMount)
  })

  it('exposes the target chain for the network-mismatch UI', () => {
    installMockWallet()
    const { result } = renderHook(() => useWallet())
    expect(result.current.targetChain.chainId).toBe(TARGET_CHAIN_ID)
  })

  it('reflects a wrong-network session', () => {
    installMockWallet()
    useWalletStore.setState({ status: 'connected', address: '0xabc', chainId: 999, signer: {} as never })
    const { result } = renderHook(() => useWallet())

    expect(result.current.isWrongNetwork).toBe(true)
    expect(result.current.canTransact).toBe(false)
  })
})
