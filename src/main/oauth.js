const { shell } = require('electron')
const { REDIRECT_URI } = require('./auth')

let oauthServer = null

function startSupabaseOAuth(supabase) {
  return new Promise((resolve, reject) => {
    const http = require('http')

    if (oauthServer) {
      try { oauthServer.close() } catch (e) {}
      oauthServer = null
    }

    const server = http.createServer(async (req, res) => {
      console.log('[oauth] callback hit:', req.url)
      const url = new URL(req.url, REDIRECT_URI)
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404); res.end('Not found'); return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      console.log('[oauth] params:', { code: code ? 'present' : 'missing', error, errorDescription })

      const html = code
        ? `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><h2>✅ Connexion réussie</h2><p style="color:#555;margin-top:12px">Vous pouvez fermer cet onglet et retourner dans l'app.</p></body></html>`
        : `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>❌ Connexion annulée</h2></body></html>`

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      server.close()
      oauthServer = null

      if (error || !code) return reject(new Error((error || 'Code manquant') + (errorDescription ? ': ' + errorDescription : '')))

      try {
        const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeErr) return reject(exchangeErr)
        resolve(data.session)
      } catch (e) { reject(e) }
    })

    oauthServer = server

    server.listen(9876, '127.0.0.1', async () => {
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: REDIRECT_URI,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account', access_type: 'offline' },
          },
        })
        if (error) { console.error('[oauth] signInWithOAuth error:', error); reject(error); return }
        console.log('[oauth] opening:', data.url)
        shell.openExternal(data.url)
      } catch (e) { reject(e) }
    })

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error('Port 9876 bloqué par un autre programme. Ferme-lo et réessaie.'))
      } else {
        reject(e)
      }
    })
  })
}

function closeOAuthServer() {
  if (oauthServer) { try { oauthServer.close() } catch(e) {} oauthServer = null }
}

module.exports = { startSupabaseOAuth, closeOAuthServer }
