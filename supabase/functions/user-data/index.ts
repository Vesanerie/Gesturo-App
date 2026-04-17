// Single endpoint for user data: getStreak, saveSession, getFavorites, saveFavorites,
// community posts, reactions.
// Auth via Supabase JWT, DB writes via service role (bypasses RLS).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { presignPut, putObject, deleteKeys } from '../_shared/r2.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE);

// ── Image moderation via Claude Vision ────────────────────────────────────
// Returns { ok, reason }. ok=true means the image is a drawing/painting and SFW.
async function moderateImage(base64: string): Promise<{ ok: boolean; reason: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    // No key configured → skip moderation, let manual review handle it
    console.warn('[moderation] ANTHROPIC_API_KEY not set, skipping auto-moderation');
    return { ok: true, reason: 'moderation skipped (no API key)' };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            {
              type: 'text',
              text: `You are a content moderator for an art community app (gesture drawing / figure drawing).
Analyze this image and respond with ONLY a JSON object, no other text:
{"isArtwork": true/false, "isNSFW": true/false, "reason": "brief explanation"}

Rules:
- isArtwork = true if image is a drawing, painting, sketch, digital art, watercolor, charcoal, figure study, gesture drawing, or any hand-made artwork (even beginner level). Also true for photos OF artwork (e.g. a photo of a sketchbook page).
- isArtwork = false if it's a selfie, random photo, meme, screenshot, text-only image, or clearly not artwork.
- isNSFW = true ONLY for explicit sexual content, genitalia close-ups, or pornographic imagery. Artistic nudity (figure drawing, classical poses) is ALLOWED and should be isNSFW = false.
- Be lenient on quality — bad drawings are still artwork.`,
            },
          ],
        }],
      }),
    });
    if (!res.ok) {
      console.warn('[moderation] Claude API error:', res.status);
      return { ok: true, reason: 'moderation error, allowing through' };
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ok: true, reason: 'could not parse response' };
    const result = JSON.parse(match[0]);
    if (result.isNSFW) return { ok: false, reason: result.reason || 'Contenu inapproprié détecté.' };
    if (!result.isArtwork) return { ok: false, reason: result.reason || 'Cette image ne semble pas être un dessin ou une création artistique.' };
    return { ok: true, reason: 'approved' };
  } catch (e) {
    console.warn('[moderation] error:', (e as Error).message);
    return { ok: true, reason: 'moderation error, allowing through' };
  }
}

async function getEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.email ?? null;
}

async function profileId(email: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  return data?.id ?? null;
}

// ── Blocked usernames filter ───────────────────────────────────────────────
// Case-insensitive substring match. Any username containing one of these
// words (or its leetspeak variant) is rejected.
const BLOCKED_USERNAMES: Set<string> = new Set([
  // ── Insultes françaises ──
  'con', 'conne', 'connard', 'connasse', 'cons', 'connards',
  'pute', 'putes', 'putain', 'putains', 'putin',
  'salope', 'salopes', 'salopard', 'salaud', 'salauds',
  'encule', 'enculer', 'encules', 'enculer', 'enculade',
  'nique', 'niquer', 'niquez', 'nik', 'niké', 'niker',
  'ntm', 'nm', 'nmsj', 'fdp', 'fdpd', 'tg', 'ta gueule', 'tagueule',
  'pd', 'pede', 'pédé', 'pedé', 'pedale', 'pédale',
  'gouine', 'tapette', 'tarlouze', 'tarlouse',
  'merde', 'merdeux', 'merdique', 'emmerde', 'emmerder',
  'bordel', 'bordelique',
  'batard', 'bâtard', 'bastard', 'batards',
  'couille', 'couilles', 'couillon', 'couillonne',
  'bite', 'bites', 'biteuse', 'biatch',
  'chatte', 'chattes', 'cul', 'trou du cul', 'troudu',
  'cretin', 'crétin', 'debile', 'débile', 'taré', 'tare',
  'clodo', 'clochard', 'clodos',
  'salopette',
  'gros con', 'grosse conne', 'sale con', 'sale pute',
  'suce', 'sucer', 'suceur', 'suceuse',
  'branleur', 'branleuse', 'branler', 'branle',
  'fiotte', 'fiottes',
  'ordure', 'charogne', 'raclure',
  // ── Insultes anglaises ──
  'fuck', 'fucker', 'fucking', 'fucked', 'fuckoff', 'motherfucker', 'mf',
  'shit', 'shits', 'shitty', 'bullshit', 'piece of shit',
  'ass', 'arse', 'asshole', 'arsehole', 'asshat',
  'bitch', 'bitches', 'bitching', 'biatch',
  'dick', 'dickhead', 'dicks', 'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'whore', 'whores', 'slut', 'sluts', 'slutty',
  'bastard', 'bastards',
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
  'moderator', 'moderateur', 'modérateur', 'mod',
  'gesturo', 'gesturoart', 'gesturo_art', 'gesturoofficial', 'officiel',
  'support', 'helpdesk', 'staff', 'team', 'equipe',
  'system', 'systeme', 'système', 'sysadmin',
  'root', 'superuser', 'su',
  'null', 'undefined', 'nan', 'void', 'none',
  'anonymous', 'anonyme', 'anon',
  'bot', 'robot', 'ai', 'gpt', 'chatgpt', 'openai',
  'owner', 'founder', 'ceo',
  'official', 'verified',
  'test', 'testuser', 'testtest',
  // ── Sexuel explicite ──
  'porn', 'porno', 'pornhub', 'xxx', 'xxxx', 'sex', 'sexe', 'sexy',
  'nude', 'nudes', 'nudity',
  'boobs', 'boob', 'tits', 'titties', 'titty',
  'penis', 'vagina', 'anal',
  'blowjob', 'blow', 'handjob', 'jerkoff',
  'orgasm', 'orgy',
  'hentai', 'loli', 'lolicon', 'shota',
  'masturbation', 'masturbate', 'masturbator',
  'fetish', 'bdsm',
  'camgirl', 'escort', 'hooker',
  'horny', 'thot',
  'cumshot', 'cumslut', 'cum',
  'milf', 'dilf',
  'rimjob', 'ballsack', 'testicle',
  // ── Leetspeak / variantes chiffrées ──
  'f4ck', 'fuk', 'fuq', 'phuck', 'phuk',
  'sh1t', 'sh!t', '5hit', 'shyt',
  'b1tch', 'b!tch', 'biatch', 'biotch',
  'a55', 'a$$', '@ss', '@$$',
  'd1ck', 'd!ck', 'dik',
  'pu55y', 'pu$$y', 'pu55i',
  'cun7', 'kunt',
  'n1gger', 'n1gga', 'n!gger', 'nigg3r',
  'f4g', 'f4ggot', 'f@g',
  'wh0re', 'h0e', 'hoe', 'hoes',
  '5lut', '$lut',
  'c0ck', 'c0k',
  'k1ll', 'k!ll', 'k1ller',
  'n4zi', 'n@zi',
  'h1tler', 'h!tler',
  '4dmin', '@dmin', 'adm1n',
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
]);

