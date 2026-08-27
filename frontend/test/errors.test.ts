import { describe, expect, it } from 'vitest'
import { Interface, AbiCoder } from 'ethers'
import { decodeTxError, isUserRejection } from '@/lib/errors'
import { GAME_MANAGER_ABI, MARKETPLACE_ABI } from '@/lib/generated/abis'

/**
 * Error decoding is what stands between a player and "Transaction failed".
 * Each of these is a failure they will actually hit.
 */

function encodeCustomError(abi: unknown, name: string, args: unknown[]): string {
  const iface = new Interface(abi as never)
  const fragment = iface.getError(name)
  if (!fragment) throw new Error(`No such error: ${name}`)
  return iface.encodeErrorResult(fragment, args)
}

describe('decodeTxError', () => {
  describe('user rejection', () => {
    it('recognises the EIP-1193 rejection code', () => {
      const decoded = decodeTxError({ code: 4001, message: 'User rejected the request' })
      expect(decoded.kind).toBe('rejected')
      expect(decoded.title).toBe('Transaction cancelled')
    })

    it('recognises the ethers ACTION_REJECTED code', () => {
      expect(decodeTxError({ code: 'ACTION_REJECTED' }).kind).toBe('rejected')
    })

    it('recognises a rejection by message text', () => {
      expect(decodeTxError(new Error('MetaMask Tx Signature: User denied transaction')).kind)
        .toBe('rejected')
    })

    it('exposes a convenience predicate', () => {
      expect(isUserRejection({ code: 4001 })).toBe(true)
      expect(isUserRejection(new Error('boom'))).toBe(false)
    })
  })

  describe('contract custom errors', () => {
    it('explains a level gate with both numbers', () => {
      const data = encodeCustomError(GAME_MANAGER_ABI, 'LevelTooLow', [5, 2])
      const decoded = decodeTxError({ data })
      expect(decoded.kind).toBe('contract')
      expect(decoded.title).toContain('level 5')
      expect(decoded.detail).toContain('level 2')
      expect(decoded.raw).toBe('LevelTooLow')
    })

    it('explains an occupied plot', () => {
      const data = encodeCustomError(GAME_MANAGER_ABI, 'LandInUse', [1])
      const decoded = decodeTxError({ data })
      expect(decoded.title).toBe('Plot is already planted')
      expect(decoded.retryable).toBe(false)
    })

    it('explains an immature crop', () => {
      const data = encodeCustomError(GAME_MANAGER_ABI, 'NotReadyToHarvest', [1, 1893456000])
      const decoded = decodeTxError({ data })
      expect(decoded.title).toBe('Crop is still growing')
    })

    it('explains a duplicate starter-pack claim', () => {
      const data = encodeCustomError(
        GAME_MANAGER_ABI,
        'StarterPackAlreadyClaimed',
        ['0x' + '1'.repeat(40)]
      )
      expect(decodeTxError({ data }).title).toBe('Starter pack already claimed')
    })

    /** The front-running guard, surfaced in language a player can act on. */
    it('explains a price that moved before the purchase landed', () => {
      const data = encodeCustomError(
        MARKETPLACE_ABI,
        'PriceExceedsMaximum',
        [1000n * 10n ** 18n, 500n * 10n ** 18n]
      )
      const decoded = decodeTxError({ data })
      expect(decoded.title).toBe('Price changed before your purchase')
      expect(decoded.detail).toContain('1000')
    })

    it('explains a listing that no longer exists', () => {
      const data = encodeCustomError(MARKETPLACE_ABI, 'ListingNotActive', [7])
      expect(decodeTxError({ data }).title).toBe('That listing is gone')
    })

    it('finds revert data nested inside an ethers error envelope', () => {
      const data = encodeCustomError(GAME_MANAGER_ABI, 'LandInUse', [1])
      const decoded = decodeTxError({
        code: 'CALL_EXCEPTION',
        message: 'execution reverted',
        info: { error: { data } },
      })
      expect(decoded.raw).toBe('LandInUse')
    })

    it('names an unmapped custom error rather than swallowing it', () => {
      const data = encodeCustomError(GAME_MANAGER_ABI, 'InvalidParameter', [])
      const decoded = decodeTxError({ data })
      expect(decoded.kind).toBe('contract')
      expect(decoded.raw).toBe('InvalidParameter')
      expect(decoded.detail).toBe('Invalid Parameter')
    })
  })

  describe('OpenZeppelin errors', () => {
    it('turns an allowance shortfall into an approval prompt', () => {
      const abi = [
        'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
      ]
      const data = new Interface(abi).encodeErrorResult('ERC20InsufficientAllowance', [
        '0x' + '2'.repeat(40), 0n, 50n * 10n ** 18n,
      ])
      const decoded = decodeTxError({ data })
      expect(decoded.kind).toBe('needs-approval')
      expect(decoded.detail).toContain('50')
    })

    it('turns a balance shortfall into a funds message', () => {
      const abi = [
        'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
      ]
      const data = new Interface(abi).encodeErrorResult('ERC20InsufficientBalance', [
        '0x' + '2'.repeat(40), 10n * 10n ** 18n, 50n * 10n ** 18n,
      ])
      const decoded = decodeTxError({ data })
      expect(decoded.kind).toBe('insufficient-funds')
      expect(decoded.title).toBe('Not enough FGOLD')
    })

    it('explains a paused game', () => {
      const data = new Interface(['error EnforcedPause()']).encodeErrorResult('EnforcedPause', [])
      expect(decodeTxError({ data }).title).toBe('The game is paused')
    })
  })

  describe('wallet and network failures', () => {
    it('recognises insufficient gas', () => {
      const decoded = decodeTxError({ code: 'INSUFFICIENT_FUNDS', message: 'insufficient funds for gas' })
      expect(decoded.kind).toBe('insufficient-gas')
      expect(decoded.retryable).toBe(true)
    })

    it('recognises an RPC timeout as retryable', () => {
      const decoded = decodeTxError({ code: 'TIMEOUT', message: 'request timeout' })
      expect(decoded.kind).toBe('network')
      expect(decoded.retryable).toBe(true)
    })

    it('recognises a sped-up transaction', () => {
      const decoded = decodeTxError({
        code: 'TRANSACTION_REPLACED',
        cancelled: false,
        replacement: { hash: '0xabc123' },
      })
      expect(decoded.kind).toBe('replaced')
      expect(decoded.title).toBe('Transaction was sped up')
    })

    it('recognises a cancelled replacement', () => {
      const decoded = decodeTxError({ code: 'TRANSACTION_REPLACED', cancelled: true })
      expect(decoded.kind).toBe('replaced')
      expect(decoded.title).toContain('cancelled')
    })

    it('recognises a stale nonce', () => {
      expect(decodeTxError({ code: 'NONCE_EXPIRED' }).kind).toBe('network')
    })
  })

  describe('fallbacks', () => {
    it('surfaces a plain string revert reason', () => {
      const decoded = decodeTxError({ reason: 'Something specific went wrong' })
      expect(decoded.kind).toBe('contract')
      expect(decoded.detail).toBe('Something specific went wrong')
    })

    it('never throws on junk input', () => {
      for (const junk of [null, undefined, 0, '', [], {}, new Error('')]) {
        expect(() => decodeTxError(junk)).not.toThrow()
      }
    })

    it('truncates a very long unknown message', () => {
      const decoded = decodeTxError(new Error('x'.repeat(1000)))
      expect(decoded.detail!.length).toBeLessThanOrEqual(180)
    })

    it('does not mistake undecodable data for success', () => {
      const decoded = decodeTxError({ data: '0x' + AbiCoder.defaultAbiCoder().encode(['uint256'], [1n]).slice(2) })
      expect(decoded.kind).not.toBe('rejected')
      expect(decoded.title).toBeTruthy()
    })
  })
})
