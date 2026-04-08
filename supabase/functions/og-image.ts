// og-image
// GET /functions/v1/og-image?slug=xxx
// Returns a 1200×630 PNG representing the card for OG/social previews.
// Cached 24h via Cache-Control. CLABE is shown grouped (not masked — it's public data).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import init, { Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.4.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SLUG_RE = /^[a-z0-9-]{3,30}$/

// ─── resvg init (once per isolate) ─────────────────────────────────────────
let _resvgReady = false
async function ensureResvg() {
  if (_resvgReady) return
  await init(fetch('https://esm.sh/@resvg/resvg-wasm@2.4.1/index_bg.wasm'))
  _resvgReady = true
}

// ─── AES-GCM decrypt ────────────────────────────────────────────────────────
async function getEncKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(Deno.env.get('ENCRYPTION_SECRET') ?? ''))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
}
async function safeDec(v: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (!v) return null
  try {
    const buf   = Uint8Array.from(atob(v), c => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
    return new TextDecoder().decode(plain)
  } catch { return null }
}

// ─── Format CLABE: groups of 3 3 11 1 ───────────────────────────────────────
function fmtClabe(c: string): string {
  const d = c.replace(/\D/g, '')
  if (d.length !== 18) return d
  return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6,17)} ${d.slice(17)}`
}

// ─── Escape XML special chars ───────────────────────────────────────────────
function x(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── Parse gradient → two hex stops ────────────────────────────────────────
function gradColors(grad: string): [string, string] {
  const m = (grad || '').match(/#[0-9a-fA-F]{6}/g) || []
  return [m[0] || '#004d38', m[m.length - 1] || '#00c896']
}

// ─── Card SVG (1200×630) ────────────────────────────────────────────────────
function buildSVG(params: {
  nombre: string
  banco: string
  clabe: string
  gradient: string
  bgColor: string
  nombreNegocio: string | null
  alias: string | null
}): string {
  const { nombre, banco, clabe, gradient, bgColor, nombreNegocio, alias } = params
  const [c1, c2] = gradColors(gradient)

  // Luminance of bg to pick text/logo color
  const bg = bgColor.replace('#','').padEnd(6,'0')
  const br = parseInt(bg.slice(0,2),16), bgg = parseInt(bg.slice(2,4),16), bb = parseInt(bg.slice(4,6),16)
  const bgLum = (0.299*br + 0.587*bgg + 0.114*bb) / 255

  // Card text color
  const [cr, cg2, cb] = [parseInt(c2.slice(1,3),16), parseInt(c2.slice(3,5),16), parseInt(c2.slice(5,7),16)]
  const cardLum = (0.299*cr + 0.587*cg2 + 0.114*cb) / 255
  const cardText = cardLum > 0.5 ? '#1a1a1a' : '#ffffff'
  const cardMuted = cardLum > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)'

  const displayName = x((nombreNegocio || nombre || '').toUpperCase())
  const displayBanco = x((banco || '').toUpperCase())
  const displayClabe = x(fmtClabe(clabe))
  const displayAlias = alias ? x(alias.toUpperCase()) : ''

  // Right-side text color based on bg
  const rightText = bgLum > 0.5 ? '#111' : '#ffffff'
  const rightMuted = bgLum > 0.5 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)'
  const accentColor = c2

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <clipPath id="cc">
      <rect x="60" y="65" width="580" height="500" rx="36"/>
    </clipPath>
  </defs>

  <!-- Page background -->
  <rect width="1200" height="630" fill="${bgColor || '#000000'}"/>

  <!-- Subtle right-side glow -->
  <ellipse cx="980" cy="315" rx="280" ry="220" fill="${accentColor}" opacity="0.04"/>

  <!-- Card shadow -->
  <rect x="68" y="76" width="580" height="500" rx="36" fill="rgba(0,0,0,0.55)"/>

  <!-- Card body -->
  <rect x="60" y="65" width="580" height="500" rx="36" fill="url(#cg)"/>

  <!-- Card design overlay: diagonal -->
  <g clip-path="url(#cc)">
    <polygon points="60,65 640,65 640,248 60,400" fill="rgba(255,255,255,0.09)"/>
    <polygon points="440,65 640,65 640,195" fill="rgba(255,255,255,0.07)"/>
    <polygon points="60,415 640,240 640,565 60,565" fill="rgba(255,255,255,0.05)"/>
  </g>

  <!-- tr4nsfer.me wordmark on card (top right of card) -->
  <text x="618" y="112" font-family="Inter,-apple-system,sans-serif" font-size="13"
        font-weight="600" fill="${cardText}" opacity="0.7" text-anchor="end">tr4nsfer.me</text>

  <!-- Bank pill -->
  <rect x="100" y="140" width="${Math.min(displayBanco.length * 13 + 52, 300)}" height="44"
        rx="22" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
  <text x="124" y="169" font-family="Inter,-apple-system,sans-serif" font-size="20"
        font-weight="600" fill="${cardText}" opacity="0.92">${displayBanco}</text>

  <!-- CLABE label -->
  <text x="100" y="290" font-family="Inter,-apple-system,sans-serif" font-size="12"
        font-weight="700" fill="${cardMuted}" letter-spacing="2">CLABE</text>
  <!-- CLABE value -->
  <text x="100" y="328" font-family="Inter,-apple-system,sans-serif" font-size="26"
        font-weight="600" fill="${cardText}" letter-spacing="1">${displayClabe}</text>

  <!-- Titular label -->
  <text x="100" y="390" font-family="Inter,-apple-system,sans-serif" font-size="12"
        font-weight="700" fill="${cardMuted}" letter-spacing="2">TITULAR DE LA CUENTA</text>
  <!-- Titular value -->
  <text x="100" y="424" font-family="Inter,-apple-system,sans-serif" font-size="22"
        font-weight="600" fill="${cardText}">${displayName}</text>

  <!-- Alias (bottom of card) -->
  ${displayAlias ? `<text x="100" y="528" font-family="Inter,-apple-system,sans-serif" font-size="13"
        font-weight="700" fill="${cardText}" opacity="0.55" letter-spacing="3">${displayAlias}</text>` : ''}

  <!-- ── RIGHT SIDE ── -->

  <!-- Isotipo tr4nsfer.me -->
  <g transform="translate(840,198) scale(0.78)">
    <path stroke-linecap="round" transform="matrix(-0.75,0,0,-0.75,854.051,1241.558)" fill="none"
      d="M 183.5 183.5 L 920.4 183.5" stroke="${accentColor}" stroke-width="367"/>
    <path stroke-linecap="round" transform="matrix(0,-0.75,0.75,0,960.927,864.366)" fill="none"
      d="M 932.6 183.5 L 183.5 183.5" stroke="${cardLum > 0.5 ? '#555' : '#ffffff'}" stroke-width="367"/>
    <path stroke-linecap="round" transform="matrix(0.53033,-0.53033,0.53033,0.53033,-28.288,1097.647)" fill="none"
      d="M 183.5 183.5 L 1945.4 183.5" stroke="${accentColor}" stroke-width="367"/>
    <g transform="translate(1068,1061)"><circle cx="139.75" cy="139.71" r="139.35" fill="${accentColor}"/></g>
  </g>

  <!-- Wordmark -->
  <text x="980" y="362" font-family="Inter,-apple-system,sans-serif" font-size="40"
        font-weight="800" fill="${rightText}" text-anchor="middle" letter-spacing="-1">tr4nsfer.me</text>

  <!-- Tagline -->
  <text x="980" y="400" font-family="Inter,-apple-system,sans-serif" font-size="16"
        fill="${rightMuted}" text-anchor="middle">Comparte tu CLABE fácil y seguro</text>

  <!-- CTA pill -->
  <rect x="880" y="430" width="200" height="42" rx="21" fill="${accentColor}" opacity="0.15"
        stroke="${accentColor}" stroke-width="1" stroke-opacity="0.4"/>
  <text x="980" y="457" font-family="Inter,-apple-system,sans-serif" font-size="14"
        font-weight="700" fill="${accentColor}" text-anchor="middle">Crear mi link →</text>
</svg>`
}

