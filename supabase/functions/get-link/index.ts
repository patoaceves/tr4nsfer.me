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

async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const buf = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0,12) }, key, buf.slice(12))
  return new TextDecoder().decode(plain)
}

async function safeDec(v: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (!v) return null
  try { return await decrypt(v, key) } catch { return v }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const slug = new URL(req.url).searchParams.get('slug')
    if (!slug) return new Response(JSON.stringify({ error: 'Slug requerido' }), { status: 400, headers: CORS })
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data, error } = await supabase.from('links').select('*').eq('slug', slug).single()
    if (error || !data) return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404, headers: CORS })
    const key = await getKey('decrypt')
    const result = { ...data, clabe: await safeDec(data.clabe, key), titular_cuenta: await safeDec(data.titular_cuenta, key), whatsapp: await safeDec(data.whatsapp, key), email: await safeDec(data.email, key), nombre: await safeDec(data.nombre, key), instagram: await safeDec(data.instagram, key) }
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
