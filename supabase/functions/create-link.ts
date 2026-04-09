import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getKey(mode: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const secret = Deno.env.get('ENCRYPTION_SECRET') ?? ''
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [mode])
}

async function encrypt(text: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  const buf = new Uint8Array(12 + ct.byteLength)
  buf.set(iv)
  buf.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...buf))
}

async function hashClabe(clabe: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clabe))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateSlug(): string {
  const L = 'abcdefghijklmnopqrstuvwxyz', N = '0123456789'
  const p = [0,1,2,3,4,5], lp: number[] = []
  while (lp.length < 3) { const i = Math.floor(Math.random() * p.length); lp.push(p.splice(i,1)[0]) }
  return [0,1,2,3,4,5].map(i => lp.includes(i) ? L[Math.floor(Math.random()*26)] : N[Math.floor(Math.random()*10)]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json()
    const key = await getKey('encrypt')
    const enc = async (v: string | null | undefined) => v ? await encrypt(v, key) : null

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const clabeClean = body.clabe ? String(body.clabe).replace(/\D/g, '') : null
    const clabeHash  = clabeClean ? await hashClabe(clabeClean) : null

    // email_hash        = hash of the card's contact email (can change later via update-link)
    // account_email_hash = hash of the account owner email (NEVER changes — ownership identifier)
    // At creation time both are always the same value.
    const emailHash = body.email ? await hashEmail(body.email) : null

    const fields = {
      clabe:               await enc(body.clabe),
      clabe_hash:          clabeHash,
      titular_cuenta:      await enc(body.titular_cuenta),
      whatsapp:            await enc(body.whatsapp),
      email:               await enc(body.email),
      email_hash:          emailHash,
      account_email_hash:  emailHash,   // ← stable ownership identifier, set once here
      nombre:              await enc(body.nombre),
      banco:               body.banco,
      banco_code:          body.banco_code,
      banco_domain:        body.banco_domain,
      alias:               body.alias,
      card_gradient:       body.card_gradient,
      card_design:         body.card_design,
      bg_color:            body.bg_color,
      show_whatsapp:       body.show_whatsapp ?? false,
      show_email:          body.show_email ?? false,
      logo_url:            body.logo_url ?? null,
      profile_type:        body.profile_type ?? 'personal',
      nombre_negocio:      body.nombre_negocio ?? null,
      has_fiscal:          body.has_fiscal ?? false,
      razon_social:        await enc(body.razon_social),
      rfc:                 await enc(body.rfc),
      regimen_fiscal:      await enc(body.regimen_fiscal),
      cp_fiscal:           body.cp_fiscal ?? null,
      ciudad_fiscal:       body.ciudad_fiscal ?? null,
      estado_fiscal:       body.estado_fiscal ?? null,
      colonia_fiscal:      await enc(body.colonia_fiscal),
      calle_fiscal:        await enc(body.calle_fiscal),
      icon_id:             body.icon_id ?? null,
      icon_color:          body.icon_color ?? null,
    }

    let slug = ''
    const customSlug = body.custom_slug ? String(body.custom_slug).trim().toLowerCase() : ''

    if (customSlug && /^[a-z0-9-]{3,20}$/.test(customSlug)) {
      const { data: existing } = await supabase
        .from('links').select('id').eq('slug', customSlug).maybeSingle()
      if (existing) {
        return new Response(JSON.stringify({ error: 'slug_taken' }), {
          status: 409, headers: { ...CORS, 'Content-Type': 'application/json' }
        })
      }
      slug = customSlug
      const { error } = await supabase.from('links').insert({ slug, ...fields })
      if (error) throw new Error(error.message)
    } else {
      let attempts = 0
      while (attempts < 5) {
        slug = generateSlug()
        const { error } = await supabase.from('links').insert({ slug, ...fields })
        if (!error) break
        if (error.code === '23505') { attempts++; continue }
        throw new Error(error.message)
      }
    }

    return new Response(JSON.stringify({ slug }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
