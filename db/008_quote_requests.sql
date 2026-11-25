-- 008_quote_requests.sql
-- Solicitudes de cotización enviadas por correo al proveedor, con folio trazable.
-- Folio: SC-<año>-<consecutivo>  (ej. SC-2026-00001)  ·  ligado a REQ-00001
-- El correo se envía desde una Edge Function; aquí queda el registro, el estado y el evento.

create sequence if not exists ts_rfq_seq;

do $$ begin
  create type ts_rfq_status as enum ('programada','enviada','fallida','respondida','anulada');
exception when duplicate_object then null; end $$;

create table if not exists ts_quote_requests (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  requisition_id      uuid not null references ts_requisitions(id) on delete cascade,
  supplier_id         uuid references ts_suppliers(id),
  supplier_name       text,
  to_email            text not null,
  cc_email            text,
  subject             text not null,
  body_html           text not null,
  status              ts_rfq_status not null default 'programada',
  transport           text,
  provider_message_id text,
  attempts            integer not null default 0,
  last_error          text,
  sent_at             timestamptz,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  constraint ts_rfq_to_fmt check (to_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint ts_rfq_cc_fmt check (cc_email is null or cc_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create index if not exists ts_rfq_req_idx on ts_quote_requests (requisition_id, created_at desc);
create index if not exists ts_rfq_status_idx on ts_quote_requests (status);

alter table ts_quote_requests enable row level security;

drop policy if exists ts_rfq_read on ts_quote_requests;
create policy ts_rfq_read on ts_quote_requests
  for select to authenticated
  using (ts_req_can_see(requisition_id));

revoke all on table ts_quote_requests from anon, authenticated;
grant select on table ts_quote_requests to authenticated;

-- escape mínimo para el HTML del correo
create or replace function ts_rfq_esc(p text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

/* Crea la solicitud y devuelve el registro con su folio. NO envía: el envío lo hace la Edge Function
   y luego marca el resultado con ts_rfq_sent / ts_rfq_failed. */
create or replace function ts_rfq_create(
  p_req      uuid,
  p_supplier uuid default null,
  p_to       text default null,
  p_cc       text default null,
  p_note     text default null,
  p_days     integer default 5
) returns ts_quote_requests
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_r       ts_requisitions;
  v_s       ts_suppliers;
  v_biz     jsonb;
  v_to      text;
  v_cc      text;
  v_code    text;
  v_subject text;
  v_body    text;
  v_rows    text;
  v_count   integer;
  v_row     ts_quote_requests;
  v_dead    date;
begin
  if not ts_is_staff() then
    raise exception 'Solo el personal puede solicitar cotizaciones' using errcode = '42501';
  end if;
  if not ts_req_can_see(p_req) then
    raise exception 'No tienes acceso a esta requisición' using errcode = '42501';
  end if;

  select * into v_r from ts_requisitions where id = p_req for update;
  if not found then raise exception 'Requisición no encontrada'; end if;
  if v_r.status not in ('borrador','solicitada','aprobada') then
    raise exception 'No se pueden pedir cotizaciones en estado "%"', v_r.status;
  end if;

  select * into v_s from ts_suppliers where id = coalesce(p_supplier, v_r.supplier_id);
  if not found then raise exception 'Selecciona el proveedor al que se enviará la solicitud'; end if;
  if v_s.active is false then raise exception 'El proveedor "%" está pausado', v_s.name; end if;

  v_to := coalesce(nullif(trim(p_to), ''), nullif(trim(v_s.email), ''));
  if v_to is null then
    raise exception 'El proveedor "%" no tiene correo registrado. Agrégalo antes de enviar.', v_s.name;
  end if;

  v_biz := coalesce((select value from ts_settings where key = 'business'), '{}'::jsonb);
  v_cc  := coalesce(nullif(trim(p_cc), ''), nullif(trim(coalesce(v_biz->>'email','')), ''));

  select count(*), coalesce(string_agg(
      '<tr>'
      || '<td style="padding:7px 8px;border-bottom:1px solid #e6e6e6;color:#888;font:12px monospace">' || (select count(*) from ts_requisition_items j where j.requisition_id = i.requisition_id and j.id <= i.id) || '</td>'
      || '<td style="padding:7px 8px;border-bottom:1px solid #e6e6e6">' || ts_rfq_esc(i.description) || '</td>'
      || '<td style="padding:7px 8px;border-bottom:1px solid #e6e6e6;text-align:right;white-space:nowrap">'
      || trim(to_char(i.qty, 'FM999999990.99')) || '</td>'
      || '<td style="padding:7px 8px;border-bottom:1px solid #e6e6e6;border-left:1px dashed #ccc">&nbsp;</td>'
      || '</tr>', '' order by i.id), '')
    into v_count, v_rows
    from ts_requisition_items i where i.requisition_id = p_req;

  if v_count = 0 then raise exception 'La requisición no tiene partidas'; end if;

  v_dead  := current_date + greatest(coalesce(p_days, 5), 1);
  v_code  := 'SC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ts_rfq_seq')::text, 5, '0');
  v_subject := '[' || v_code || '] Solicitud de cotización · ' || v_r.code || ' · '
               || coalesce(nullif(v_biz->>'name',''), 'TechStore');

  v_body :=
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;color:#1a1a1a;line-height:1.5">'
    || '<p style="margin:0 0 4px;font:12px monospace;letter-spacing:.08em;color:#ff3300">'
    || ts_rfq_esc(v_code) || ' · ' || ts_rfq_esc(v_r.code) || '</p>'
    || '<h2 style="margin:0 0 14px;font-size:20px">Solicitud de cotización</h2>'
    || '<p style="margin:0 0 12px">Estimados <b>' || ts_rfq_esc(v_s.name) || '</b>,</p>'
    || '<p style="margin:0 0 14px">Solicitamos su cotización para el siguiente requerimiento. '
    || 'Por favor indique <b>precio unitario, total, tiempo de entrega y validez de la oferta</b>.</p>'
    || '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 14px">'
    || '<thead><tr style="background:#f5f5f5">'
    || '<th style="text-align:left;padding:7px 8px;border-bottom:2px solid #ddd;font:11px monospace;color:#666">#</th>'
    || '<th style="text-align:left;padding:7px 8px;border-bottom:2px solid #ddd;font:11px monospace;color:#666">DESCRIPCIÓN</th>'
    || '<th style="text-align:right;padding:7px 8px;border-bottom:2px solid #ddd;font:11px monospace;color:#666">CANT.</th>'
    || '<th style="text-align:left;padding:7px 8px;border-bottom:2px solid #ddd;border-left:1px dashed #ccc;font:11px monospace;color:#666">PRECIO UNIT. / TOTAL</th>'
    || '</tr></thead><tbody>' || v_rows || '</tbody></table>'
    || '<table style="font-size:13px;color:#444;margin:0 0 14px">'
    || '<tr><td style="padding:2px 10px 2px 0;color:#888">Referencia</td><td><b>' || ts_rfq_esc(v_r.code) || '</b> · ' || ts_rfq_esc(v_code) || '</td></tr>'
    || '<tr><td style="padding:2px 10px 2px 0;color:#888">Tipo</td><td>' || case when v_r.kind = 'servicio' then 'Contratación de servicio' else 'Compra de productos' end || '</td></tr>'
    || '<tr><td style="padding:2px 10px 2px 0;color:#888">Concepto</td><td>' || ts_rfq_esc(v_r.title) || '</td></tr>'
    || '<tr><td style="padding:2px 10px 2px 0;color:#888">Respuesta antes de</td><td><b>' || to_char(v_dead, 'DD/MM/YYYY') || '</b></td></tr>'
    || '</table>'
    || case when coalesce(trim(p_note), '') <> '' then
         '<div style="background:#fafafa;border-left:3px solid #ff3300;padding:10px 12px;margin:0 0 14px;font-size:14px">'
         || ts_rfq_esc(p_note) || '</div>' else '' end
    || '<p style="margin:0 0 14px;font-size:14px">Para dar seguimiento, responda este correo <b>manteniendo el código '
    || ts_rfq_esc(v_code) || ' en el asunto</b>.</p>'
    || '<p style="margin:0 0 4px;font-size:14px">Saludos,</p>'
    || '<p style="margin:0;font-size:14px"><b>' || ts_rfq_esc(coalesce(nullif(v_biz->>'name',''), 'TechStore')) || '</b>'
    || case when coalesce(v_biz->>'legal_name','') <> '' then '<br><span style="color:#666">' || ts_rfq_esc(v_biz->>'legal_name') || '</span>' else '' end
    || case when coalesce(v_biz->>'phone','') <> '' then '<br><span style="color:#666">Tel. ' || ts_rfq_esc(v_biz->>'phone') || '</span>' else '' end
    || case when coalesce(v_biz->>'nit','') <> '' then '<br><span style="color:#666">NIT ' || ts_rfq_esc(v_biz->>'nit') || '</span>' else '' end
    || '</p>'
    || '<hr style="border:0;border-top:1px solid #eee;margin:18px 0 8px">'
    || '<p style="margin:0;font:11px monospace;color:#999">' || ts_rfq_esc(v_code) || ' · ' || ts_rfq_esc(v_r.code)
    || ' · generado ' || to_char(now() at time zone 'America/El_Salvador', 'YYYY-MM-DD HH24:MI') || ' (SV)'
    || ' · documento trazable, no modificar el folio</p>'
    || '</div>';

  insert into ts_quote_requests (code, requisition_id, supplier_id, supplier_name, to_email, cc_email,
                                 subject, body_html, status, created_by)
  values (v_code, p_req, v_s.id, v_s.name, v_to, v_cc, v_subject, v_body, 'programada', auth.uid())
  returning * into v_row;

  insert into ts_requisition_events (requisition_id, from_status, to_status, note, user_id)
  values (p_req, v_r.status, v_r.status,
          'Solicitud de cotización ' || v_code || ' preparada para ' || v_s.name || ' <' || v_to || '>',
          auth.uid());

  return v_row;
end $$;

/* Marca la solicitud como enviada (la llama la Edge Function con service_role). */
create or replace function ts_rfq_sent(p_id uuid, p_message_id text, p_transport text)
returns ts_quote_requests
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_row ts_quote_requests; v_status ts_req_status;
begin
  update ts_quote_requests
     set status = 'enviada', sent_at = now(), provider_message_id = p_message_id,
         transport = p_transport, attempts = attempts + 1, last_error = null
   where id = p_id
  returning * into v_row;
  if not found then raise exception 'Solicitud de cotización no encontrada'; end if;

  select status into v_status from ts_requisitions where id = v_row.requisition_id;
  insert into ts_requisition_events (requisition_id, from_status, to_status, note, user_id)
  values (v_row.requisition_id, v_status, v_status,
          'Solicitud de cotización ' || v_row.code || ' enviada a ' || coalesce(v_row.supplier_name, 'proveedor')
          || ' <' || v_row.to_email || '>'
          || case when v_row.cc_email is not null then ' · copia a ' || v_row.cc_email else '' end
          || ' · vía ' || coalesce(p_transport, 'correo'),
          v_row.created_by);
  return v_row;
end $$;

/* Registra el fallo de envío con el motivo real del proveedor de correo. */
create or replace function ts_rfq_failed(p_id uuid, p_error text)
returns ts_quote_requests
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_row ts_quote_requests;
begin
  update ts_quote_requests
     set status = 'fallida', attempts = attempts + 1, last_error = left(p_error, 500)
   where id = p_id
  returning * into v_row;
  if not found then raise exception 'Solicitud de cotización no encontrada'; end if;
  return v_row;
end $$;

revoke all on function ts_rfq_esc(text) from public, anon, authenticated;
revoke all on function ts_rfq_create(uuid, uuid, text, text, text, integer) from public, anon;
grant execute on function ts_rfq_create(uuid, uuid, text, text, text, integer) to authenticated;
revoke all on function ts_rfq_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function ts_rfq_sent(uuid, text, text) to service_role;
revoke all on function ts_rfq_failed(uuid, text) from public, anon, authenticated;
grant execute on function ts_rfq_failed(uuid, text) to service_role;
