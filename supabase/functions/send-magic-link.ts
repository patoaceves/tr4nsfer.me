// send-magic-link
// Receives: { email: string }
// Checks email exists as an account owner, then sends magic link via Admin API.
// Always returns { sent: true } to prevent email enumeration.
// Rate limited: 1 request per email per 5 minutes via rate_limits table.
//
// ACCOUNT CHECK: uses account_email_hash — the stable ownership identifier.
// This is intentionally separate from email_hash (card contact email),
// so users can log in even if they later changed their card's contact email.

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

async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  key: string,
  maxHits: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()

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
      if (data.hits >= maxHits) return false
      await supabase.from('rate_limits').update({ hits: data.hits + 1 }).eq('key', key)
      return true
    }
  }

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

    // ── 1. Rate limit: 1 magic link per email per 5 minutes ─────────────────
    const allowed = await checkRateLimit(supabase, `magic:${emailHash}`, 1, 5 * 60 * 1000)
    if (!allowed) {
      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Check whether this email is a registered account owner ───────────
    // We check account_email_hash — the stable identifier that NEVER changes
    // even if the user later updates their card's contact email.
    // This ensures users can always log in with their original account email.
    //
    // Fallback to email_hash for rows not yet migrated.
    const { data: byAccount } = await supabase
      .from('links')
      .select('id')
      .eq('account_email_hash', emailHash)
      .limit(1)
      .maybeSingle()

    // Legacy fallback: rows where account_email_hash not yet set
    let found = !!byAccount
    if (!found) {
      const { data: byEmailHash } = await supabase
        .from('links')
        .select('id')
        .eq('email_hash', emailHash)
        .limit(1)
        .maybeSingle()
      found = !!byEmailHash
    }

    if (!found) {
      // No account — return 200 anyway to prevent email enumeration
      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Send magic link via Admin API ─────────────────────────────────────
    // Fix #6: create_user:true crea el registro en Supabase Auth si aún no existe.
    // Esto es intencional: el usuario creó su link sin autenticación (flujo anon → link),
    // y el primer magic link es el momento en que se "activa" su cuenta de auth.
    // Hay dos clases de usuarios en el sistema:
    //   A) Solo link (sin auth): crearon link pero nunca ingresaron al portal.
    //   B) Link + auth: activados al primer magic link. Pueden editar desde el portal.
    // create_user:true convierte A→B de forma transparente sin fricciones extra.
    // Fix redirect: redirect_to va tanto en el query param como en el body.
    // La Admin API de Supabase puede ignorar el query param en algunos deployments;
    // ponerlo en el body garantiza que el email generado use esta URL de retorno.
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
        body: JSON.stringify({ email: emailClean, create_user: true, redirect_to: redirectTo }),
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
