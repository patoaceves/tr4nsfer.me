// user-links
// Auth flow:
//   Portal sends  → Authorization: Bearer <anon_key>  (gateway accepts this always)
//                 → x-user-jwt: <user_access_token>   (our function verifies this)
//
// OWNERSHIP: uses account_email_hash for lookup — the stable hash set at link creation.
// This is intentionally separate from email_hash (card contact email), which can change.
//
// Legacy fallback: rows without account_email_hash are found via email_hash or by
// decrypting email. Once all rows are migrated, set DISABLE_LEGACY_FALLBACK=true.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
}

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

const COLS = 'slug,custom_slug,banco,banco_code,banco_domain,alias,card_gradient,card_design,bg_color,' +
             'show_whatsapp,show_email,logo_url,profile_type,nombre_negocio,has_fiscal,' +
             'icon_id,icon_color,created_at,nombre,whatsapp,email,email_hash,account_email_hash'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const userJwt = (req.headers.get('x-user-jwt') ?? '').trim()
    if (!userJwt) return json({ error: 'x-user-jwt header requerido' }, 401)

    const userEmail = await verifyAndGetEmail(userJwt)
    if (!userEmail) return json({ error: 'JWT inválido o expirado' }, 401)

    const accountEmailHash = await hashEmail(userEmail)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Primary: fast indexed lookup by account_email_hash ───────────────────
    // account_email_hash is the stable ownership identifier — never changes.
    let { data: links, error: linksErr } = await supabase
      .from('links').select(COLS)
      .eq('account_email_hash', accountEmailHash)
      .order('created_at', { ascending: false })

    if (linksErr) throw linksErr

    // ── Legacy fallback 1: rows back-filled to email_hash but not yet to account_email_hash ──
    if ((!links || links.length === 0) && Deno.env.get('DISABLE_LEGACY_FALLBACK') !== 'true') {
      const { data: byEmailHash } = await supabase
        .from('links').select(COLS)
        .eq('email_hash', accountEmailHash)
        .is('account_email_hash', null)
        .order('created_at', { ascending: false })

      if (byEmailHash && byEmailHash.length > 0) {
        console.warn(`[user-links] legacy fallback 1: back-filling account_email_hash for ${byEmailHash.length} row(s)`)
        await supabase.from('links')
          .update({ account_email_hash: accountEmailHash })
          .in('slug', byEmailHash.map(r => r.slug))
        links = byEmailHash
      }
    }

    // ── Legacy fallback 2: rows without any hash — decrypt and compare ────────
    if ((!links || links.length === 0) && Deno.env.get('DISABLE_LEGACY_FALLBACK') !== 'true') {
      console.warn(`[user-links] legacy fallback 2 triggered for account_email_hash=${accountEmailHash.slice(0,8)}…`)

      const encKey = await getEncKey()
      const { data: legacy } = await supabase
        .from('links').select(COLS)
        .is('account_email_hash', null)
        .order('created_at', { ascending: false })
        .limit(300)

      const matched = []
      for (const row of (legacy ?? [])) {
        const dec = await safeDec(row.email, encKey)
        if (dec?.toLowerCase().trim() === userEmail.toLowerCase().trim()) matched.push(row)
      }

      if (matched.length > 0) {
        console.warn(`[user-links] legacy fallback 2: back-filling ${matched.length} row(s) — slugs: ${matched.map(r => r.slug).join(', ')}`)
        await supabase.from('links')
          .update({ account_email_hash: accountEmailHash })
          .in('slug', matched.map(r => r.slug))
        links = matched
      }
    }

    if (!links || links.length === 0) return json({ links: [], expirable: {} })

    const encKey = await getEncKey()
    const decrypted = await Promise.all(links.map(async (link) => {
      // Strip internal hash fields from the response
      const { email_hash: _eh, account_email_hash: _aeh, email: _e, ...rest } = link
      return {
        ...rest,
        nombre:   await safeDec(link.nombre,   encKey),
        whatsapp: await safeDec(link.whatsapp, encKey),
      }
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
