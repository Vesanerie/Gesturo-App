// Single endpoint for user data: getStreak, saveSession, getFavorites, saveFavorites,
// community posts, reactions.
// Auth via Supabase JWT, DB writes via service role (bypasses RLS).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { presignPut } from '../_shared/r2.ts';

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

    if (action === 'updateUsername') {
      const { username } = payload || {};
      if (!username || typeof username !== 'string' || username.trim().length < 1) return json({ error: 'invalid username' }, 400);
      const clean = username.trim().slice(0, 30);
      const { error } = await admin.from('profiles').update({ username: clean }).eq('email', email);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, username: clean });
    }

    // ── Community posts ──
    if (action === 'submitCommunityPost') {
      const { refImageUrl, username } = payload || {};
      const key = `Community/${Date.now()}_${email.replace(/[^a-z0-9]/gi, '_')}.jpg`;
      const uploadUrl = await presignPut(key, 'image/jpeg', 600);
      const { data: post, error } = await admin.from('community_posts').insert({
        user_email: email,
        username: username || email.split('@')[0],
        image_key: key,
        ref_image_url: refImageUrl || null,
      }).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ uploadUrl, postId: post.id, imageKey: key });
    }

    if (action === 'getCommunityPosts') {
      const { data } = await admin
        .from('community_posts').select('*')
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(30);
      const r2Public = Deno.env.get('R2_PUBLIC_URL') || '';
      const posts = (data || []).map((p: any) => ({
        ...p,
        image_url: r2Public ? `${r2Public}/${p.image_key}` : '',
      }));
      return json({ posts });
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
      const { data: postCounts } = await admin
        .from('community_posts')
        .select('user_email, username')
        .eq('approved', true);

      const { data: allPosts } = await admin
        .from('community_posts')
        .select('id, user_email')
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
      (postCounts || []).forEach((p: any) => {
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

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
