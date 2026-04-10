const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3000);

  // Capture aussi les logs du process principal
  app.process().stderr.on('data', d => process.stdout.write('[main-err] ' + d));
  app.process().stdout.on('data', d => process.stdout.write('[main-out] ' + d));

  // Appel direct à l'Edge Function depuis le renderer avec le JWT stocké
  const result = await win.evaluate(async () => {
    // La clé SUPABASE est dans config.js côté renderer
    const SUPABASE_URL = 'https://okhmokriethdqhsiptvu.supabase.co';
    // On doit récupérer le JWT via l'IPC authCheck — mais authCheck ne renvoie
    // pas le token. Donc on appelle plutôt listR2Photos via IPC et on logge
    // la réponse brute côté main.
    // Au lieu de ça, on va appeler fetch directement sans JWT (pour tester que
    // l'endpoint est bien UP) — on s'attend à 401.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/list-r2-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPro: false }),
      });
      return { status: res.status, ok: res.ok, body: (await res.text()).slice(0, 300) };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('raw fetch no-auth:', JSON.stringify(result, null, 2));

  // Maintenant via IPC (qui a le bon JWT côté main)
  const ipcResult = await win.evaluate(async () => {
    const photos = await window.electronAPI.listR2Photos({ isPro: true });
    return { count: photos.length, sample: photos.slice(0, 2) };
  });
  console.log('ipc listR2Photos:', JSON.stringify(ipcResult, null, 2));

  // Force logout pour revenir à un état propre
  await win.waitForTimeout(500);
  await app.close();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
