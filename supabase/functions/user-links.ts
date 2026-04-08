// user-links
// Auth flow:
//   Portal sends  → Authorization: Bearer <anon_key>  (gateway accepts this always)
//                 → x-user-jwt: <user_access_token>   (our function verifies this)
// This cleanly separates gateway auth from user identity.
//
// Legacy fallback: rows created before email_hash column was added are found by
// decrypting email and comparing. Once all rows have been back-filled (check via
// Supabase: SELECT COUNT(*) FROM links WHERE email_hash IS NULL), set env var
// DISABLE_LEGACY_FALLBACK=true to remove this overhead entirely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
}

// ─── Verify user JWT via Supabase Auth REST ────────────────────────────────────
async function verifyAndGetEmail(userJwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${userJwt}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.email ?? null
  } catch {
    return null
  }
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────
async function getEncKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('ENCRYPTION_SECRET') ?? ''
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const buf = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
  return new TextDecoder().decode(plain)
}

async function safeDec(v: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (!v) return null
  try { return await decrypt(v, key) } catch { return null }
}

async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Handler ──────────────────────────────────────────────────────────────────
const COLS = 'slug,custom_slug,banco,banco_code,banco_domain,alias,card_gradient,card_design,bg_color,' +
             'show_whatsapp,show_email,logo_url,profile_type,nombre_negocio,has_fiscal,' +
             'icon_id,icon_color,created_at,nombre,whatsapp,email,email_hash'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const userJwt = (req.headers.get('x-user-jwt') ?? '').trim()
    if (!userJwt) return json({ error: 'x-user-jwt header requerido' }, 401)

    const userEmail = await verifyAndGetEmail(userJwt)
    if (!userEmail) return json({ error: 'JWT inválido o expirado' }, 401)

    const emailHash = await hashEmail(userEmail)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Primary: fast indexed lookup by email_hash ────────────────────────────
    let { data: links, error: linksErr } = await supabase
      .from('links').select(COLS)
      .eq('email_hash', emailHash)
      .order('created_at', { ascending: false })

    if (linksErr) throw linksErr

    // ── Legacy fallback: rows created before email_hash column existed ────────
    // Disable by setting DISABLE_LEGACY_FALLBACK=true once all rows are migrated.
    // Monitor: SELECT COUNT(*) FROM links WHERE email_hash IS NULL
    if ((!links || links.length === 0) && Deno.env.get('DISABLE_LEGACY_FALLBACK') !== 'true') {
      console.warn(`[user-links] legacy fallback triggered for email_hash=${emailHash.slice(0,8)}… — set DISABLE_LEGACY_FALLBACK=true when all rows are migrated`)

      const encKey = await getEncKey()
      const { data: legacy } = await supabase
        .from('links').select(COLS)
        .is('email_hash', null)
        .order('created_at', { ascending: false })
        .limit(300)

      const matched = []
      for (const row of (legacy ?? [])) {
        const dec = await safeDec(row.email, encKey)
        if (dec?.toLowerCase().trim() === userEmail.toLowerCase().trim()) matched.push(row)
      }

      if (matched.length > 0) {
        console.warn(`[user-links] back-filling email_hash for ${matched.length} row(s) — slugs: ${matched.map(r => r.slug).join(', ')}`)
        // Back-fill email_hash for future fast lookups
        await supabase.from('links')
          .update({ email_hash: emailHash })
          .in('slug', matched.map(r => r.slug))
        links = matched
      }
    }

    if (!links || links.length === 0) return json({ links: [], expirable: {} })

    const encKey = await getEncKey()
    const decrypted = await Promise.all(links.map(async (link) => {
      const { email_hash: _eh, email: _e, ...rest } = link
      return { ...rest, nombre: await safeDec(link.nombre, encKey), whatsapp: await safeDec(link.whatsapp, encKey) }
    }))

    let expirable: Record<string, unknown[]> = {}
    try {
      const { data: expRows } = await supabase.from('expirable_links')
        .select('slug,code,expires_at,created_at')
        .in('slug', links.map(l => l.slug))
        .order('created_at', { ascending: false })
      for (const row of (expRows ?? [])) {
        if (!expirable[row.slug]) expirable[row.slug] = []
        expirable[row.slug].push(row)
      }
    } catch (_) { /* table may not exist yet */ }

    return json({ links: decrypted, expirable })

  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})