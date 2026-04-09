// Public configuration — safe to bundle in distributed app.
// Secrets (R2 access keys, OpenAI, Instagram token) live exclusively in
// Supabase Edge Function env vars and are NEVER shipped to the client.
module.exports = {
  SUPABASE_URL: 'https://okhmokriethdqhsiptvu.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fzN6wsi999QFHNvg6i9m8A_wMIfp2ys',
}
