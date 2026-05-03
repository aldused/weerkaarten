/**
 * Cloudflare Worker — Vlaggenweer-mail via Resend
 *
 * Endpoint:
 *   POST https://mail.weerlab.nl/
 *   Content-Type: application/json
 *   Body: { subject, body, pdfBase64, filename }
 *
 * Stuurt mail met PDF-attachment naar de hardcoded RECIPIENTS via Resend.
 *
 * Setup (eenmalig):
 *   1. resend.com account → verifieer weerlab.nl domein (DNS records SPF/DKIM)
 *   2. Maak API-key in Resend dashboard
 *   3. wrangler deploy
 *   4. wrangler secret put RESEND_API_KEY  (paste de key)
 */

const RECIPIENTS = [
  'jaap@semaphore-signs.nl',
  'yoerie@lenn.nl',
  'mark@helderred.nl',
];

const FROM = 'Ed Aldus Weer en Media <vlaggenweer@weerlab.nl>';
const REPLY_TO = 'ed@weerlab.nl';

const ALLOWED_ORIGINS = [
  'https://weerlab.nl',
  'https://www.weerlab.nl',
  'http://localhost:8093',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://weerlab.nl';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResp(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return jsonResp({ error: 'Use POST' }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonResp({ error: 'Origin niet toegestaan' }, 403, origin);
    }
    if (!env.RESEND_API_KEY) {
      return jsonResp({ error: 'RESEND_API_KEY niet geconfigureerd' }, 500, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResp({ error: 'Invalid JSON' }, 400, origin);
    }

    const { subject, body, pdfBase64, filename } = payload;
    if (!subject || !pdfBase64) {
      return jsonResp({ error: 'subject en pdfBase64 zijn verplicht' }, 400, origin);
    }
    if (typeof pdfBase64 !== 'string' || pdfBase64.length > 8_000_000) {
      return jsonResp({ error: 'pdfBase64 ontbreekt of te groot (>6MB)' }, 400, origin);
    }

    const tekst = (body || '').trim();
    const htmlBody = tekst
      ? `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f2744">${escapeHtml(tekst).replace(/\n/g, '<br>')}</p>`
      : `<p style="font-family:Arial,sans-serif;font-size:14px;color:#52677d;font-style:italic">Zie bijlage voor het vlaggenweer.</p>`;
    const html = `${htmlBody}
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:10px">
        Verstuurd vanaf <a href="https://weerlab.nl/#weerbewaking" style="color:#0d9488;text-decoration:none">weerlab.nl</a> · Ed Aldus Weer en Media
      </p>`;

    const resendBody = {
      from: FROM,
      to: RECIPIENTS,
      reply_to: REPLY_TO,
      subject,
      html,
      attachments: [{
        filename: filename || 'VLAGGENWEER.pdf',
        content: pdfBase64,
      }],
    };

    let resendJson;
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resendBody),
      });
      resendJson = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return jsonResp({ error: 'Resend gaf fout', status: resp.status, detail: resendJson }, 502, origin);
      }
    } catch (e) {
      return jsonResp({ error: 'Resend onbereikbaar', detail: String(e) }, 502, origin);
    }

    return jsonResp({
      ok: true,
      id: resendJson.id,
      recipients: RECIPIENTS,
      subject,
    }, 200, origin);
  },
};
