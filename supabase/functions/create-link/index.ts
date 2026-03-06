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
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    let slug = '', attempts = 0
    while (attempts < 5) {
      slug = generateSlug()
      const { error } = await supabase.from('links').insert({ slug, clabe: await enc(body.clabe), titular_cuenta: await enc(body.titular_cuenta), whatsapp: await enc(body.whatsapp), email: await enc(body.email), nombre: await enc(body.nombre), instagram: await enc(body.instagram), banco: body.banco, banco_code: body.banco_code, banco_domain: body.banco_domain, alias: body.alias, card_gradient: body.card_gradient, card_design: body.card_design, bg_color: body.bg_color })
      if (!error) break
      if (error.code === '23505') { attempts++; continue }
      throw new Error(error.message)
    }
    return new Response(JSON.stringify({ slug }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
