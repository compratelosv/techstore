/* quote-print.js — cotización imprimible (para enviar al cliente) */
import { sb, money, esc, toast, errMessage, getUser, fmtDate, loadCurrency } from './core.js?v=5214a642';

const host = document.getElementById('docHost');
const id = new URLSearchParams(location.search).get('id');

const STATUS_TEXT = {
  borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada',
  rechazada: 'Rechazada', vencida: 'Vencida', convertida: 'Convertida en pedido',
};

async function load() {
  const user = await getUser();
  if (!user) {
    location.replace('admin.html');
    return;
  }
  await loadCurrency();

  if (!id) {
    host.innerHTML = '<p style="text-align:center;padding:2rem">Falta la cotización.</p>';
    return;
  }

  const [{ data: q, error }, { data: items }, { data: settings }] = await Promise.all([
    sb.from('ts_quotes').select('*').eq('id', id).maybeSingle(),
    sb.from('ts_quote_items').select('*').eq('quote_id', id),
    sb.from('ts_settings').select('key, value').in('key', ['business', 'currency']),
  ]);

  if (error || !q) {
    host.innerHTML = `<p style="text-align:center;padding:2rem">${esc(error ? errMessage(error) : 'Cotización no encontrada')}</p>`;
    return;
  }

  const conf = {};
  (settings || []).forEach((r) => { conf[r.key] = r.value; });
  const biz = conf.business || {};
  const rows = items || [];
  const subtotal = rows.reduce((n, i) => n + Number(i.line_total), 0);

  document.title = `${q.code} · Cotización`;

  host.innerHTML = `
    <div class="doc">
      <div class="doc-head">
        <div>
          <h1>${esc(biz.name || 'TechStore SV')}</h1>
          <div class="muted" style="font-size:12px">
            ${biz.legal_name ? esc(biz.legal_name) + '<br>' : ''}
            ${biz.nit ? 'NIT: ' + esc(biz.nit) + '<br>' : ''}
            ${biz.phone ? 'Tel: ' + esc(biz.phone) + '<br>' : ''}
            ${biz.email ? esc(biz.email) + '<br>' : ''}
            ${biz.address ? esc(biz.address) : ''}
          </div>
        </div>
        <div class="doc-meta">
          <div style="font-size:16px;font-weight:800">COTIZACIÓN</div>
          <div>${esc(q.code)}</div>
          <div>${fmtDate(q.created_at)}</div>
          <div>Válida hasta: <b>${q.valid_until || '—'}</b></div>
          <div style="margin-top:4px;color:#666">${STATUS_TEXT[q.status] || q.status}</div>
        </div>
      </div>

      <div class="doc-grid">
        <div>
          <b>Cliente</b>
          ${esc(q.customer_name)}<br>
          ${q.customer_phone ? esc(q.customer_phone) + '<br>' : ''}
          ${q.customer_email ? esc(q.customer_email) + '<br>' : ''}
          ${q.customer_address ? esc(q.customer_address) : ''}
        </div>
        <div>
          <b>Condiciones</b>
          Validez: ${q.valid_until || '—'}<br>
          ${q.discount > 0 ? `Descuento: ${q.discount}%<br>` : ''}
          ${q.tax_rate > 0 ? `Impuesto: ${q.tax_rate}%<br>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Producto</th><th>SKU</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr>
        </thead>
        <tbody>
          ${rows.map((i) => `<tr>
            <td>${esc(i.name)}</td>
            <td style="color:#777">${esc(i.sku)}</td>
            <td class="num">${i.qty}</td>
            <td class="num">${money(i.unit_price)}</td>
            <td class="num">${money(i.line_total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="totals">
        <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
        ${q.discount > 0 ? `<div><span>Descuento ${q.discount}%</span><span>−${money(subtotal * q.discount / 100)}</span></div>` : ''}
        ${q.tax > 0 ? `<div><span>Impuesto</span><span>${money(q.tax)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money(q.total)}</span></div>
      </div>

      ${q.notes ? `<div class="notes"><b>Notas:</b><br>${esc(q.notes)}</div>` : ''}
      <div class="notes">
        Precios sujetos a disponibilidad. Cotización válida hasta la fecha indicada.
        ${biz.whatsapp ? `Consultas por WhatsApp: ${esc(biz.whatsapp)}.` : ''}
      </div>
    </div>`;
}

document.getElementById('printBtn').onclick = () => window.print();

load().catch((err) => toast(errMessage(err), 'err'));
