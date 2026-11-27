/* req-print.js — documento imprimible de la requisición */
import { sb, money, esc, errMessage } from './core.js?v=828d81de';

const STATUS = {
  borrador: 'Borrador', solicitada: 'Por aprobar', aprobada: 'Aprobada', rechazada: 'Rechazada',
  orden_emitida: 'Orden emitida', recibida: 'Recibida', facturada: 'Facturada',
  pagada: 'Pagada', cerrada: 'Cerrada', anulada: 'Anulada',
};

const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('t');

function fecha(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-SV', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function main() {
  if (!id) return pintar('<p>Falta el identificador de la requisición.</p>');

  const [req, biz] = await Promise.all([
    sb.from('ts_requisitions').select('*').eq('id', id).maybeSingle(),
    sb.from('ts_settings').select('value').eq('key', 'business').maybeSingle(),
  ]);

  if (req.error) return pintar(`<p>${esc(errMessage(req.error))}</p>`);
  if (!req.data) return pintar('<p>No se encontró la requisición (o no tienes permiso para verla).</p>');

  const r = req.data;
  const negocio = biz.data?.value || {};

  const [items, quotes, depts, sups, prof] = await Promise.all([
    sb.from('ts_requisition_items').select('*').eq('requisition_id', id),
    sb.from('ts_requisition_quotes').select('*').eq('requisition_id', id),
    sb.from('ts_departments').select('*'),
    sb.from('ts_suppliers').select('id,name,nit'),
    sb.from('ts_profiles').select('id,full_name,email').limit(50),
  ]);

  const dept = (depts.data || []).find((d) => d.id === r.department_id)?.name || '—';
  const sup = (sups.data || []).find((s) => s.id === r.supplier_id);
  const quien = (prof.data || []).find((p) => p.id === r.requested_by);
  const aprobo = (prof.data || []).find((p) => p.id === r.approved_by);

  document.title = `${r.code} · Requisición`;

  pintar(`
    <div class="head">
      <div>
        <h1>${esc(negocio.name || 'TechStore SV')}</h1>
        <div class="small">${esc(negocio.legal_name || '')}${negocio.nit ? ' · NIT ' + esc(negocio.nit) : ''}</div>
        <div class="small">${esc(negocio.address || '')}</div>
      </div>
      <div style="text-align:right">
        <div class="folio">${esc(r.code)}</div>
        <span class="estado">${esc(STATUS[r.status] || r.status)}</span>
        ${r.oc_code ? `<div class="small" style="margin-top:4px">Orden de compra <b>${esc(r.oc_code)}</b></div>` : ''}
      </div>
    </div>

    <div class="meta">
      <div><b>Fecha de solicitud</b>${fecha(r.created_at)}</div>
      <div><b>Tipo</b>${r.kind === 'servicio' ? 'Contratación de servicio' : 'Compra de productos'}</div>
      <div><b>Departamento solicitante</b>${esc(dept)}</div>
      <div><b>Solicitado por</b>${esc(quien?.full_name || quien?.email || '—')}</div>
      <div><b>Proveedor</b>${esc(sup?.name || 'Por definir')}${sup?.nit ? `<div class="small">NIT ${esc(sup.nit)}</div>` : ''}</div>
      <div><b>Concepto</b>${esc(r.title)}</div>
    </div>

    ${r.justification ? `<p style="font-size:.86rem"><b>Justificación:</b> ${esc(r.justification)}</p>` : ''}

    <table>
      <thead><tr><th>#</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${(items.data || []).map((i, n) => `<tr>
          <td>${n + 1}</td><td>${esc(i.description)}</td>
          <td class="num">${Number(i.qty)}</td><td class="num">${money(i.unit_price)}</td>
          <td class="num">${money(i.line_total)}</td></tr>`).join('')}
      </tbody>
    </table>

    <div class="totales">
      <div><span>Subtotal</span><b>${money(r.subtotal)}</b></div>
      <div><span>IVA</span><b>${money(r.tax)}</b></div>
      ${Number(r.retention) > 0 ? `<div><span>Retención</span><b>− ${money(r.retention)}</b></div>` : ''}
      <div class="grand"><span>Total</span><b>${money(r.total)}</b></div>
    </div>

    ${(quotes.data || []).length ? `
      <h2 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;margin:26px 0 6px;color:#64748b">Cotizaciones consideradas</h2>
      <table><thead><tr><th>Proveedor</th><th class="num">Monto</th><th class="num">Plazo</th></tr></thead>
      <tbody>${quotes.data.map((q) => `<tr><td>${esc(q.supplier_name || '—')}${q.chosen ? ' ✓ elegida' : ''}</td>
        <td class="num">${money(q.amount)}</td><td class="num">${q.lead_days ? q.lead_days + ' días' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}

    ${r.invoice_number ? `<p style="font-size:.84rem;margin-top:18px"><b>Factura:</b> ${esc(r.invoice_number)} · ${fecha(r.invoiced_at)}
      ${r.paid_at ? `<br><b>Pagado:</b> ${fecha(r.paid_at)} · ${esc(r.payment_method || '')} ${esc(r.payment_ref || '')}` : ''}</p>` : ''}

    <div class="firmas">
      <div class="firma">
        <b>${esc(quien?.full_name || quien?.email || 'Solicitante')}</b>
        Solicitó · ${fecha(r.created_at)}
      </div>
      <div class="firma">
        <b>${esc(aprobo?.full_name || aprobo?.email || 'Dirección general')}</b>
        ${r.approved_at ? `Aprobó · ${fecha(r.approved_at)}` : 'Pendiente de aprobación'}
      </div>
    </div>

    ${r.approval_hash ? `<p class="sello" style="margin-top:18px">Sello de aprobación: ${esc(r.approval_hash)}</p>` : ''}
    <p class="small" style="margin-top:18px">Documento generado por el sistema · ${esc(r.code)} · ${fecha(new Date().toISOString())}</p>
  `);
}

function pintar(html) {
  $('#doc').innerHTML = html;
}

main().catch((e) => pintar(`<p>Error al cargar: ${esc(e.message)}</p>`));
