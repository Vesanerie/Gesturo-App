import { describe, it, expect, beforeEach } from 'vitest'
import { _scopedKey, _readScoped, _writeScoped } from '../src/lib/scoped-storage.js'

function makeStorage(init = {}) {
  const store = { ...init }
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    _dump: () => ({ ...store }),
  }
}

describe('_scopedKey', () => {
  it('returns bare key when email is empty', () => {
    expect(_scopedKey('gd4_history', '')).toBe('gd4_history')
  })

  it('returns bare key when email is undefined', () => {
    expect(_scopedKey('gd4_history', undefined)).toBe('gd4_history')
  })

  it('appends lowercased email when present', () => {
    expect(_scopedKey('gd4_history', 'val@test.com')).toBe('gd4_history:val@test.com')
  })

  it('lowercases the email', () => {
    expect(_scopedKey('gd4_history', 'Val@Test.COM')).toBe('gd4_history:val@test.com')
  })
})

describe('_readScoped — migration one-shot', () => {
  it('reads scoped key directly when it exists', () => {
    const s = makeStorage({ 'gd4_history:val@test.com': '["a"]' })
    expect(_readScoped('gd4_history', 'val@test.com', s)).toBe('["a"]')
  })

  it('migrates bare key to scoped key on first read', () => {
    const s = makeStorage({ gd4_history: '["legacy"]' })
    const val = _readScoped('gd4_history', 'val@test.com', s)
    expect(val).toBe('["legacy"]')
    // scoped key now exists
    expect(s.getItem('gd4_history:val@test.com')).toBe('["legacy"]')
    // bare key removed
    expect(s.getItem('gd4_history')).toBeNull()
  })

  it('returns null when neither bare nor scoped key exists', () => {
    const s = makeStorage({})
    expect(_readScoped('gd4_history', 'val@test.com', s)).toBeNull()
  })

  it('uses bare key directly when no email (no migration needed)', () => {
    const s = makeStorage({ gd4_history: '["data"]' })
    expect(_readScoped('gd4_history', '', s)).toBe('["data"]')
    // bare key untouched
    expect(s.getItem('gd4_history')).toBe('["data"]')
  })
})
