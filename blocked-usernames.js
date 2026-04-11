// ── Blocked usernames filter (shared between main.js and Edge Function) ──
// Case-insensitive substring match. Any username containing one of these
// words (or its leetspeak variant) is rejected.
//
// NOTE: the same list is duplicated in supabase/functions/user-data/index.ts
// because Deno Edge Functions cannot import from Electron main source.
// Keep the two lists in sync when editing.

const BLOCKED_USERNAMES = new Set([
  // ── Insultes françaises ──
  'con', 'conne', 'connard', 'connasse', 'cons', 'connards',
  'pute', 'putes', 'putain', 'putains', 'putin',
  'salope', 'salopes', 'salopard', 'salaud', 'salauds',
  'encule', 'enculer', 'encules', 'enculade',
  'nique', 'niquer', 'niquez', 'nik', 'nike', 'niker',
  'ntm', 'nm', 'nmsj', 'fdp', 'fdpd', 'tg', 'tagueule',
  'pd', 'pede', 'pedale',
  'gouine', 'tapette', 'tarlouze', 'tarlouse',
  'merde', 'merdeux', 'merdique', 'emmerde', 'emmerder',
  'bordel', 'bordelique',
  'batard', 'bastard', 'batards',
  'couille', 'couilles', 'couillon', 'couillonne',
  'bite', 'bites', 'biteuse',
  'chatte', 'chattes', 'cul', 'troudu',
  'cretin', 'debile', 'tare',
  'clodo', 'clochard', 'clodos',
  'sucer', 'suceur', 'suceuse',
  'branleur', 'branleuse', 'branler', 'branle',
  'fiotte', 'fiottes',
  'ordure', 'charogne', 'raclure',
  // ── Insultes anglaises ──
  'fuck', 'fucker', 'fucking', 'fucked', 'fuckoff', 'motherfucker',
  'shit', 'shits', 'shitty', 'bullshit',
  'ass', 'arse', 'asshole', 'arsehole', 'asshat',
  'bitch', 'bitches', 'bitching', 'biatch',
  'dick', 'dickhead', 'dicks', 'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'whore', 'whores', 'slut', 'sluts', 'slutty',
  'bastards',
  'damn', 'goddamn',
  'crap', 'crappy',
  'twat', 'wanker', 'wank',
  'prick', 'pricks',
  'bollocks',
  'jerk', 'jerkoff',
  'douche', 'douchebag',
  'idiot', 'idiots', 'moron', 'morons', 'imbecile', 'stupid',
  'retard', 'retarded', 'tard',
  'loser', 'losers',
  'scumbag',
  // ── Termes racistes / haineux ──
  'nigger', 'niggers', 'nigga', 'niggas',
  'chink', 'chinks', 'gook', 'gooks',
  'spic', 'spics', 'wetback',
  'kike', 'kikes',
  'towelhead', 'sandnigger',
  'faggot', 'faggots', 'fag', 'fags',
  'dyke', 'tranny', 'trannies',
  'nazi', 'nazis', 'hitler', 'heilhitler', 'heil',
  'isis', 'jihad', 'jihadi', 'terrorist',
  'kkk', 'klan', 'klansman',
  'whitepower', 'blackpower',
  'holocaust',
  'genocide',
  'rapist', 'rape', 'raper',
  'pedo', 'pedophile', 'pedophil', 'pedobear',
  // ── Usurpation / système ──
  'admin', 'administrator', 'administrateur',
  'moderator', 'moderateur', 'mod',
  'gesturo', 'gesturoart', 'gesturoofficial', 'officiel',
  'support', 'helpdesk', 'staff', 'team', 'equipe',
  'system', 'systeme', 'sysadmin',
  'root', 'superuser',
  'null', 'undefined', 'nan', 'void', 'none',
  'anonymous', 'anonyme', 'anon',
  'bot', 'robot', 'gpt', 'chatgpt', 'openai',
  'owner', 'founder', 'ceo',
  'official', 'verified',
  'test', 'testuser', 'testtest',
  // ── Sexuel explicite ──
  'porn', 'porno', 'pornhub', 'xxx', 'xxxx', 'sex', 'sexe', 'sexy',
  'nude', 'nudes', 'nudity',
  'boobs', 'boob', 'tits', 'titties', 'titty',
  'penis', 'vagina', 'anal',
  'blowjob', 'handjob',
  'orgasm', 'orgy',
  'hentai', 'loli', 'lolicon', 'shota',
  'masturbation', 'masturbate', 'masturbator',
  'fetish', 'bdsm',
  'camgirl', 'escort', 'hooker',
  'horny', 'thot',
  'cumshot', 'cumslut',
  'milf', 'dilf',
  'rimjob', 'ballsack', 'testicle',
  // ── Leetspeak / variantes chiffrées ──
  'f4ck', 'fuk', 'fuq', 'phuck', 'phuk',
  'sh1t', 'shyt',
  'b1tch', 'biotch',
  'a55',
  'd1ck', 'dik',
  'pu55y', 'pu55i',
  'cun7', 'kunt',
  'n1gger', 'n1gga', 'nigg3r',
  'f4g', 'f4ggot',
  'wh0re', 'h0e', 'hoe', 'hoes',
  '5lut',
  'c0ck', 'c0k',
  'k1ll', 'k1ller',
  'n4zi',
  'h1tler',
  '4dmin', 'adm1n',
  'm0d', 'm0derator',
  'r00t', 'r0ot',
  'n00b', 'noob',
  'p0rn', 'pr0n',
  's3x', '5ex',
  'pen1s', 'p3nis',
  'vag1na', 'v4gina',
  // ── Spam / bait ──
  'freemoney', 'bitcoin', 'crypto', 'casino', 'onlyfans',
  'clickhere', 'buynow',
])

function isUsernameBlocked(username) {
  if (!username) return false
  const raw = String(username).toLowerCase()
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
  for (const bad of BLOCKED_USERNAMES) {
    const badNorm = bad
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
    if (!badNorm) continue
    if (raw.includes(bad) || normalized.includes(badNorm)) return true
  }
  return false
}

module.exports = { BLOCKED_USERNAMES, isUsernameBlocked }
