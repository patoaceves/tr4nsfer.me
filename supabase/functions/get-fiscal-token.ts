// get-fiscal-token
// Receives: { slug: string }
// Returns:  { token: string }  — HMAC-SHA256 signed, expires 15 min

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SLUG_RE = /^[a-z0-9-]{3,30}$/

async function getHmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('FISCAL_TOKEN_SECRET') ?? Deno.env.get('ENCRYPTION_SECRET') ?? 'fallback-secret'
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, {name:'HMAC', hash:'SHA-256'}, false, ['sign'])
}

async function sign(payload: string, key: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok', {headers:CORS})
  try {
    const {slug} = await req.json()
    if (!slug) return new Response(JSON.stringify({error:'slug requerido'}),{status:400,headers:CORS})

    // Validate slug format to prevent injection
    if (!SLUG_RE.test(String(slug))) {
      return new Response(JSON.stringify({error:'slug inválido'}),{status:400,headers:CORS})
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')??'', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'')

    // Two separate parameterized queries instead of interpolated .or()
    let data: { id: string; has_fiscal: boolean } | null = null

    const bySlug = await supabase
      .from('links')
      .select('id, has_fiscal')
      .eq('slug', slug)
      .maybeSingle()

    if (bySlug.data) {
      data = bySlug.data
    } else {
      const byCustom = await supabase
        .from('links')
        .select('id, has_fiscal')
        .eq('custom_slug', slug)
        .maybeSingle()
      if (byCustom.data) data = byCustom.data
    }

    if (!data) return new Response(JSON.stringify({error:'Perfil no encontrado'}),{status:404,headers:CORS})
    if (!data.has_fiscal) return new Response(JSON.stringify({error:'Sin datos fiscales'}),{status:404,headers:CORS})

    const payload    = JSON.stringify({ slug, exp: Date.now() + 15 * 60 * 1000 })
    const payloadB64 = btoa(payload)
    const key        = await getHmacKey()
    const sig        = await sign(payloadB64, key)
    const token      = `${payloadB64}.${sig}`

    return new Response(JSON.stringify({token}), {headers:{...CORS,'Content-Type':'application/json'}})
  } catch(e) {
    return new Response(JSON.stringify({error:(e as Error).message}),{status:500,headers:CORS})
  }
})