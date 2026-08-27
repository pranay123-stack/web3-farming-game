import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runTransaction, useTxStore, txActions } from '@/lib/state/txStore'

/**
 * The transaction state machine.
 *
 * The property these tests exist to protect: `confirmed` is reachable only
 * from a mined receipt with status 1. The previous client never awaited a
 * receipt at all and reported success the moment a transaction was submitted.
 */

function statuses() {
  return useTxStore.getState().transactions.map((t) => t.status)
}

function makeResponse(overrides: Partial<{ hash: string; wait: unknown }> = {}) {
  return {
    hash: overrides.hash ?? '0xabc',
    wait: overrides.wait ?? vi.fn().mockResolvedValue({ status: 1, blockNumber: 42, hash: '0xabc' }),
  } as never
}

beforeEach(() => {
  useTxStore.setState({ transactions: [] })
})

describe('runTransaction', () => {
  it('reaches confirmed only after a successful receipt', async () => {
    const wait = vi.fn().mockResolvedValue({ status: 1, blockNumber: 7, hash: '0xabc' })
    const result = await runTransaction({
      label: 'Plant wheat',
      send: async () => makeResponse({ wait }),
    })

    expect(result.ok).toBe(true)
    expect(wait).toHaveBeenCalledOnce()
    expect(statuses()).toEqual(['confirmed'])
    expect(useTxStore.getState().transactions[0].blockNumber).toBe(7)
  })

  /** A mined-but-reverted transaction is a failure, not a success. */
  it('marks a receipt with status 0 as failed', async () => {
    const result = await runTransaction({
      label: 'Harvest',
      send: async () => makeResponse({
        wait: vi.fn().mockResolvedValue({ status: 0, blockNumber: 9, hash: '0xabc' }),
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('Transaction reverted')
    expect(statuses()).toEqual(['failed'])
  })

  it('records the hash and explorer link while pending', async () => {
    let resolveWait: (value: unknown) => void = () => {}
    const wait = vi.fn(() => new Promise((resolve) => { resolveWait = resolve }))

    const pending = runTransaction({
      label: 'Buy seed',
      send: async () => makeResponse({ hash: '0xfeed', wait }),
    })

    await vi.waitFor(() => {
      expect(useTxStore.getState().transactions[0].status).toBe('pending')
    })
    expect(useTxStore.getState().transactions[0].hash).toBe('0xfeed')

    resolveWait({ status: 1, blockNumber: 1, hash: '0xfeed' })
    await pending
  })

  it('stops at preflight without opening the wallet', async () => {
    const send = vi.fn()
    const result = await runTransaction({
      label: 'Upgrade plot',
      preflight: () => { throw Object.assign(new Error('Not enough FGOLD'), { reason: 'Not enough FGOLD' }) },
      send: send as never,
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error?.detail).toBe('Not enough FGOLD')
    expect(statuses()).toEqual(['failed'])
  })

  it('records a wallet rejection as cancelled, not failed', async () => {
    const result = await runTransaction({
      label: 'Craft hoe',
      send: async () => { throw { code: 4001, message: 'User rejected' } },
    })

    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('rejected')
    expect(statuses()).toEqual(['rejected'])
  })

  it('refreshes chain state after confirmation, before reporting success', async () => {
    const order: string[] = []
    const onConfirmed = vi.fn(async () => { order.push('refresh') })

    await runTransaction({
      label: 'Harvest',
      send: async () => makeResponse(),
      onConfirmed,
    })
    order.push('return')

    expect(onConfirmed).toHaveBeenCalledOnce()
    expect(order).toEqual(['refresh', 'return'])
  })

  it('still reports success when the post-confirmation refresh throws', async () => {
    const result = await runTransaction({
      label: 'Harvest',
      send: async () => makeResponse(),
      onConfirmed: async () => { throw new Error('RPC down') },
    })

    // The transaction really did land; a failed refetch must not rewrite that.
    expect(result.ok).toBe(true)
    expect(statuses()).toEqual(['confirmed'])
  })

  it('treats a successful replacement as success', async () => {
    const replacement = { status: 1, blockNumber: 11, hash: '0xnew' }
    const result = await runTransaction({
      label: 'Buy item',
      send: async () => makeResponse({
        wait: vi.fn().mockRejectedValue({
          code: 'TRANSACTION_REPLACED',
          cancelled: false,
          receipt: replacement,
          replacement: { hash: '0xnew' },
        }),
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.hash).toBe('0xnew')
    expect(statuses()).toEqual(['confirmed'])
  })

  it('surfaces a contract revert that happens at send time', async () => {
    const result = await runTransaction({
      label: 'Plant',
      send: async () => { throw { code: 'CALL_EXCEPTION', message: 'execution reverted' } },
    })

    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('contract')
    expect(statuses()).toEqual(['failed'])
  })

  it('tracks concurrent transactions independently', async () => {
    await Promise.all([
      runTransaction({ label: 'A', send: async () => makeResponse() }),
      runTransaction({ label: 'B', send: async () => { throw { code: 4001 } } }),
    ])

    const byLabel = Object.fromEntries(
      useTxStore.getState().transactions.map((t) => [t.label, t.status])
    )
    expect(byLabel).toEqual({ A: 'confirmed', B: 'rejected' })
  })

  it('caps the tracked history', async () => {
    for (let i = 0; i < 40; i++) {
      await runTransaction({ label: `tx ${i}`, send: async () => makeResponse() })
    }
    expect(useTxStore.getState().transactions.length).toBeLessThanOrEqual(30)
  })
})

describe('txActions', () => {
  it('dismisses a single transaction', async () => {
    await runTransaction({ label: 'One', send: async () => makeResponse() })
    const id = useTxStore.getState().transactions[0].id
    txActions.dismiss(id)
    expect(useTxStore.getState().transactions).toHaveLength(0)
  })

  it('clears settled transactions but keeps in-flight ones', async () => {
    await runTransaction({ label: 'Done', send: async () => makeResponse() })

    let resolveWait: (v: unknown) => void = () => {}
    const inFlight = runTransaction({
      label: 'Pending',
      send: async () => makeResponse({ wait: () => new Promise((r) => { resolveWait = r }) }),
    })
    await vi.waitFor(() => {
      expect(useTxStore.getState().transactions.some((t) => t.status === 'pending')).toBe(true)
    })

    txActions.clearSettled()
    expect(useTxStore.getState().transactions.map((t) => t.label)).toEqual(['Pending'])

    resolveWait({ status: 1, blockNumber: 1, hash: '0xabc' })
    await inFlight
  })
})
