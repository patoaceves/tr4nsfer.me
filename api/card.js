// api/card.js
// Lee card.html del filesystem, inyecta OG tags en el <head>, sirve el HTML completo.
// Sin fetch del cliente, sin document.write — funciona siempre.

const fs   = require('fs')
const path = require('path')

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

// Cache card.html en memoria para warm lambdas
let _cardHtml = null
function getCardHtml() {
  if (!_cardHtml) {
    _cardHtml = fs.readFileSync(path.join(process.cwd(), 'card.html'), 'utf8')
  }
  return _cardHtml
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
  } catch (_) { /* usa defaults */ }

  // OG tags a inyectar antes de </head>
  const ogTags = `
  <!-- OG: inyectado por api/card.js para bots sociales -->
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
  <title>${esc(ogTitle)} — tr4nsfer.me</title>`

  // Inyectar OG tags + actualizar <title> en card.html
  let html = getCardHtml()
    .replace(/<title>.*?<\/title>/i, '')          // quitar <title> original
    .replace('</head>', ogTags + '\n</head>')     // inyectar OG + nuevo title

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.status(200).send(html)
}
