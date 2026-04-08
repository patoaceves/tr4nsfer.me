import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Only allow slugs that match the generated or custom-slug format
const SLUG_RE = /^[a-z0-9-]{3,30}$/

async function getKey(): Promise<CryptoKey> {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url  = new URL(req.url)
    const slug = url.searchParams.get('slug')

    // Validate format before hitting the DB
    if (!slug || !SLUG_RE.test(slug)) {
      return new Response(JSON.stringify({ error: 'Slug inválido' }), { status: 400, headers: CORS })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Explicit column list — never return hashes or internal fields
    const COLS = [
      'slug', 'banco', 'banco_code', 'banco_domain', 'alias', 'custom_slug',
      'card_gradient', 'card_design', 'bg_color',
      'show_whatsapp', 'show_email', 'logo_url',
      'profile_type', 'nombre_negocio', 'has_fiscal',
      'cp_fiscal', 'ciudad_fiscal', 'estado_fiscal',
      'icon_id', 'icon_color',
      // encrypted fields
      'clabe', 'titular_cuenta', 'nombre', 'whatsapp', 'email',
    ].join(',')

    // Two-step lookup: primary slug column, then custom_slug column
    let data: Record<string, unknown> | null = null

    const bySlug = await supabase.from('links').select(COLS).eq('slug', slug).maybeSingle()
    if (bySlug.data) {
      data = bySlug.data
    } else {
      const byCustom = await supabase.from('links').select(COLS).eq('custom_slug', slug).maybeSingle()
      if (byCustom.data) data = byCustom.data
    }

    if (!data) {
      return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404, headers: CORS })
    }

    const key = await getKey()

    const result = {
      slug:           data.slug,
      custom_slug:    data.custom_slug,
      banco:          data.banco,
      banco_code:     data.banco_code,
      banco_domain:   data.banco_domain,
      alias:          data.alias,
      card_gradient:  data.card_gradient,
      card_design:    data.card_design,
      bg_color:       data.bg_color,
      show_whatsapp:  data.show_whatsapp,
      show_email:     data.show_email,
      logo_url:       data.logo_url,
      profile_type:   data.profile_type,
      nombre_negocio: data.nombre_negocio,
      has_fiscal:     data.has_fiscal,
      cp_fiscal:      data.cp_fiscal,
      ciudad_fiscal:  data.ciudad_fiscal,
      estado_fiscal:  data.estado_fiscal,
      icon_id:        data.icon_id,
      icon_color:     data.icon_color,
      // always decrypted
      clabe:          await safeDec(data.clabe as string | null, key),
      titular_cuenta: await safeDec(data.titular_cuenta as string | null, key),
      nombre:         await safeDec(data.nombre as string | null, key),
      // only returned when the owner has opted in
      whatsapp:       data.show_whatsapp ? await safeDec(data.whatsapp as string | null, key) : null,
      email:          data.show_email    ? await safeDec(data.email as string | null, key)    : null,
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})