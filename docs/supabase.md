# Supabase

## Tables

`profiles` (is_admin, banned, featured, last_active, plan),
`community_posts` (featured, approved, challenge_id),
`post_reactions`, `challenges`, `moderation_log`, `announcements`,
`feature_flags`, `app_settings`, `client_errors`, `user_sessions`,
`favorited_images`, `rotations`, `rotation_files`

## Edge Functions

Déployer `user-data` et `admin-r2` avec `--no-verify-jwt`
(requireAdmin/requireUser font leur propre vérif).

```bash
npm run deploy:functions
```

## Redirect URLs

Inclure `gesturo-admin.pages.dev/*` et `localhost:5500/*` sinon le
magic link admin ne marche pas.