// Words that must be blocked even as substrings (usurpation + worst slurs)
const ALWAYS_SUBSTRING = new Set([
  'admin', 'gesturo', 'moderator', 'moderateur', 'support', 'system', 'root',
  'nigger', 'nigga', 'faggot', 'pedophil', 'pedo', 'nazi', 'hitler',
]);

function isUsernameBlocked(username: string): boolean {
  if (!username) return false;
  const raw = username.toLowerCase().trim();
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  // Split into words for word-boundary matching
  const words = raw.split(/[\s_\-\.]+/);
  const wordsNorm = normalized.match(/[a-z0-9]+/g) || [normalized];

  for (const bad of BLOCKED_USERNAMES) {
    const badNorm = bad
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (!badNorm) continue;

    // Usurpation + worst slurs: substring match (strict)
    if (ALWAYS_SUBSTRING.has(bad)) {
      if (normalized.includes(badNorm)) return true;
      continue;
    }

    // Everything else: exact word match only
    if (words.includes(bad) || wordsNorm.includes(badNorm)) return true;
    // Also block if the ENTIRE username is the bad word
    if (normalized === badNorm) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const email = await getEmail(req);
    if (!email) return json({ error: 'unauthorized' }, 401);
    const { action, payload } = await req.json();
    const pid = await profileId(email);

if (action === 'getStreak') {
      if (!pid) return json({ streak: 0 });
      const { data: sessions } = await admin
        .from('sessions').select('created_at').eq('user_id', pid)
        .order('created_at', { ascending: false });
      if (!sessions?.length) return json({ streak: 0 });
      const days = new Set(sessions.map((s: any) => new Date(s.created_at).toISOString().split('T')[0]));
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().split('T')[0];
        if (days.has(key)) streak++;
        else if (i > 0) break;
      }
      return json({ streak });
    }

    if (action === 'saveSession') {
      if (!pid) return json({ success: false });
      const s = payload || {};
      const { error } = await admin.from('sessions').insert({
        user_id: pid,
        duration_seconds: (s.minutes || 0) * 60,
        photo_count: s.poses || 0,
        category: s.cats || null,
      });
      if (error) return json({ success: false, error: error.message });
      return json({ success: true });
    }

    // Récupère toutes les sessions de l'user et les renvoie au format
    // compatible avec HIST_KEY local (ts, poses, minutes, cats). Utilisé
    // pour synchroniser l'historique local depuis n'importe quelle machine.
    if (action === 'getSessions') {
      if (!pid) return json({ sessions: [] });
      const { data } = await admin
        .from('sessions')
        .select('created_at, duration_seconds, photo_count, category')
        .eq('user_id', pid)
        .order('created_at', { ascending: true });
      const sessions = (data || []).map((s: any) => ({
        ts: new Date(s.created_at).getTime(),
        poses: s.photo_count || 0,
        minutes: Math.round((s.duration_seconds || 0) / 60),
        cats: s.category || null,
        // type non stocké en DB — fallback 'pose' (majorité des cas)
        type: 'pose',
      }));
      return json({ sessions });
    }

    // Persiste un badge débloqué dans profiles.badges (colonne jsonb).
    // Format stocké : { badge_id: unlocked_ts_ms }. Fusion non-destructive :
    // on read-modify-write pour ne pas écraser les autres badges.
    if (action === 'saveBadge') {
      if (!pid) return json({ success: false });
      const badgeId = (payload && payload.badgeId) || null;
      const ts = (payload && payload.ts) || Date.now();
      if (!badgeId) return json({ success: false, error: 'no badgeId' });
      const { data: prof } = await admin
        .from('profiles').select('badges').eq('id', pid).maybeSingle();
      const badges = (prof && prof.badges && typeof prof.badges === 'object') ? { ...prof.badges } : {};
      // Ne pas écraser un badge déjà présent (garder le 1er timestamp)
      if (!badges[badgeId]) badges[badgeId] = ts;
      const { error } = await admin
        .from('profiles').update({ badges }).eq('id', pid);
      if (error) return json({ success: false, error: error.message });
      return json({ success: true });
    }

    // Récupère tous les badges débloqués de l'user.
    if (action === 'getBadges') {
      if (!pid) return json({ badges: {} });
      const { data } = await admin
        .from('profiles').select('badges').eq('id', pid).maybeSingle();
      return json({ badges: (data && data.badges) || {} });
    }

    if (action === 'getFavorites') {
      if (!pid) return json({ favs: [] });
      const { data } = await admin
        .from('favorites_images').select('src, label, added_at')
        .eq('user_id', pid).order('added_at', { ascending: true });
      return json({ favs: data || [] });
    }

    if (action === 'refreshProStatus') {
      const { data } = await admin
        .from('profiles').select('plan, pro_expires_at')
        .eq('email', email.toLowerCase()).maybeSingle();
      let isPro = false;
      if (data && data.plan === 'pro') {
        if (!data.pro_expires_at || new Date(data.pro_expires_at) >= new Date()) isPro = true;
      }
      return json({ isPro });
    }

    if (action === 'saveFavorites') {
      if (!pid) return json({ ok: false });
      const favs = Array.isArray(payload) ? payload : [];
      await admin.from('favorites_images').delete().eq('user_id', pid);
      if (favs.length) {
        await admin.from('favorites_images').insert(
          favs.map((f: any) => ({ user_id: pid, email, src: f.src, label: f.label }))
        );
      }
      return json({ ok: true });
    }

    if (action === 'getProfile') {
      const { data } = await admin
        .from('profiles')
        .select('username, plan')
        .eq('email', email)
        .maybeSingle();
      return json({
        ok: true,
        email,
        username: data?.username || null,
        plan: data?.plan || 'free',
      });
    }

    if (action === 'updateUsername') {
      const { username } = payload || {};
      if (!username || typeof username !== 'string' || username.trim().length < 1) return json({ error: 'invalid username' }, 400);
      const clean = username.trim().slice(0, 30);
      if (isUsernameBlocked(clean)) return json({ error: 'Ce pseudo n\u2019est pas autorisé' }, 400);
      const { error } = await admin.from('profiles').update({ username: clean }).eq('email', email);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, username: clean });
    }

    // ── Community posts ──
    if (action === 'submitCommunityPost') {
      // Block banned users
      const { data: prof } = await admin.from('profiles').select('banned').eq('email', email).maybeSingle();
      if (prof?.banned) return json({ error: 'Votre compte est suspendu. Vous ne pouvez pas publier.' }, 403);
      const { refImageUrl, username, imageBase64 } = payload || {};
      const key = `Community/${Date.now()}_${email.replace(/[^a-z0-9]/gi, '_')}.jpg`;

      // If imageBase64 is provided (mobile), moderate before uploading.
      let uploadUrl: string | null = null;
      if (imageBase64) {
        const modResult = await moderateImage(imageBase64);
        if (!modResult.ok) return json({ error: modResult.reason }, 400);
        const bytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
        await putObject(key, bytes, 'image/jpeg');
      } else {
        // Desktop: presigned URL flow. Moderation happens after upload via moderateCommunityPost.
        uploadUrl = await presignPut(key, 'image/jpeg', 600);
      }

      // Auto-approve trusted users (>= 1 previously approved post)
      const { count: approvedCount } = await admin.from('community_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_email', email).eq('approved', true);
      const autoApprove = (approvedCount || 0) >= 1;

      const { data: post, error } = await admin.from('community_posts').insert({
        user_email: email,
        username: username || email.split('@')[0],
        image_key: key,
        ref_image_url: refImageUrl || null,
        approved: autoApprove,
      }).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ uploadUrl, postId: post.id, imageKey: key, uploaded: !!imageBase64, needsModeration: !imageBase64, autoApproved: autoApprove });
    }

    // Desktop post-upload moderation: fetch image from R2 public URL, run vision check
    if (action === 'moderateCommunityPost') {
      const { postId } = payload || {};
      if (!postId) return json({ error: 'missing postId' }, 400);
      const { data: post } = await admin
        .from('community_posts').select('id, image_key, user_email')
        .eq('id', postId).eq('user_email', email).maybeSingle();
      if (!post) return json({ error: 'post not found' }, 404);
      const r2Public = Deno.env.get('R2_PUBLIC_URL') || '';
      const imageUrl = `${r2Public}/${post.image_key}`;
      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) return json({ error: 'could not fetch image' }, 500);
        const buf = await imgRes.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const modResult = await moderateImage(base64);
        if (!modResult.ok) {
          // Auto-reject: delete post + image
          await admin.from('post_reactions').delete().eq('post_id', post.id);
          await admin.from('community_posts').delete().eq('id', post.id);
          await deleteKeys([post.image_key]);
          return json({ ok: false, reason: modResult.reason });
        }
        return json({ ok: true });
      } catch (e) {
        // If moderation fails, don't block — manual review will handle it
        return json({ ok: true, reason: 'moderation error, allowing through' });
      }
    }

    if (action === 'getCommunityPosts') {
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 20, 1), 50);
      const reqOffset = Math.max(parseInt(payload?.offset) || 0, 0);
      const { data } = await admin
        .from('community_posts')
        .select('id, user_email, username, image_key, ref_image_url, challenge_id, created_at')
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .range(reqOffset, reqOffset + reqLimit - 1);
      const r2Public = Deno.env.get('R2_PUBLIC_URL') || '';
      const posts = (data || []).map((p: any) => ({
        ...p,
        image_url: r2Public ? `${r2Public}/${p.image_key}` : '',
      }));
      return json({ posts, limit: reqLimit, offset: reqOffset });
    }

    if (action === 'deleteCommunityPost') {
      const { postId } = payload || {};
      if (!postId) return json({ error: 'missing postId' }, 400);
      // Only allow deleting own posts
      const { data: post } = await admin
        .from('community_posts').select('id, image_key')
        .eq('id', postId).eq('user_email', email).maybeSingle();
      if (!post) return json({ error: 'not found or not yours' }, 404);
      await admin.from('community_posts').delete().eq('id', post.id);
      // Also delete reactions for this post
      await admin.from('post_reactions').delete().eq('post_id', post.id);
      return json({ ok: true });
    }

    // ── Challenges ──
    if (action === 'getChallenges') {
      const { data } = await admin
        .from('challenges').select('*')
        .gte('deadline', new Date().toISOString())
        .order('deadline', { ascending: true });
      return json({ challenges: data || [] });
    }

    if (action === 'tagPostToChallenge') {
      const { postId, challengeId } = payload || {};
      if (!postId || !challengeId) return json({ error: 'missing postId or challengeId' }, 400);
      const { data: post } = await admin
        .from('community_posts').select('id')
        .eq('id', postId).eq('user_email', email).maybeSingle();
      if (!post) return json({ error: 'not found or not yours' }, 404);
      const { error } = await admin
        .from('community_posts').update({ challenge_id: challengeId })
        .eq('id', postId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Admin: challenge management ──
    if (action === 'adminListChallenges') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { data } = await admin
        .from('challenges').select('*')
        .order('deadline', { ascending: false });
      return json({ challenges: data || [] });
    }

    if (action === 'adminCreateChallenge') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { title, ref_image_url, deadline } = payload || {};
      if (!title || !deadline) return json({ error: 'missing title or deadline' }, 400);
      const { data: ch, error } = await admin.from('challenges').insert({
        title,
        ref_image_url: ref_image_url || null,
        deadline,
      }).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: ch.id });
    }

    if (action === 'adminDeleteChallenge') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { challengeId } = payload || {};
      if (!challengeId) return json({ error: 'missing challengeId' }, 400);
      // Untag posts first
      await admin.from('community_posts').update({ challenge_id: null }).eq('challenge_id', challengeId);
      const { error } = await admin.from('challenges').delete().eq('id', challengeId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Community reactions (no profile needed, just email) ──
    if (action === 'getReactions') {
      // Returns all reactions for given post IDs
      const postIds = Array.isArray(payload?.postIds) ? payload.postIds : [];
      if (!postIds.length) return json({ reactions: [] });
      const { data } = await admin
        .from('post_reactions').select('post_id, emoji, user_email')
        .in('post_id', postIds);
      return json({ reactions: data || [] });
    }

    if (action === 'toggleReaction') {
      const { postId, emoji } = payload || {};
      if (!postId || !emoji) return json({ error: 'missing postId or emoji' }, 400);
      // Check if already reacted
      const { data: existing } = await admin
        .from('post_reactions').select('id')
        .eq('post_id', postId).eq('emoji', emoji).eq('user_email', email)
        .maybeSingle();
      if (existing) {
        await admin.from('post_reactions').delete().eq('id', existing.id);
        return json({ toggled: 'off' });
      } else {
        await admin.from('post_reactions').insert({ post_id: postId, emoji, user_email: email });
        return json({ toggled: 'on' });
      }
    }

    // ── Community leaderboard ──
    if (action === 'getCommunityLeaderboard') {
      const { data: allPosts } = await admin
        .from('community_posts')
        .select('id, user_email, username')
        .eq('approved', true);

      const postIdToAuthor: Record<string, string> = {};
      (allPosts || []).forEach((p: any) => { postIdToAuthor[p.id] = p.user_email; });

      const postIds = Object.keys(postIdToAuthor);
      let reactionsByAuthor: Record<string, number> = {};
      if (postIds.length) {
        const { data: reactions } = await admin
          .from('post_reactions')
          .select('post_id')
          .in('post_id', postIds);
        (reactions || []).forEach((r: any) => {
          const author = postIdToAuthor[r.post_id];
          if (author) reactionsByAuthor[author] = (reactionsByAuthor[author] || 0) + 1;
        });
      }

      const userMap: Record<string, { username: string; posts: number; reactions: number }> = {};
      (allPosts || []).forEach((p: any) => {
        if (!userMap[p.user_email]) userMap[p.user_email] = { username: p.username || p.user_email.split('@')[0], posts: 0, reactions: 0 };
        userMap[p.user_email].posts++;
      });
      Object.entries(reactionsByAuthor).forEach(([em, count]) => {
        if (!userMap[em]) userMap[em] = { username: em.split('@')[0], posts: 0, reactions: 0 };
        userMap[em].reactions = count;
      });

      const leaderboard = Object.entries(userMap)
        .map(([em, d]) => ({ username: d.username, posts: d.posts, reactions: d.reactions, score: d.posts + d.reactions }))
        .sort((a, b) => b.score - a.score || b.posts - a.posts)
        .slice(0, 10);

      return json({ leaderboard });
    }

    // ── My community stats (for badges) ──
    if (action === 'getMyStats') {
      // Posts count (own posts)
      const { data: myPosts } = await admin
        .from('community_posts')
        .select('id, challenge_id')
        .eq('user_email', email);
      const postsCount = (myPosts || []).length;
      const challengesCount = (myPosts || []).filter((p: any) => p.challenge_id).length;

      // Reactions given count
      const { data: myReactions } = await admin
        .from('post_reactions')
        .select('id')
        .eq('user_email', email);
      const reactionsGivenCount = (myReactions || []).length;

      return json({ postsCount, reactionsGivenCount, challengesCount });
    }

    // ── Admin: community moderation ──
    if (action === 'adminListPosts') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const filter = payload?.filter || 'pending'; // 'pending' | 'approved' | 'all'
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 50, 1), 200);
      const reqOffset = Math.max(parseInt(payload?.offset) || 0, 0);
      const search = (payload?.search || '').trim().toLowerCase();
      let query = admin
        .from('community_posts')
        .select('id, user_email, username, image_key, ref_image_url, challenge_id, approved, created_at')
        .order('created_at', { ascending: false })
        .range(reqOffset, reqOffset + reqLimit - 1);
      if (filter === 'pending') query = query.eq('approved', false);
      else if (filter === 'approved') query = query.eq('approved', true);
      if (search) query = query.or(`username.ilike.%${search}%,user_email.ilike.%${search}%`);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);
      const r2Public = Deno.env.get('R2_PUBLIC_URL') || '';
      const posts = (data || []).map((p: any) => ({
        ...p,
        image_url: r2Public ? `${r2Public}/${p.image_key}` : '',
      }));
      // Count pending for badge
      const { count } = await admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('approved', false);
      return json({ posts, pendingCount: count || 0, limit: reqLimit, offset: reqOffset });
    }

    if (action === 'adminApprovePost') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const postIds = Array.isArray(payload?.postIds) ? payload.postIds : [payload?.postId].filter(Boolean);
      if (!postIds.length) return json({ error: 'missing postId(s)' }, 400);
      // Get target emails for logging
      const { data: targets } = await admin.from('community_posts').select('id, user_email').in('id', postIds);
      const { error } = await admin.from('community_posts').update({ approved: true }).in('id', postIds);
      if (error) return json({ error: error.message }, 500);
      // Log moderation action (silent fail if table doesn't exist)
      try {
        for (const t of (targets || [])) {
          await admin.from('moderation_log').insert({ admin_email: email, action: 'approve', target_email: t.user_email, post_id: t.id });
        }
      } catch {}
      return json({ ok: true, count: postIds.length });
    }

    if (action === 'adminRejectPost') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const postIds = Array.isArray(payload?.postIds) ? payload.postIds : [payload?.postId].filter(Boolean);
      if (!postIds.length) return json({ error: 'missing postId(s)' }, 400);
      const reason = payload?.reason || null;
      // Get image keys + emails before deleting
      const { data: posts } = await admin.from('community_posts').select('id, image_key, user_email').in('id', postIds);
      const keys = (posts || []).map((p: any) => p.image_key).filter(Boolean);
      // Delete reactions, then posts
      await admin.from('post_reactions').delete().in('post_id', postIds);
      await admin.from('community_posts').delete().in('id', postIds);
      // Delete R2 images (silent fail)
      try { if (keys.length) await deleteKeys(keys); } catch {}
      // Log moderation action (silent fail if table doesn't exist)
      try {
        for (const t of (posts || [])) {
          await admin.from('moderation_log').insert({ admin_email: email, action: 'reject', target_email: t.user_email, post_id: t.id, reason });
        }
      } catch {}
      return json({ ok: true, count: postIds.length, deletedImages: keys.length });
    }

    if (action === 'adminBanUser') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { error } = await admin.from('profiles').update({ banned: true }).eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      try { await admin.from('moderation_log').insert({ admin_email: email, action: 'ban', target_email: targetEmail }); } catch {}
      return json({ ok: true });
    }

    if (action === 'adminUnbanUser') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { error } = await admin.from('profiles').update({ banned: false }).eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      try { await admin.from('moderation_log').insert({ admin_email: email, action: 'unban', target_email: targetEmail }); } catch {}
      return json({ ok: true });
    }

    if (action === 'adminListBannedUsers') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { data } = await admin.from('profiles')
        .select('email, username, banned, created_at')
        .eq('banned', true)
        .order('email');
      return json({ users: data || [] });
    }

    if (action === 'adminGetUserProfile') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { data: prof } = await admin.from('profiles').select('username, email, banned, plan, created_at').eq('email', targetEmail).maybeSingle();
      const { data: allPosts } = await admin.from('community_posts')
        .select('id, image_key, approved, challenge_id, created_at')
        .eq('user_email', targetEmail).order('created_at', { ascending: false });
      const r2Public = Deno.env.get('R2_PUBLIC_URL') || '';
      const posts = (allPosts || []).map((p: any) => ({ ...p, image_url: r2Public ? `${r2Public}/${p.image_key}` : '' }));
      const { count: approvedCount } = await admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('user_email', targetEmail).eq('approved', true);
      let logs: any[] = [];
      try {
        const { data: logData } = await admin.from('moderation_log')
          .select('action, reason, created_at, admin_email')
          .eq('target_email', targetEmail).order('created_at', { ascending: false }).limit(20);
        logs = logData || [];
      } catch {}
      return json({ profile: prof, posts, approvedCount: approvedCount || 0, trusted: (approvedCount || 0) >= 1, logs });
    }

    if (action === 'adminGetModerationLog') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 50, 1), 200);
      let logs: any[] = [];
      try {
        const { data: logData } = await admin.from('moderation_log')
          .select('*').order('created_at', { ascending: false }).limit(reqLimit);
        logs = logData || [];
      } catch {}
      return json({ logs });
    }

    if (action === 'adminModerationStats') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();
      const { count: pending } = await admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('approved', false);
      const { count: approvedToday } = await admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('approved', true).gte('created_at', todayISO);
      const { count: totalApproved } = await admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('approved', true);
      const { count: totalPosts } = await admin.from('community_posts').select('id', { count: 'exact', head: true });
      return json({ pending: pending || 0, approvedToday: approvedToday || 0, totalApproved: totalApproved || 0, totalPosts: totalPosts || 0 });
    }

    // ── Admin: Users management ──
    if (action === 'adminListUsers') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 50, 1), 200);
      const reqOffset = Math.max(parseInt(payload?.offset) || 0, 0);
      const search = (payload?.search || '').trim().toLowerCase();
      const filterPlan = payload?.plan || 'all';       // 'all' | 'free' | 'pro'
      const filterBanned = payload?.banned || 'all';   // 'all' | 'yes' | 'no'
      const filterAdmin = payload?.admin || 'all';     // 'all' | 'yes' | 'no'
      let query = admin.from('profiles')
        .select('id, email, username, plan, pro_expires_at, banned, is_admin, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(reqOffset, reqOffset + reqLimit - 1);
      if (search) query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%`);
      if (filterPlan === 'free') query = query.or('plan.is.null,plan.eq.free');
      else if (filterPlan === 'pro') query = query.eq('plan', 'pro');
      if (filterBanned === 'yes') query = query.eq('banned', true);
      else if (filterBanned === 'no') query = query.or('banned.is.null,banned.eq.false');
      if (filterAdmin === 'yes') query = query.eq('is_admin', true);
      else if (filterAdmin === 'no') query = query.or('is_admin.is.null,is_admin.eq.false');
      const { data, count, error } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ users: data || [], total: count || 0, limit: reqLimit, offset: reqOffset });
    }

    if (action === 'adminGrantPro') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      const expiresAt = payload?.expiresAt || null; // ISO date or null = never expires
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { error } = await admin.from('profiles')
        .update({ plan: 'pro', pro_expires_at: expiresAt })
        .eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      try { await admin.from('moderation_log').insert({ admin_email: email, action: 'grant_pro', target_email: targetEmail, reason: expiresAt ? `expires ${expiresAt}` : 'lifetime' }); } catch {}
      return json({ ok: true });
    }

    if (action === 'adminRevokePro') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { error } = await admin.from('profiles')
        .update({ plan: 'free', pro_expires_at: null })
        .eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      try { await admin.from('moderation_log').insert({ admin_email: email, action: 'revoke_pro', target_email: targetEmail }); } catch {}
      return json({ ok: true });
    }

    if (action === 'adminDeleteUser') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      // Safety : no self-delete
      if (targetEmail === email) return json({ error: 'Tu ne peux pas supprimer ton propre compte.' }, 400);

      // Get target profile (need id for sessions/favorites + auth user id)
      const { data: target } = await admin.from('profiles').select('id, email').eq('email', targetEmail).maybeSingle();
      const targetId = target?.id;

      // 1. Community posts → need R2 image keys for cleanup
      const { data: posts } = await admin.from('community_posts').select('id, image_key').eq('user_email', targetEmail);
      const postIds = (posts || []).map((p: any) => p.id);
      const imageKeys = (posts || []).map((p: any) => p.image_key).filter(Boolean);

      // 2. Delete post reactions : both the user's reactions AND reactions on user's posts
      await admin.from('post_reactions').delete().eq('user_email', targetEmail);
      if (postIds.length) await admin.from('post_reactions').delete().in('post_id', postIds);

      // 3. Delete community posts
      if (postIds.length) await admin.from('community_posts').delete().in('id', postIds);

      // 4. Delete R2 images (silent fail)
      try { if (imageKeys.length) await deleteKeys(imageKeys); } catch {}

      // 5. Delete favorites + sessions + client errors
      if (targetId) {
        await admin.from('favorites_images').delete().eq('user_id', targetId);
        await admin.from('sessions').delete().eq('user_id', targetId);
      }
      await admin.from('client_errors').delete().eq('user_email', targetEmail);

      // 6. Delete profile row
      await admin.from('profiles').delete().eq('email', targetEmail);

      // 7. Delete Supabase Auth user (can't log in anymore)
      try {
        if (targetId) {
          await admin.auth.admin.deleteUser(targetId);
        }
      } catch (e) {
        console.warn('[adminDeleteUser] auth delete failed:', (e as Error).message);
      }

      // 8. Log
      try { await admin.from('moderation_log').insert({ admin_email: email, action: 'delete_user', target_email: targetEmail, reason: `${postIds.length} posts, ${imageKeys.length} images R2` }); } catch {}

      return json({ ok: true, deletedPosts: postIds.length, deletedImages: imageKeys.length });
    }

    if (action === 'adminToggleAdmin') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const targetEmail = payload?.email;
      const makeAdmin = !!payload?.makeAdmin;
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      // Safety : an admin cannot remove their own admin rights
      if (targetEmail === email && !makeAdmin) return json({ error: 'Tu ne peux pas retirer tes propres droits admin.' }, 400);
      const { error } = await admin.from('profiles').update({ is_admin: makeAdmin }).eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      try { await admin.from('moderation_log').insert({ admin_email: email, action: makeAdmin ? 'grant_admin' : 'revoke_admin', target_email: targetEmail }); } catch {}
      return json({ ok: true });
    }

    // ── Admin: Analytics ──
    if (action === 'adminGetAnalytics') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const daysBack = Math.min(Math.max(parseInt(payload?.days) || 30, 1), 90);
      const sinceDate = new Date(); sinceDate.setDate(sinceDate.getDate() - daysBack);
      sinceDate.setHours(0, 0, 0, 0);
      const sinceISO = sinceDate.toISOString();

      // Totals
      const { count: totalUsers } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      const { count: proUsers } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('plan', 'pro');
      const { count: totalSessions } = await admin.from('sessions').select('id', { count: 'exact', head: true });
      const { count: totalPosts } = await admin.from('community_posts').select('id', { count: 'exact', head: true });

      // Daily signups
      const { data: recentSignups } = await admin.from('profiles')
        .select('created_at').gte('created_at', sinceISO).order('created_at');
      const signupsByDay: Record<string, number> = {};
      (recentSignups || []).forEach((u: any) => {
        const day = new Date(u.created_at).toISOString().split('T')[0];
        signupsByDay[day] = (signupsByDay[day] || 0) + 1;
      });

      // Daily sessions
      const { data: recentSessions } = await admin.from('sessions')
        .select('created_at, duration_seconds').gte('created_at', sinceISO).order('created_at');
      const sessionsByDay: Record<string, number> = {};
      let totalDuration = 0;
      (recentSessions || []).forEach((s: any) => {
        const day = new Date(s.created_at).toISOString().split('T')[0];
        sessionsByDay[day] = (sessionsByDay[day] || 0) + 1;
        totalDuration += s.duration_seconds || 0;
      });
      const avgDurationMin = recentSessions && recentSessions.length
        ? Math.round(totalDuration / recentSessions.length / 60)
        : 0;

      // Build ordered day list (fill gaps with 0)
      const days: Array<{ date: string; signups: number; sessions: number }> = [];
      for (let i = daysBack; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        days.push({
          date: key,
          signups: signupsByDay[key] || 0,
          sessions: sessionsByDay[key] || 0,
        });
      }

      return json({
        totalUsers: totalUsers || 0,
        proUsers: proUsers || 0,
        conversionRate: totalUsers ? Math.round((proUsers || 0) / totalUsers * 1000) / 10 : 0, // %
        totalSessions: totalSessions || 0,
        totalPosts: totalPosts || 0,
        sessionsPeriod: recentSessions?.length || 0,
        signupsPeriod: recentSignups?.length || 0,
        avgDurationMin,
        days,
      });
    }

    // ── Announcements ──
    if (action === 'getActiveAnnouncement') {
      // Public — any logged user can fetch the active banner
      try {
        const nowISO = new Date().toISOString();
        const { data } = await admin.from('announcements')
          .select('id, message, kind, link_url, link_label, created_at, expires_at')
          .eq('active', true)
          .or(`expires_at.is.null,expires_at.gt.${nowISO}`)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        return json({ announcement: data || null });
      } catch { return json({ announcement: null }); }
    }

    if (action === 'adminListAnnouncements') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      try {
        const { data } = await admin.from('announcements').select('*').order('created_at', { ascending: false });
        return json({ announcements: data || [] });
      } catch { return json({ announcements: [] }); }
    }

    if (action === 'adminCreateAnnouncement') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { message, kind, link_url, link_label, expires_at } = payload || {};
      if (!message) return json({ error: 'missing message' }, 400);
      // Deactivate all previous active announcements (only one active at a time)
      await admin.from('announcements').update({ active: false }).eq('active', true);
      const { data: ann, error } = await admin.from('announcements').insert({
        message: String(message).slice(0, 500),
        kind: kind || 'info',           // 'info' | 'warning' | 'success'
        link_url: link_url || null,
        link_label: link_label || null,
        expires_at: expires_at || null,
        active: true,
      }).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: ann.id });
    }

    if (action === 'adminToggleAnnouncement') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { id, active } = payload || {};
      if (!id) return json({ error: 'missing id' }, 400);
      // If activating, deactivate all others
      if (active) await admin.from('announcements').update({ active: false }).neq('id', id);
      const { error } = await admin.from('announcements').update({ active: !!active }).eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'adminDeleteAnnouncement') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { id } = payload || {};
      if (!id) return json({ error: 'missing id' }, 400);
      const { error } = await admin.from('announcements').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Feature Flags (lus par tous, écrits par admin) ──
    if (action === 'getFeatureFlags') {
      try {
        const { data } = await admin.from('feature_flags').select('key, enabled, description');
        const flags: Record<string, boolean> = {};
        (data || []).forEach((f: any) => { flags[f.key] = !!f.enabled; });
        return json({ flags, raw: data || [] });
      } catch { return json({ flags: {}, raw: [] }); }
    }

    if (action === 'adminSetFeatureFlag') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { key, enabled, description } = payload || {};
      if (!key) return json({ error: 'missing key' }, 400);
      try {
        await admin.from('feature_flags').upsert({
          key, enabled: !!enabled, description: description || null, updated_at: new Date().toISOString(),
        });
        return json({ ok: true });
      } catch (e) { return json({ error: (e as Error).message }, 500); }
    }

    if (action === 'adminDeleteFeatureFlag') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { key } = payload || {};
      if (!key) return json({ error: 'missing key' }, 400);
      try { await admin.from('feature_flags').delete().eq('key', key); return json({ ok: true }); }
      catch (e) { return json({ error: (e as Error).message }, 500); }
    }

    // ── App Settings (mode maintenance etc.) ──
    if (action === 'getAppSettings') {
      try {
        const { data } = await admin.from('app_settings').select('key, value');
        const settings: Record<string, any> = {};
        (data || []).forEach((s: any) => { settings[s.key] = s.value; });
        return json({ settings });
      } catch { return json({ settings: {} }); }
    }

    if (action === 'adminSetAppSetting') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { key, value } = payload || {};
      if (!key) return json({ error: 'missing key' }, 400);
      try {
        await admin.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
        return json({ ok: true });
      } catch (e) { return json({ error: (e as Error).message }, 500); }
    }

    // ── Error Log (client reporte, admin lit) ──
    if (action === 'logClientError') {
      // Public — tout user peut remonter une erreur
      const { message, stack, url, userAgent, appVersion } = payload || {};
      if (!message) return json({ ok: false, error: 'missing message' });
      try {
        await admin.from('client_errors').insert({
          user_email: email,
          message: String(message).slice(0, 1000),
          stack: stack ? String(stack).slice(0, 4000) : null,
          url: url ? String(url).slice(0, 500) : null,
          user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
          app_version: appVersion ? String(appVersion).slice(0, 50) : null,
        });
      } catch {}
      return json({ ok: true });
    }

    if (action === 'adminListErrors') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 100, 1), 500);
      try {
        const { data } = await admin.from('client_errors').select('*')
          .order('created_at', { ascending: false }).limit(reqLimit);
        return json({ errors: data || [] });
      } catch { return json({ errors: [] }); }
    }

    if (action === 'adminClearErrors') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      try {
        const before = payload?.before || null;
        let q = admin.from('client_errors').delete();
        if (before) q = q.lt('created_at', before);
        else q = q.neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
        await q;
        return json({ ok: true });
      } catch (e) { return json({ error: (e as Error).message }, 500); }
    }

    // ── Community : featured post (admin) + activity tracking ──
    if (action === 'adminToggleFeaturedPost') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { postId, featured } = payload || {};
      if (!postId) return json({ error: 'missing postId' }, 400);
      // If featuring : unfeature all others first (one featured post at a time)
      if (featured) await admin.from('community_posts').update({ featured: false }).neq('id', postId);
      const { error } = await admin.from('community_posts').update({ featured: !!featured }).eq('id', postId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'adminToggleFeaturedUser') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const { email: targetEmail, featured } = payload || {};
      if (!targetEmail) return json({ error: 'missing email' }, 400);
      const { error } = await admin.from('profiles').update({ featured: !!featured }).eq('email', targetEmail);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // Track user activity (call from app on session start)
    if (action === 'pingActivity') {
      try {
        await admin.from('profiles').update({ last_active: new Date().toISOString() }).eq('email', email);
      } catch {}
      return json({ ok: true });
    }

    // ── Top users + inactive users ──
    if (action === 'adminGetTopUsers') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const sortBy = payload?.sortBy || 'sessions'; // 'sessions' | 'posts' | 'oldest'
      const reqLimit = Math.min(Math.max(parseInt(payload?.limit) || 20, 1), 100);

      const { data: allProfiles } = await admin.from('profiles').select('id, email, username, plan, created_at, last_active');
      if (!allProfiles) return json({ users: [] });

      // Count sessions and posts per user
      const { data: sessions } = await admin.from('sessions').select('user_id');
      const sessionCount: Record<string, number> = {};
      (sessions || []).forEach((s: any) => { sessionCount[s.user_id] = (sessionCount[s.user_id] || 0) + 1; });

      const { data: posts } = await admin.from('community_posts').select('user_email');
      const postCount: Record<string, number> = {};
      (posts || []).forEach((p: any) => { postCount[p.user_email] = (postCount[p.user_email] || 0) + 1; });

      const enriched = allProfiles.map((u: any) => ({
        ...u,
        sessions_count: sessionCount[u.id] || 0,
        posts_count: postCount[u.email] || 0,
      }));

      if (sortBy === 'sessions') enriched.sort((a, b) => b.sessions_count - a.sessions_count);
      else if (sortBy === 'posts') enriched.sort((a, b) => b.posts_count - a.posts_count);
      else if (sortBy === 'oldest') enriched.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      else if (sortBy === 'recent') enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return json({ users: enriched.slice(0, reqLimit) });
    }

    if (action === 'adminGetInactiveUsers') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const days = Math.min(Math.max(parseInt(payload?.days) || 30, 1), 365);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffISO = cutoff.toISOString();
      // Users whose last_active is null OR < cutoff
      const { data } = await admin.from('profiles')
        .select('id, email, username, plan, created_at, last_active')
        .or(`last_active.is.null,last_active.lt.${cutoffISO}`)
        .order('last_active', { ascending: true, nullsFirst: true })
        .limit(500);
      return json({ users: data || [], days });
    }

    // ── Retention cohorts (weekly cohort analysis) ──
    if (action === 'adminGetRetention') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const weeks = Math.min(Math.max(parseInt(payload?.weeks) || 8, 2), 26);
      const { data: allProfiles } = await admin.from('profiles').select('id, created_at, last_active');
      if (!allProfiles) return json({ cohorts: [] });
      const now = Date.now();
      const WEEK_MS = 7 * 24 * 3600 * 1000;
      // Group users by cohort week (week of signup)
      const cohortsMap: Record<string, { total: number; active: number; label: string }> = {};
      allProfiles.forEach((u: any) => {
        const signup = new Date(u.created_at).getTime();
        const weeksAgo = Math.floor((now - signup) / WEEK_MS);
        if (weeksAgo < 0 || weeksAgo > weeks) return;
        const key = 'w-' + weeksAgo;
        if (!cohortsMap[key]) {
          const d = new Date(now - weeksAgo * WEEK_MS);
          cohortsMap[key] = { total: 0, active: 0, label: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) };
        }
        cohortsMap[key].total++;
        // Active = last_active dans les 14 derniers jours
        const isActive = u.last_active && (now - new Date(u.last_active).getTime()) < 14 * 24 * 3600 * 1000;
        if (isActive) cohortsMap[key].active++;
      });
      const cohorts = Object.entries(cohortsMap)
        .map(([k, v]) => ({ week: parseInt(k.replace('w-', '')), ...v, retention: v.total ? Math.round(v.active / v.total * 100) : 0 }))
        .sort((a, b) => b.week - a.week);
      return json({ cohorts });
    }

    // ── CSV Export ──
    if (action === 'adminExportCSV') {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
      if (!profile?.is_admin) return json({ error: 'forbidden' }, 403);
      const kind = payload?.kind || 'users'; // 'users' | 'posts' | 'sessions'
      let rows: any[] = [];
      let headers: string[] = [];
      if (kind === 'users') {
        headers = ['email', 'username', 'plan', 'banned', 'is_admin', 'created_at', 'last_active'];
        const { data } = await admin.from('profiles').select(headers.join(','));
        rows = data || [];
      } else if (kind === 'posts') {
        headers = ['id', 'user_email', 'username', 'approved', 'featured', 'challenge_id', 'created_at'];
        const { data } = await admin.from('community_posts').select(headers.join(','));
        rows = data || [];
      } else if (kind === 'sessions') {
        headers = ['id', 'user_id', 'duration_seconds', 'photo_count', 'category', 'created_at'];
        const { data } = await admin.from('sessions').select(headers.join(','));
        rows = data || [];
      }
      const esc = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
      return json({ csv, count: rows.length, kind });
    }

    // ── Proxy image as base64 (mobile can't fetch R2 due to CORS) ──
    if (action === 'proxyImage') {
      const { imageUrl } = payload || {};
      if (!imageUrl) return json({ error: 'missing imageUrl' }, 400);
      const resp = await fetch(imageUrl);
      if (!resp.ok) return json({ error: 'fetch failed: ' + resp.status }, 502);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      return json({ base64, contentType: resp.headers.get('content-type') || 'image/jpeg' });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
