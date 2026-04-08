// get-fiscal-data
// Receives: { token: string }
// Returns:  decrypted fiscal fields

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SLUG_RE = /^[a-z0-9-]{3,30}$/

async function getHmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('FISCAL_TOKEN_SECRET') ?? Deno.env.get('ENCRYPTION_SECRET') ?? 'fallback-secret'
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, {name:'HMAC', hash:'SHA-256'}, false, ['verify'])
}
async function verify(payload: string, sigB64: string, key: CryptoKey): Promise<boolean> {
  try {
    const sig = Uint8Array.from(atob(sigB64), c=>c.charCodeAt(0))
    return await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payload))
  } catch { return false }
}

async function getEncKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('ENCRYPTION_SECRET') ?? ''
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['decrypt'])
}
async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const buf = Uint8Array.from(atob(encoded), c=>c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:buf.slice(0,12)}, key, buf.slice(12))
  return new TextDecoder().decode(plain)
}
async function safeDec(v: string|null|undefined, key: CryptoKey): Promise<string|null> {
  if (!v) return null
  try { return await decrypt(v, key) } catch { return null }
}

const FISCAL_COLS = 'razon_social,rfc,regimen_fiscal,cp_fiscal,ciudad_fiscal,estado_fiscal,colonia_fiscal,calle_fiscal'

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok', {headers:CORS})
  try {
    const {token} = await req.json()
    if (!token) return new Response(JSON.stringify({error:'token requerido'}),{status:400,headers:CORS})

    // Split and verify token
    const dotIdx = token.indexOf('.')
    if (dotIdx < 0) return new Response(JSON.stringify({error:'token inválido'}),{status:401,headers:CORS})
    const payloadB64 = token.substring(0, dotIdx)
    const sigB64     = token.substring(dotIdx + 1)

    const hmacKey = await getHmacKey()
    const valid   = await verify(payloadB64, sigB64, hmacKey)
    if (!valid) return new Response(JSON.stringify({error:'firma inválida'}),{status:401,headers:CORS})

    const payload = JSON.parse(atob(payloadB64)) as {slug:string, exp:number}
    if (Date.now() > payload.exp) return new Response(JSON.stringify({error:'token expirado'}),{status:401,headers:CORS})

    // Validate slug format before using it in a query
    const slug = String(payload.slug)
    if (!SLUG_RE.test(slug)) {
      return new Response(JSON.stringify({error:'slug inválido en token'}),{status:401,headers:CORS})
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')??'', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'')

    // Two separate parameterized queries instead of interpolated .or()
    let data: Record<string, string|null> | null = null

    const bySlug = await supabase.from('links').select(FISCAL_COLS).eq('slug', slug).maybeSingle()
    if (bySlug.data) {
      data = bySlug.data
    } else {
      const byCustom = await supabase.from('links').select(FISCAL_COLS).eq('custom_slug', slug).maybeSingle()
      if (byCustom.data) data = byCustom.data
    }

    if (!data) return new Response(JSON.stringify({error:'No encontrado'}),{status:404,headers:CORS})

    const encKey = await getEncKey()
    const result = {
      razon_social:   await safeDec(data.razon_social, encKey),
      rfc:            await safeDec(data.rfc, encKey),
      regimen_fiscal: await safeDec(data.regimen_fiscal, encKey),
      cp_fiscal:      data.cp_fiscal,
      ciudad_fiscal:  data.ciudad_fiscal,
      estado_fiscal:  data.estado_fiscal,
      colonia_fiscal: await safeDec(data.colonia_fiscal, encKey),
      calle_fiscal:   await safeDec(data.calle_fiscal, encKey),
    }

    return new Response(JSON.stringify(result), {headers:{...CORS,'Content-Type':'application/json'}})
  } catch(e) {
    return new Response(JSON.stringify({error:(e as Error).message}),{status:500,headers:CORS})
  }
})