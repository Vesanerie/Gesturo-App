// Edge Function helpers — calls Supabase Edge Functions with the current session JWT.

function createEdgeClient(supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) {

  async function callUserData(action, payload) {
    const { data: sess } = await supabase.auth.getSession()
    const accessToken = sess?.session?.access_token
    console.log('[callUserData]', action, 'session?', !!sess?.session, 'token len:', accessToken?.length || 0)
    if (!accessToken) throw new Error('not authenticated')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/user-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, payload }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn('[callUserData] FAIL', action, res.status, body)
      throw new Error(`user-data ${action} ${res.status}`)
    }
    return res.json()
  }

  async function callEdgeFunction(name, body) {
    const { data: sess } = await supabase.auth.getSession()
    const accessToken = sess?.session?.access_token
    if (!accessToken) throw new Error('not authenticated')
    const url = `${SUPABASE_URL}/functions/v1/${name}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body || {}),
    })
    if (!res.ok) throw new Error(`${name} ${res.status}`)
    return res.json()
  }

  async function listR2Photos(isPro) {
    const data = await callEdgeFunction('list-r2-photos', { isPro: !!isPro })
    return Array.isArray(data) ? data : []
  }

  async function listR2Animations(isPro) {
    const data = await callEdgeFunction('list-r2-animations', { isPro: !!isPro })
    return Array.isArray(data) ? data : []
  }

  return { callUserData, callEdgeFunction, listR2Photos, listR2Animations }
}

module.exports = { createEdgeClient }
