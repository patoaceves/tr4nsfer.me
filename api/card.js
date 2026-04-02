// api/card.js
// Sirve el HTML de la card con OG tags estáticos en <head>
// para que WhatsApp/Telegram/iMessage lean el preview correcto.
// El body carga card.html completo vía fetch + document.write.

const SUPABASE_URL      = 'https://wtmwwbsjwdisalnzlsnc.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXd3YnNqd2Rpc2Fsbnpsc25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkyMzYsImV4cCI6MjA4ODEzNTIzNn0.3qpiZxBW5vemXZyW7qD8P9s94_Oi5CrwZQUkkFLL_ck'
const SLUG_RE           = /^[a-z0-9][a-z0-9-]{2,29}$/

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = async function handler(req, res) {
  const slug = (req.query.slug || '').toLowerCase().trim()

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(404).send('Not found')
  }

  // Defaults si Supabase no responde
  let ogTitle = 'tr4nsfer.me — Recibe transferencias fácil'
  let ogDesc  = 'Comparte tu CLABE de forma segura con tr4nsfer.me'
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
        if (name)  ogTitle = `Paga a ${name}`
        if (banco) ogDesc  = `${banco} · Copia la CLABE y transfiere directo`
      }
    }
  } catch (_) { /* sirve defaults */ }

  // URL canónica sin ?slug= — preserva el /tomas en la barra del navegador
  const canonicalUrl = `https://tr4nsfer.me/${esc(slug)}`

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>${esc(ogTitle)} — tr4nsfer.me</title>

  <!-- Open Graph — leído por WhatsApp, Telegram, iMessage, LinkedIn -->
  <meta property="og:site_name"    content="tr4nsfer.me"/>
  <meta property="og:type"         content="website"/>
  <meta property="og:url"          content="${canonicalUrl}"/>
  <meta property="og:title"        content="${esc(ogTitle)}"/>
  <meta property="og:description"  content="${esc(ogDesc)}"/>
  <meta property="og:image"        content="${esc(ogImage)}"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:image:type"   content="image/png"/>

  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:title"       content="${esc(ogTitle)}"/>
  <meta name="twitter:description" content="${esc(ogDesc)}"/>
  <meta name="twitter:image"       content="${esc(ogImage)}"/>
</head>
<body style="margin:0;background:#000;">
  <script>
    // Carga card.html completo en este mismo documento.
    // window.location.pathname sigue siendo /${esc(slug)},
    // así que card.html lee el slug correctamente de pathname.
    fetch('/card.html')
      .then(function(r) { return r.text(); })
      .then(function(html) {
        document.open();
        document.write(html);
        document.close();
      })
      .catch(function() { window.location.replace('/'); });
  </script>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.status(200).send(html)
}
