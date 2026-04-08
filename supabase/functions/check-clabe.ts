import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' }

async function hashClabe(clabe: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clabe))
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
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
  if (req.method==='OPTIONS') return new Response('ok', {headers:CORS})
  try {
    const {clabe} = await req.json()
    if (!clabe) return new Response(JSON.stringify({error:'clabe requerida'}),{status:400,headers:CORS})

    const clabeClean = String(clabe).replace(/\D/g, '')
    if (clabeClean.length !== 18) {
      return new Response(JSON.stringify({error:'CLABE debe tener 18 dígitos'}),{status:400,headers:CORS})
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')??'', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'')

    // Rate limit: 20 checks per IP per minute
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const allowed = await checkRateLimit(supabase, `clabe-check:${ip}`, 20, 60 * 1000)
    if (!allowed) {
      return new Response(JSON.stringify({error:'Demasiadas solicitudes. Intenta en un minuto.'}),{status:429,headers:CORS})
    }

    const hash = await hashClabe(clabeClean)
    const {data} = await supabase.from('links').select('id').eq('clabe_hash',hash).maybeSingle()
    return new Response(JSON.stringify({exists:!!data}),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(e) {
    return new Response(JSON.stringify({error:(e as Error).message}),{status:500,headers:CORS})
  }
})