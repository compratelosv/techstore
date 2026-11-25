// rfq-send — envía al proveedor la solicitud de cotización ya registrada en ts_quote_requests.
// Transportes (en orden de preferencia):
//   1) Gmail API  → secretos GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//   2) Resend     → secreto RESEND_API_KEY (+ MAIL_FROM verificado)
// El correo sale con el folio SC-AÑO-00000 en el asunto, mid-header y pie: trazabilidad completa.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** Cabecera con acentos y emojis sin romper el correo (RFC 2047). */
const headerWord = (text: string) => (/^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`);

const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

function buildMime(rfq: any, fromEmail: string, fromName: string) {
  const boundary = `ts-${rfq.code.replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}`;
  const headers = [
    `From: ${fromName ? `${headerWord(fromName)} ` : ''}<${fromEmail}>`,
    `To: ${clean(rfq.supplier_name)} <${clean(rfq.to_email)}>`,
    ...(rfq.cc_email ? [`Cc: ${clean(rfq.cc_email)}`] : []),
    `Subject: ${headerWord(clean(rfq.subject))}`,
    `Message-ID: <${rfq.code}@techstore.local>`,
    `X-TS-Folio: ${clean(rfq.code)}`,
    `X-TS-Requisicion: ${clean(rfq.requisition_id)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(`Solicitud de cotización ${rfq.code}\n\n${clean(rfq.subject)}\n\nAbrir este correo en un lector con HTML para ver el detalle de las partidas.\n`),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(rfq.body_html || ''),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return `${headers}\r\n\r\n${body}`;
}

async function gmailAccessToken() {
  const id = Deno.env.get('GMAIL_CLIENT_ID');
  const secret = Deno.env.get('GMAIL_CLIENT_SECRET');
  const refresh = Deno.env.get('GMAIL_REFRESH_TOKEN');
  if (!id || !secret || !refresh) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail OAuth: ${data.error_description || data.error || res.status}`);
  return data.access_token as string;
}

async function sendViaGmail(rfq: any, fromName: string) {
  const token = await gmailAccessToken();
  if (!token) return null;
  const fromEmail = Deno.env.get('GMAIL_FROM') || 'me';
  const mime = buildMime(rfq, fromEmail, fromName);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail API: ${data?.error?.message || res.status}`);
  return { transport: 'gmail_api', messageId: data.id as string };
}

async function sendViaResend(rfq: any, fromName: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return null;
  const from = Deno.env.get('MAIL_FROM');
  if (!from) throw new Error('Falta MAIL_FROM (remitente verificado en Resend)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${from}>` : from,
      to: [rfq.to_email],
      ...(rfq.cc_email ? { cc: [rfq.cc_email] } : {}),
      subject: rfq.subject,
      html: rfq.body_html,
      headers: { 'X-TS-Folio': rfq.code },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend: ${data?.message || res.status}`);
  return { transport: 'resend', messageId: data.id as string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization') || '';

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let rfqId: string | undefined;
  try {
    const body = await req.json();
    rfqId = body?.id;
  } catch { /* body inválido */ }
  if (!rfqId) return json({ error: 'Falta el id de la solicitud' }, 400);

  // 1. quién llama: debe ser personal activo
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sesión inválida' }, 401);

  const { data: prof } = await admin
    .from('ts_profiles').select('role, active').eq('id', userData.user.id).maybeSingle();
  if (!prof || prof.active === false || !['admin', 'operador'].includes(prof.role)) {
    return json({ error: 'Solo el personal puede enviar solicitudes' }, 403);
  }

  // 2. la solicitud y los datos del negocio
  const { data: rfq, error: rfqErr } = await admin
    .from('ts_quote_requests').select('*').eq('id', rfqId).maybeSingle();
  if (rfqErr) return json({ error: rfqErr.message }, 500);
  if (!rfq) return json({ error: 'Solicitud de cotización no encontrada' }, 404);
  if (rfq.status === 'enviada') return json({ error: `La solicitud ${rfq.code} ya fue enviada`, code: rfq.code }, 409);

  const { data: bizRow } = await admin.from('ts_settings').select('value').eq('key', 'business').maybeSingle();
  const fromName = clean(bizRow?.value?.name || 'TechStore');

  // 3. enviar
  try {
    const sent = (await sendViaGmail(rfq, fromName)) || (await sendViaResend(rfq, fromName));
    if (!sent) {
      const msg = 'No hay transporte de correo configurado (GMAIL_REFRESH_TOKEN o RESEND_API_KEY)';
      await admin.rpc('ts_rfq_failed', { p_id: rfq.id, p_error: msg });
      return json({ error: msg, code: rfq.code }, 503);
    }

    const { data: upd, error: updErr } = await admin.rpc('ts_rfq_sent', {
      p_id: rfq.id, p_message_id: sent.messageId, p_transport: sent.transport,
    });
    if (updErr) return json({ error: `Se envió pero no se pudo registrar: ${updErr.message}` }, 500);

    return json({
      ok: true,
      code: upd?.code ?? rfq.code,
      to: rfq.to_email,
      cc: rfq.cc_email,
      transport: sent.transport,
      messageId: sent.messageId,
      sent_at: upd?.sent_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.rpc('ts_rfq_failed', { p_id: rfq.id, p_error: msg });
    return json({ error: msg, code: rfq.code }, 502);
  }
});
