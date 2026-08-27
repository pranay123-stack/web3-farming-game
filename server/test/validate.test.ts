import { describe, expect, it } from 'vitest'
import {
  isPlausibleMove, sanitizeText, validateAddress, validateChatPayload,
  validateJoinPayload, validateMovePayload, validateCoordinate,
} from '../src/lib/validate'
import { LIMITS } from '../src/protocol'

describe('payload validation', () => {
  describe('coordinates', () => {
    it('rejects the values a hostile client actually sends', () => {
      for (const bad of [Infinity, -Infinity, NaN, '5', null, undefined, {}, []]) {
        expect(validateCoordinate(bad, 'x').ok, `${String(bad)} should be rejected`).toBe(false)
      }
    })

    it('rejects out-of-bounds coordinates', () => {
      expect(validateCoordinate(-1, 'x').ok).toBe(false)
      expect(validateCoordinate(9999, 'x').ok).toBe(false)
    })

    it('floors fractional coordinates', () => {
      const result = validateCoordinate(12.9, 'x')
      expect(result).toEqual({ ok: true, value: 12 })
    })
  })

  describe('addresses', () => {
    it('accepts a well-formed address and lowercases it', () => {
      const result = validateAddress('0xAbC0000000000000000000000000000000000123')
      expect(result).toEqual({ ok: true, value: '0xabc0000000000000000000000000000000000123' })
    })

    it('rejects malformed addresses', () => {
      for (const bad of ['0x123', 'not-an-address', '', 42, null]) {
        expect(validateAddress(bad).ok).toBe(false)
      }
    })
  })

  describe('join payload', () => {
    it('allows a guest with no address', () => {
      const result = validateJoinPayload({ username: 'Farmer' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.address).toBeNull()
    })

    /**
     * The identity fix: a claimed wallet must arrive with proof, or the join
     * is rejected outright.
     */
    it('refuses an address without a signature', () => {
      const result = validateJoinPayload({ address: '0x' + '1'.repeat(40) })
      expect(result.ok).toBe(false)
    })

    it('refuses an address with a malformed signature', () => {
      const result = validateJoinPayload({
        address: '0x' + '1'.repeat(40),
        signature: '0xdeadbeef',
        nonce: 'a'.repeat(32),
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a non-object payload outright', () => {
      expect(validateJoinPayload('hello').ok).toBe(false)
      expect(validateJoinPayload(null).ok).toBe(false)
      expect(validateJoinPayload([1, 2, 3]).ok).toBe(false)
    })

    it('rejects a non-string username', () => {
      expect(validateJoinPayload({ username: 42 }).ok).toBe(false)
    })
  })

  describe('move payload', () => {
    it('accepts a well-formed move', () => {
      const result = validateMovePayload({ x: 10, y: 12, facing: 'left', moving: true })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({ x: 10, y: 12, facing: 'left', moving: true })
      }
    })

    it('drops an unrecognised facing rather than trusting it', () => {
      const result = validateMovePayload({ x: 1, y: 1, facing: 'sideways' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.facing).toBeUndefined()
    })

    it('rejects missing or non-numeric coordinates', () => {
      expect(validateMovePayload({ y: 1 }).ok).toBe(false)
      expect(validateMovePayload({ x: 'a', y: 1 }).ok).toBe(false)
      expect(validateMovePayload({ x: Infinity, y: 1 }).ok).toBe(false)
    })
  })

  describe('chat payload', () => {
    it('truncates to the length limit', () => {
      const result = validateChatPayload({ content: 'a'.repeat(1000), scope: 'global' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.content.length).toBe(LIMITS.maxChatLength)
    })

    it('rejects an empty or whitespace-only message', () => {
      expect(validateChatPayload({ content: '', scope: 'global' }).ok).toBe(false)
      expect(validateChatPayload({ content: '     ', scope: 'global' }).ok).toBe(false)
    })

    it('rejects an unknown scope', () => {
      expect(validateChatPayload({ content: 'hi', scope: 'system' }).ok).toBe(false)
      expect(validateChatPayload({ content: 'hi', scope: 'admin' }).ok).toBe(false)
    })

    it('collapses runs of whitespace', () => {
      const result = validateChatPayload({ content: 'hello       world', scope: 'nearby' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.content).toBe('hello world')
    })

    it('strips control characters', () => {
      const withControls = 'he' + String.fromCharCode(0, 7, 27) + 'llo'
      const result = validateChatPayload({ content: withControls, scope: 'global' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.content).toBe('he llo')
    })
  })

  describe('movement plausibility', () => {
    it('accepts a normal step', () => {
      expect(isPlausibleMove(10, 10, 11, 10)).toBe(true)
    })

    it('rejects a teleport across the map', () => {
      expect(isPlausibleMove(0, 0, 60, 60)).toBe(false)
    })

    it('accepts exactly the delta limit and rejects one past it', () => {
      expect(isPlausibleMove(10, 10, 10 + LIMITS.maxMoveDelta, 10)).toBe(true)
      expect(isPlausibleMove(10, 10, 10 + LIMITS.maxMoveDelta + 1, 10)).toBe(false)
    })
  })

  describe('sanitizeText', () => {
    it('trims, collapses and truncates', () => {
      expect(sanitizeText('  a   b  ', 100)).toBe('a b')
      expect(sanitizeText('abcdef', 3)).toBe('abc')
    })
  })
})
