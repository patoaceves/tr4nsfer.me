// send-magic-link
// Receives: { email: string }
// Checks email exists in links table, then sends magic link via Admin API.
// Always returns { sent: true } to prevent email enumeration.
// Rate limited: 1 request per email per 5 minutes via rate_limits table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// Uses rate_limits table: { key TEXT PK, hits INT, window_start TIMESTAMPTZ }
// Returns false if the caller is over the limit.
async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  key: string,
  maxHits: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()

  // Fire-and-forget: purge entries older than 2x window to keep table small
  supabase.from('rate_limits')
    .delete()
    .lt('window_start', new Date(now - windowMs * 2).toISOString())
    .then(() => {/* ignore */})

  const { data } = await supabase
    .from('rate_limits')
    .select('hits, window_start')
    .eq('key', key)
    .maybeSingle()

  if (data) {
    const windowStart = new Date(data.window_start).getTime()
    if (windowStart > now - windowMs) {
      // Still in the same window
      if (data.hits >= maxHits) return false
      await supabase.from('rate_limits').update({ hits: data.hits + 1 }).eq('key', key)
      return true
    }
  }

  // First request or window expired — open a new window
  await supabase.from('rate_limits').upsert({
    key,
    hits: 1,
    window_start: new Date(now).toISOString(),
  })
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { email } = await req.json()
    if (!email) {
      return new Response(JSON.stringify({ error: 'email requerido' }), { status: 400, headers: CORS })
    }

    const emailClean = String(email).toLowerCase().trim()
    if (!EMAIL_RE.test(emailClean)) {
      return new Response(JSON.stringify({ error: 'email inválido' }), { status: 400, headers: CORS })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase    = createClient(supabaseUrl, serviceKey)

    const emailHash = await hashEmail(emailClean)

    // ── 1. Rate limit: 1 magic link per email cada 5 minutos ─────────────────
    const allowed = await checkRateLimit(supabase, `magic:${emailHash}`, 1, 5 * 60 * 1000)
    if (!allowed) {
      // Still return 200 — don't reveal that the email exists AND is being hammered
      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Check whether this email has a registered link ───────────────────
    // We deliberately do NOT short-circuit with an error if no account is found.
    // Returning { sent: true } regardless prevents email enumeration.
    const { data } = await supabase
      .from('links')
      .select('id')
      .eq('email_hash', emailHash)
      .maybeSingle()

    if (!data) {
      // No account — return 200 anyway, just don't hit the mail API
      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Send magic link via Admin API ─────────────────────────────────────
    const redirectTo = 'https://tr4nsfer.me/auth?return=portal'
    const otpRes = await fetch(
      `${supabaseUrl}/auth/v1/magiclink?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
        body: JSON.stringify({ email: emailClean, create_user: true }),
      }
    )

    if (!otpRes.ok) {
      const errBody = await otpRes.json().catch(() => ({}))
      const msg = errBody.msg || errBody.message || errBody.error_description || 'Error enviando link'
      return new Response(JSON.stringify({ error: msg }), {
        status: otpRes.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})