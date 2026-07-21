// Cloudflare Worker — tr4nsfer-card
const SUPABASE_URL      = 'https://wtmwwbsjwdisalnzlsnc.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXd3YnNqd2Rpc2Fsbnpsc25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkyMzYsImV4cCI6MjA4ODEzNTIzNn0.3qpiZxBW5vemXZyW7qD8P9s94_Oi5CrwZQUkkFLL_ck'
// Fix #3: SLUG_RE alineado a 3-20 chars — igual que create-link, update-link y la ruta de vercel.json.
// El valor anterior ({2,29}) permitía slugs de hasta 30 chars que el Worker hubiera interceptado
// pero que la ruta de Vercel no hubiera matcheado, dejando al usuario en el index.
const SLUG_RE           = /^[a-z0-9][a-z0-9-]{2,19}$/
// System paths that must NEVER be intercepted by this Worker
const SYSTEM_PATHS      = new Set(['auth','app','portal','index','robots','sitemap','favicon',
                                    'terminos','privacidad','terms','privacy','ayuda','help'])
const BOT_RE            = /WhatsApp|Telegram|Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|iMessage|Viber/i

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function fmtClabe(c) {
  c = (c || '').replace(/\D/g,'')
  return c.length === 18 ? `${c.slice(0,3)} ${c.slice(3,6)} ${c.slice(6,17)} ${c.slice(17)}` : c
}

// Luminancia del bg_color para decidir el color-scheme en parse time.
// Misma fórmula que card.html (renderProfile): >= .5 => fondo claro => scheme light.
// iOS Safari fija el color-scheme en parse time, por eso hay que resolverlo aquí
// y no dejarlo al JS del cliente, que llega tarde para el chrome del navegador.
function isLightHex(hex) {
  const h = String(hex || '').replace('#','').padEnd(6,'0')
  const r = parseInt(h.slice(0,2),16) || 0
  const g = parseInt(h.slice(2,4),16) || 0
  const b = parseInt(h.slice(4,6),16) || 0
  return (0.299*r + 0.587*g + 0.114*b) / 255 >= 0.5
}


export default {
  async fetch(request, env) {
    const url  = new URL(request.url)
    const ua   = request.headers.get('user-agent') || ''
    const slug = url.pathname.slice(1)

    if (!slug || !SLUG_RE.test(slug) || SYSTEM_PATHS.has(slug)) return fetch(request)

    // ── BOT: serve OG meta tags for social previews ──────────────────────────
    if (BOT_RE.test(ua)) {
      let ogTitle = 'tr4nsfer.me'
      let ogDesc  = 'Comparte tu CLABE de forma segura'
      const ogImage = `${SUPABASE_URL}/functions/v1/og-image?slug=${encodeURIComponent(slug)}`

      try {
        const resp = await fetch(
          `${SUPABASE_URL}/functions/v1/get-link?slug=${encodeURIComponent(slug)}`,
          { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
        )
        if (resp.ok) {
          const data = await resp.json()
          if (data && !data.error) {
            const name  = data.nombre_negocio || data.titular_cuenta || data.nombre || ''
            const banco = data.banco || ''
            const clabe = fmtClabe(data.clabe || '')
            if (name)  ogTitle = name
            if (banco && clabe) ogDesc = `${banco}\nCLABE · ${clabe}`
            else if (banco)     ogDesc = banco
            else if (clabe)     ogDesc = `CLABE · ${clabe}`
          }
        }
      } catch (_) {}

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(ogTitle)}</title>
  <meta property="og:site_name"    content="tr4nsfer.me"/>
  <meta property="og:type"         content="website"/>
  <meta property="og:url"          content="https://tr4nsfer.me/${esc(slug)}"/>
  <meta property="og:title"        content="${esc(ogTitle)}"/>
  <meta property="og:description"  content="${esc(ogDesc)}"/>
  <meta property="og:image"        content="${esc(ogImage)}"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:image:type"   content="image/png"/>
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:title"       content="${esc(ogTitle)}"/>
  <meta name="twitter:description" content="${esc(ogDesc)}"/>
  <meta name="twitter:image"       content="${esc(ogImage)}"/>
</head>
<body></body>
</html>`

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'public,max-age=300,stale-while-revalidate=3600',
        }
      })
    }

    // ── REAL USER: inject theme-color before HTML reaches the browser ─────────
    // iOS Safari reads theme-color only at parse time — JS updates don't work.
    // We fetch bg_color from the API in parallel with the page, then inject it
    // into the <head> so the browser chrome matches the card background from load 0.
    try {
      const [apiResp, pageResp] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/functions/v1/get-link?slug=${encodeURIComponent(slug)}`,
          { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
        ),
        fetch(request)
      ])

      let bgColor = '#000000'
      try {
        if (apiResp.ok) {
          const data = await apiResp.json()
          if (data?.bg_color) bgColor = data.bg_color
        }
      } catch (_) {}

      // Guard: si Vercel devolvió algo que no es 200 (un 307, 404, 500…)
      // no intentamos procesar el body — lo pasamos tal cual al browser.
      // Sin este guard, construíamos un new Response({status:307}) sin copiar
      // el header Location, y el browser recibía un 307 sin saber a dónde ir.
      if (!pageResp.ok) return pageResp

      const html     = await pageResp.text()
      // Si el bg_color es claro, el color-scheme debe ser "light"; si no, el navegador
      // trata la pagina como dark y pinta el chrome oscuro aunque el bg sea blanco.
      const scheme   = isLightHex(bgColor) ? 'light' : 'dark'
      // Reemplazar ambos theme-color metas (light y dark) + color-scheme + el background del html.
      // El Worker inyecta el bg_color antes de que el HTML llegue al browser para que
      // iOS Safari lo lea en parse time — JS llega demasiado tarde para esto.
      const modified = html
        // theme-color y color-scheme salen del bg_color de la PÁGINA. Se probó usar
        // el color de la card (primer stop y luego punto medio del gradiente) y en
        // ambos casos la barra se leía negra con gradientes oscuros — la barra debe
        // empalmar con el fondo que la rodea, no con la tarjeta.
        .replace('id="tc-light" content="#000000"', `id="tc-light" content="${bgColor}"`)
        .replace('id="tc-dark"  content="#000000"', `id="tc-dark"  content="${bgColor}"`)
        .replace('id="cs-meta" content="dark"', `id="cs-meta" content="${scheme}"`)
        // Fallback: legacy meta tag por si la página aún no fue actualizada
        .replace('id="theme-color-meta" content="#000000"', `id="theme-color-meta" content="${bgColor}"`)
        // El background del html es el de la página (bg_color)
        .replace('<html lang="es">', `<html lang="es" style="background:${bgColor}">`)

      return new Response(modified, {
        status: pageResp.status,
        headers: {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'public,max-age=60,stale-while-revalidate=300',
        }
      })
    } catch (_) {
      // Fallback: pass through unchanged if anything fails
      return fetch(request)
    }
  }
}
