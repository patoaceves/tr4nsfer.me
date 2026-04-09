// update-link
// Receives: { slug, nombre, alias?, card_gradient, card_design, bg_color,
//             show_whatsapp, show_email, icon_id?, icon_color?,
//             has_fiscal?, razon_social?, rfc?, regimen_fiscal?,
//             cp_fiscal?, ciudad_fiscal?, estado_fiscal?, colonia_fiscal?, calle_fiscal?,
//             whatsapp?, email?,
//             clabe?, banco?, banco_code?, banco_domain?, titular_cuenta?,
//             custom_slug? }
// Returns:  { ok: true } | { error: string }
// Auth: Supabase session JWT required — only the link owner can update.
//
// OWNERSHIP: verified via account_email_hash (the email used at creation time).
// This is intentionally separate from email_hash (the card's contact email),
// which CAN change when the user edits their card. account_email_hash NEVER changes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
}

async function getEncKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('ENCRYPTION_SECRET') ?? ''
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
}

async function encrypt(text: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  const buf = new Uint8Array(12 + ct.byteLength)
  buf.set(iv)
  buf.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...buf))
}

async function enc(v: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (!v) return null
  return encrypt(v, key)
}

async function hashStr(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.toLowerCase().trim()))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashClabe(clabe: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clabe))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      slug, nombre, alias, card_gradient, card_design, bg_color,
      show_whatsapp, show_email, icon_id, icon_color,
      has_fiscal, razon_social, rfc, regimen_fiscal,
      cp_fiscal, ciudad_fiscal, estado_fiscal, colonia_fiscal, calle_fiscal,
      whatsapp, email,
      clabe, banco, banco_code, banco_domain, titular_cuenta,
      custom_slug,
    } = body

    if (!slug) {
      return new Response(JSON.stringify({ error: 'slug requerido' }), { status: 400, headers: CORS })
    }

    const userJwt = (req.headers.get('x-user-jwt') ?? '').trim()
    if (!userJwt) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: CORS })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Verify user JWT and get their current account email
    const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${userJwt}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      }
    })
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: CORS })
    }
    const { email: userEmail } = await authRes.json()
    if (!userEmail) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: CORS })
    }

    // ── Ownership check via account_email_hash (NEVER changes) ───────────────
    // This is independent of the card's contact email (email_hash), which CAN change.
    const accountEmailHash = await hashStr(userEmail)

    const { data: existing, error: fetchErr } = await supabase
      .from('links')
      .select('id, account_email_hash')
      .eq('slug', slug)
      .maybeSingle()

    if (fetchErr || !existing) {
      return new Response(JSON.stringify({ error: 'Link no encontrado' }), { status: 404, headers: CORS })
    }
    if (existing.account_email_hash !== accountEmailHash) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 403, headers: CORS })
    }

    // ── Build update payload ─────────────────────────────────────────────────
    const updates: Record<string, unknown> = {}

    if (alias          !== undefined) updates.alias          = alias         || null
    if (card_gradient  !== undefined) updates.card_gradient  = card_gradient
    if (card_design    !== undefined) updates.card_design    = card_design
    if (bg_color       !== undefined) updates.bg_color       = bg_color
    if (show_whatsapp  !== undefined) updates.show_whatsapp  = !!show_whatsapp
    if (show_email     !== undefined) updates.show_email     = !!show_email
    if (icon_id        !== undefined) updates.icon_id        = icon_id       || null
    if (icon_color     !== undefined) updates.icon_color     = icon_color    || null
    if (has_fiscal     !== undefined) updates.has_fiscal     = !!has_fiscal
    if (cp_fiscal      !== undefined) updates.cp_fiscal      = cp_fiscal     || null
    if (ciudad_fiscal  !== undefined) updates.ciudad_fiscal  = ciudad_fiscal || null
    if (estado_fiscal  !== undefined) updates.estado_fiscal  = estado_fiscal || null

    const encKey = await getEncKey()

    if (nombre         !== undefined) updates.nombre         = await enc(nombre,         encKey)
    if (whatsapp       !== undefined) updates.whatsapp       = await enc(whatsapp,       encKey)
    if (titular_cuenta !== undefined) updates.titular_cuenta = await enc(titular_cuenta, encKey)
    if (razon_social   !== undefined) updates.razon_social   = await enc(razon_social,   encKey)
    if (rfc            !== undefined) updates.rfc            = await enc(rfc,            encKey)
    if (regimen_fiscal !== undefined) updates.regimen_fiscal = await enc(regimen_fiscal, encKey)
    if (colonia_fiscal !== undefined) updates.colonia_fiscal = await enc(colonia_fiscal, encKey)
    if (calle_fiscal   !== undefined) updates.calle_fiscal   = await enc(calle_fiscal,   encKey)

    // Card contact email — update email + email_hash only.
    // account_email_hash is intentionally NOT touched here.
    if (email !== undefined && email) {
      const emailClean = String(email).toLowerCase().trim()
      updates.email      = await enc(emailClean, encKey)
      updates.email_hash = await hashStr(emailClean)
      // account_email_hash stays as-is — ownership identifier never changes
    }

    // CLABE change
    if (clabe !== undefined && clabe) {
      const clabeClean = String(clabe).replace(/\D/g, '')
      if (clabeClean.length !== 18) {
        return new Response(JSON.stringify({ error: 'CLABE debe tener 18 dígitos' }), { status: 400, headers: CORS })
      }
      const newHash = await hashClabe(clabeClean)
      const { data: conflict } = await supabase
        .from('links').select('id').eq('clabe_hash', newHash).neq('slug', slug).maybeSingle()
      if (conflict) {
        return new Response(JSON.stringify({ error: 'clabe_taken' }), { status: 409, headers: CORS })
      }
      updates.clabe      = await enc(clabeClean, encKey)
      updates.clabe_hash = newHash
    }
    if (banco        !== undefined) updates.banco        = banco        || null
    if (banco_code   !== undefined) updates.banco_code   = banco_code   || null
    if (banco_domain !== undefined) updates.banco_domain = banco_domain || null

    // Custom slug
    if (custom_slug !== undefined && custom_slug) {
      const SLUG_RE = /^[a-z0-9-]{3,20}$/
      const cs = String(custom_slug).trim().toLowerCase()
      if (!SLUG_RE.test(cs)) {
        return new Response(JSON.stringify({ error: 'custom_slug_inválido' }), { status: 400, headers: CORS })
      }
      const [bySlug, byCustom] = await Promise.all([
        supabase.from('links').select('id').eq('slug', cs).neq('slug', slug).maybeSingle(),
        supabase.from('links').select('id').eq('custom_slug', cs).neq('slug', slug).maybeSingle(),
      ])
      if (bySlug.data || byCustom.data) {
        return new Response(JSON.stringify({ error: 'custom_slug_taken' }), { status: 409, headers: CORS })
      }
      updates.custom_slug = cs
    }

    const { error: updateErr } = await supabase
      .from('links')
      .update(updates)
      .eq('slug', slug)

    if (updateErr) throw updateErr

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: CORS,
    })
  }
})
