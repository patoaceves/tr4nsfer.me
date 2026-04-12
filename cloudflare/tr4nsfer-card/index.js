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
      // Reemplazar ambos theme-color metas (light y dark) + el background del html.
      // El Worker inyecta el bg_color antes de que el HTML llegue al browser para que
      // iOS Safari lo lea en parse time — JS llega demasiado tarde para esto.
      const modified = html
        .replace('id="tc-light" content="#000000"', `id="tc-light" content="${bgColor}"`)
        .replace('id="tc-dark"  content="#000000"', `id="tc-dark"  content="${bgColor}"`)
        // Fallback: legacy meta tag por si la página aún no fue actualizada
        .replace('id="theme-color-meta" content="#000000"', `id="theme-color-meta" content="${bgColor}"`)
        // Inyectar background en html element via style inline para que Safari lo lea
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
