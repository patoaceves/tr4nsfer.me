// Supabase Edge Function: send-email
// Deploy: supabase functions deploy send-email
// Secret:  supabase secrets set RESEND_API_KEY=re_xxxx

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const {
      slug, email, nombre,
      qr_data_url,          // base64 PNG from client (optional)
      profile_type, nombre_negocio,
      whatsapp,
    } = await req.json()

    if (!email || !slug) throw new Error('Missing email or slug')

    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    if (!resendKey) throw new Error('RESEND_API_KEY not set')

    const url        = `https://tr4nsfer.me/${slug}`
    const waUrl      = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('Aquí están mis datos bancarios: '+url)}` : null
    const firstName  = (profile_type === 'negocios' && nombre_negocio)
                        ? nombre_negocio
                        : (nombre || 'usuario').split(' ')[0]

    // QR block — inline base64 if provided, otherwise skip
    const qrBlock = qr_data_url
      ? `<tr><td align="center" style="padding:0 0 48px;">
           <div style="display:inline-block;background:#fff;border-radius:18px;padding:10px;line-height:0;">
             <img src="${qr_data_url}" width="200" height="200" alt="QR" style="display:block;border-radius:10px;"/>
           </div>
           <p style="margin:14px 0 0;font-size:12px;color:#555;font-family:'-apple-system',sans-serif;">Escanea para abrir tu perfil directamente</p>
         </td></tr>`
      : ''

    // WhatsApp CTA row
    const waBlock = waUrl
      ? `<td align="center" style="padding:0 0 0 8px;">
           <a href="${waUrl}" style="display:inline-block;background:#25D366;color:#fff;font-family:'-apple-system',sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:999px;">Enviar por WhatsApp ↗</a>
         </td>`
      : ''

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>¡Tu link está listo!</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'-apple-system','Helvetica Neue',Arial,sans-serif;color:#f0f0f0;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:64px 16px 0;">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

        <!-- LOGO -->
        <tr><td align="left" style="padding-bottom:52px;">
          <img src="https://tr4nsfer.me/logo-white.png" height="22" alt="tr4nsfer.me" style="display:block;"/>
        </td></tr>

        <!-- HERO -->
        <tr><td style="padding-bottom:16px;">
          <h1 style="margin:0;font-size:34px;font-weight:800;letter-spacing:-1px;color:#f0f0f0;line-height:1.15;">¡Tu link está listo,<br/>${firstName}!</h1>
        </td></tr>
        <tr><td style="padding-bottom:48px;">
          <p style="margin:0;font-size:16px;color:#888;line-height:1.7;">Ya puedes compartirlo para recibir transferencias de forma segura y sin fricción.</p>
        </td></tr>

        <!-- LINK SECTION LABEL -->
        <tr><td style="padding-bottom:10px;">
          <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#444;">🔗 Tu link personalizado</p>
        </td></tr>

        <!-- LINK BOX -->
        <tr><td style="padding-bottom:20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:#111;border:1px solid rgba(0,200,150,0.3);border-radius:14px;padding:20px 24px;">
              <a href="${url}" style="font-size:17px;font-weight:700;color:#00c896;text-decoration:none;word-break:break-all;">${url}</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- CTA BUTTONS -->
        <tr><td style="padding-bottom:52px;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="padding:0 ${waUrl ? '8px' : '0'} 0 0;">
                <a href="${url}" style="display:inline-block;background:#00c896;color:#000;font-family:'-apple-system',sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;">Abrir mi link →</a>
              </td>
              ${waBlock}
            </tr>
          </table>
        </td></tr>

        <!-- QR CODE -->
        ${qrBlock}

        <!-- HOW TO SHARE -->
        <tr><td style="background:#111;border:1px solid #222;border-radius:16px;padding:32px 28px 24px;">
          <p style="margin:0 0 24px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#444;">¿Cómo compartirlo?</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="32" valign="top" style="padding-right:14px;padding-bottom:24px;">
                <div style="width:28px;height:28px;border-radius:50%;background:#00c896;text-align:center;line-height:28px;">
                  <span style="font-size:12px;font-weight:800;color:#000;">1</span>
                </div>
              </td>
              <td valign="top" style="padding-bottom:24px;">
                <p style="margin:0;font-size:14px;color:#aaa;line-height:1.65;">Copia el link de arriba y pégalo donde quieras — WhatsApp, iMessage, email o redes sociales.</p>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="padding-right:14px;padding-bottom:24px;">
                <div style="width:28px;height:28px;border-radius:50%;background:#00c896;text-align:center;line-height:28px;">
                  <span style="font-size:12px;font-weight:800;color:#000;">2</span>
                </div>
              </td>
              <td valign="top" style="padding-bottom:24px;">
                <p style="margin:0;font-size:14px;color:#aaa;line-height:1.65;">Quien lo abra verá tu tarjeta con tu CLABE y banco, lista para copiar y hacer la transferencia.</p>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="padding-right:14px;">
                <div style="width:28px;height:28px;border-radius:50%;background:#00c896;text-align:center;line-height:28px;">
                  <span style="font-size:12px;font-weight:800;color:#000;">3</span>
                </div>
              </td>
              <td valign="top">
                <p style="margin:0;font-size:14px;color:#aaa;line-height:1.65;">Sin apps, sin fricciones. Funciona en cualquier dispositivo y navegador.</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- SECURITY NOTICE -->
        <tr><td style="padding-top:36px;padding-bottom:56px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:rgba(0,200,150,0.06);border:1px solid rgba(0,200,150,0.18);border-radius:12px;padding:16px 20px;">
              <p style="margin:0;font-size:13px;color:#666;line-height:1.65;">🔒 Tu información está cifrada y es 100% confidencial. No vendemos ni compartimos tus datos con nadie.</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding-top:28px;padding-bottom:52px;border-top:1px solid #1a1a1a;">
          <p style="margin:0 0 6px;font-size:12px;color:#333;line-height:1.6;">Recibiste este correo porque creaste un link en tr4nsfer.me.</p>
          <p style="margin:0 0 10px;font-size:12px;color:#333;">
            <a href="mailto:hola@tr4nsfer.me" style="color:#444;text-decoration:none;">hola@tr4nsfer.me</a>
            &nbsp;·&nbsp;<a href="https://tr4nsfer.me/terminos" style="color:#444;text-decoration:none;">Términos</a>
            &nbsp;·&nbsp;<a href="https://tr4nsfer.me/privacidad" style="color:#444;text-decoration:none;">Privacidad</a>
          </p>
          <p style="margin:0;font-size:12px;color:#333;">tr4nsfer.me © 2026 · Hecho en México 🇲🇽</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'tr4nsfer.me <hola@tr4nsfer.me>',
        to: [email],
        subject: `¡Tu link tr4nsfer.me/${slug} está listo!`,
        html,
      })
    })

    if (!res.ok) throw new Error(`Resend error: ${await res.text()}`)

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})