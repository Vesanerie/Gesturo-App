// Scoped localStorage helpers — extracted from favorites.js for testability.
// In Electron/browser context these are also injected as globals (see bottom).

function _scopedKey(base, email) {
  const e = (typeof email === 'string' ? email : '').toLowerCase()
  return e ? base + ':' + e : base
}

function _readScoped(base, email, storage) {
  const sk = _scopedKey(base, email)
  let raw = storage.getItem(sk)
  if (raw === null && sk !== base) {
    const legacy = storage.getItem(base)
    if (legacy !== null) {
      storage.setItem(sk, legacy)
      storage.removeItem(base)
      raw = legacy
    }
  }
  return raw
}

function _writeScoped(base, value, email, storage) {
  storage.setItem(_scopedKey(base, email), value)
}

// ESM export for vitest
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _scopedKey, _readScoped, _writeScoped }
}
