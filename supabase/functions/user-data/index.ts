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

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
