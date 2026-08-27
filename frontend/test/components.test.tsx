import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionFeed } from '@/components/TransactionFeed'
import { WalletConnect } from '@/components/WalletConnect'
import { useTxStore } from '@/lib/state/txStore'
import { useWalletStore, __resetWalletModuleState } from '@/lib/state/walletStore'
import { __resetRestoreGuard } from '@/hooks/useWallet'
import { TARGET_CHAIN_ID } from '@/lib/chains'

function trackedTx(overrides: Partial<import('@/lib/state/txStore').TrackedTx> = {}) {
  return {
    id: 'tx-1',
    label: 'Plant Wheat',
    status: 'pending' as const,
    hash: null,
    explorerUrl: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    blockNumber: null,
    ...overrides,
  }
}

beforeEach(() => {
  useTxStore.setState({ transactions: [] })
  __resetWalletModuleState()
  __resetRestoreGuard()
  delete (window as unknown as { ethereum?: unknown }).ethereum
})

describe('TransactionFeed', () => {
  it('renders nothing when there is no activity', () => {
    const { container } = render(<TransactionFeed />)
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * The central guarantee: a pending transaction says pending. It must never
   * present as done before a receipt has come back.
   */
  it('shows a pending transaction as pending, not successful', () => {
    useTxStore.setState({ transactions: [trackedTx({ status: 'pending', hash: '0xabc123' })] })
    render(<TransactionFeed />)

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument()
    expect(screen.getByText('Plant Wheat')).toBeInTheDocument()
  })

  it('shows confirmation only for a confirmed transaction', () => {
    useTxStore.setState({ transactions: [trackedTx({ status: 'confirmed', blockNumber: 5 })] })
    render(<TransactionFeed />)
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
  })

  it('surfaces the contract reason on a failure', () => {
    useTxStore.setState({
      transactions: [trackedTx({
        status: 'failed',
        error: {
          kind: 'contract',
          title: 'Crop is still growing',
          detail: 'Ready at 4:12:00 PM.',
          retryable: false,
        },
      })],
    })
    render(<TransactionFeed />)

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Crop is still growing')).toBeInTheDocument()
    expect(screen.getByText('Ready at 4:12:00 PM.')).toBeInTheDocument()
  })

  it('distinguishes a cancellation from a failure', () => {
    useTxStore.setState({
      transactions: [trackedTx({
        status: 'rejected',
        error: { kind: 'rejected', title: 'Transaction cancelled', retryable: true },
      })],
    })
    render(<TransactionFeed />)

    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })

  it('links a hash to the block explorer when one exists', () => {
    useTxStore.setState({
      transactions: [trackedTx({
        status: 'confirmed',
        hash: '0x' + 'a'.repeat(64),
        explorerUrl: 'https://sepolia.etherscan.io/tx/0xaaa',
      })],
    })
    render(<TransactionFeed />)

    const link = screen.getByRole('link', { name: /view/i })
    expect(link).toHaveAttribute('href', 'https://sepolia.etherscan.io/tx/0xaaa')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('omits the explorer link on a chain that has no explorer', () => {
    useTxStore.setState({
      transactions: [trackedTx({ status: 'confirmed', hash: '0xabc', explorerUrl: null })],
    })
    render(<TransactionFeed />)
    expect(screen.queryByRole('link', { name: /view/i })).not.toBeInTheDocument()
  })

  it('lets the player dismiss a toast', async () => {
    const user = userEvent.setup()
    useTxStore.setState({ transactions: [trackedTx({ status: 'failed' })] })
    render(<TransactionFeed />)

    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(useTxStore.getState().transactions).toHaveLength(0)
  })

  it('caps how many toasts are on screen at once', () => {
    useTxStore.setState({
      transactions: Array.from({ length: 10 }, (_, i) =>
        trackedTx({ id: `tx-${i}`, label: `Action ${i}` })
      ),
    })
    render(<TransactionFeed />)
    expect(screen.getAllByText(/^Action \d$/)).toHaveLength(4)
  })
})

describe('WalletConnect', () => {
  /**
   * `useWallet` runs a silent restore on mount, which settles the store on its
   * own. These tests let that finish, then put the store into the state under
   * test - otherwise the restore lands afterwards and overwrites it.
   */
  function installEthereum(accounts: string[] = []) {
    const ethereum = {
      isMetaMask: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts
        if (method === 'eth_chainId') return `0x${TARGET_CHAIN_ID.toString(16)}`
        return null
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    ;(window as unknown as { ethereum: unknown }).ethereum = ethereum
    return ethereum
  }

  async function renderInState(state: Partial<ReturnType<typeof useWalletStore.getState>>) {
    installEthereum()
    const view = render(<WalletConnect />)
    await waitFor(() => {
      expect(useWalletStore.getState().status).not.toBe('connecting')
    })
    act(() => { useWalletStore.setState(state as never) })
    return view
  }

  /**
   * Detection can only happen on the client. Deciding "install a wallet"
   * during render made the server and the client disagree on the first paint,
   * flashing that prompt at people who already had a wallet.
   */
  it('starts in a hydration-safe unknown state', () => {
    const state = useWalletStore.getState()
    expect(state.status).toBe('detecting')
    expect(state.walletDetected).toBeNull()
  })

  it('renders a neutral placeholder while detection is unresolved', () => {
    // Render once so the module-level restore guard is consumed, then put the
    // store back into the pre-detection state the first paint sees.
    render(<WalletConnect />)
    cleanup()
    act(() => {
      useWalletStore.setState({ status: 'detecting', walletDetected: null })
    })

    render(<WalletConnect />)
    expect(screen.getByRole('button', { name: /checking for a wallet/i })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /install a wallet/i })).not.toBeInTheDocument()
  })

  it('offers an install link once no wallet is confirmed', async () => {
    render(<WalletConnect />)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /install a wallet/i })).toHaveAttribute(
        'href',
        'https://metamask.io/download/'
      )
    })
  })

  it('offers connect when disconnected', async () => {
    await renderInState({ status: 'disconnected' })
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
  })

  it('shows a busy state while connecting', async () => {
    await renderInState({ status: 'connecting' })
    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled()
  })

  /** Wrong network is a distinct state with exactly one thing to do. */
  it('offers a network switch when on the wrong chain', async () => {
    await renderInState({
      status: 'connected',
      address: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      signer: {} as never,
    })
    expect(screen.getByRole('button', { name: /switch to/i })).toBeInTheDocument()
  })

  it('shows the truncated address once connected on the right chain', async () => {
    await renderInState({
      status: 'connected',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: TARGET_CHAIN_ID,
      nativeBalance: 10n ** 18n,
      signer: {} as never,
    })
    expect(screen.getByText('0x1234…5678')).toBeInTheDocument()
  })

  it('opens an account menu with a disconnect action', async () => {
    const user = userEvent.setup()
    await renderInState({
      status: 'connected',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: TARGET_CHAIN_ID,
      nativeBalance: 10n ** 18n,
      signer: {} as never,
    })

    await user.click(screen.getByRole('button', { name: /0x1234/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /disconnect/i }))
    expect(useWalletStore.getState().address).toBeNull()
  })

  it('surfaces a connection error', async () => {
    await renderInState({ status: 'disconnected', error: 'Something went wrong' })
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })
})