// ─── Default fallback SVG ────────────────────────────────────────────────────
function defaultSVG(): string {
  return buildSVG({
    nombre: 'TR4NSFER.ME',
    banco: 'SPEI',
    clabe: '000000000000000000',
    gradient: 'linear-gradient(135deg,#004d38,#00c896)',
    bgColor: '#000000',
    nombreNegocio: null,
    alias: null,
  })
}

// ─── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url  = new URL(req.url)
    const slug = url.searchParams.get('slug') || ''

    await ensureResvg()

    if (!slug || !SLUG_RE.test(slug)) {
      const png = new Resvg(defaultSVG()).render().asPng()
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=86400', ...CORS }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const COLS = 'nombre,titular_cuenta,banco,clabe,card_gradient,bg_color,nombre_negocio,alias'

    let row: Record<string, unknown> | null = null
    const r1 = await supabase.from('links').select(COLS).eq('slug', slug).maybeSingle()
    if (r1.data) row = r1.data
    else {
      const r2 = await supabase.from('links').select(COLS).eq('custom_slug', slug).maybeSingle()
      if (r2.data) row = r2.data
    }

    const encKey = await getEncKey()

    const nombre  = row ? (await safeDec(row.nombre  as string, encKey) || await safeDec(row.titular_cuenta as string, encKey) || '') : ''
    const clabe   = row ? (await safeDec(row.clabe   as string, encKey) || '') : ''

    const svg = buildSVG({
      nombre,
      clabe,
      banco:        (row?.banco         as string) || '',
      gradient:     (row?.card_gradient as string) || 'linear-gradient(135deg,#004d38,#00c896)',
      bgColor:      (row?.bg_color      as string) || '#000000',
      nombreNegocio:(row?.nombre_negocio as string) || null,
      alias:        (row?.alias         as string) || null,
    })

    const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng()

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public,max-age=86400,stale-while-revalidate=3600',
        ...CORS,
      }
    })
  } catch (e) {
    // Fallback: serve default SVG so social cards don't break
    try {
      await ensureResvg()
      const png = new Resvg(defaultSVG()).render().asPng()
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=300', ...CORS }
      })
    } catch {
      return new Response('Internal error: ' + (e as Error).message, { status: 500 })
    }
  }
})