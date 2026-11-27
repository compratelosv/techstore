/* ticket.js — ticket de 80 mm del documento emitido en caja */
import { sb, money, esc, errMessage } from './core.js?v=828d81de';

const el = document.getElementById('ticket');
const docId = new URLSearchParams(location.search).get('d');

const TIPO = {
  ccf: 'COMPROBANTE DE CRÉDITO FISCAL',
  factura: 'FACTURA',
  nota_credito: 'NOTA DE CRÉDITO',
};

const PAGO = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
};

function fecha(ts) {
  return new Date(ts).toLocaleString('es-SV', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function main() {
  if (!docId) return pintar('<p class="s c">Falta el documento.</p>');

  const { data: doc, error } = await sb.from('ts_pos_docs').select('*').eq('id', docId).maybeSingle();
  if (error) return pintar(`<p class="s c">${esc(errMessage(error))}</p>`);
  if (!doc) return pintar('<p class="s c">No se encontró el documento (o no tienes permiso).</p>');

  const em = doc.issuer || {};
  const rec = doc.receiver || {};
  const items = doc.items || [];
  const esCcf = doc.doc_type === 'ccf';

  document.title = `${doc.series}-${String(doc.number).padStart(8, '0')} · TechStore SV`;

  pintar(`
    <div class="c">
      <div class="b" style="font-size:13px">${esc(em.name || 'TechStore SV')}</div>
      ${em.legal_name ? `<div class="xs">${esc(em.legal_name)}</div>` : ''}
      ${em.nit ? `<div class="xs">NIT: ${esc(em.nit)}</div>` : ''}
      ${em.nrc ? `<div class="xs">NRC: ${esc(em.nrc)}</div>` : ''}
      ${em.address ? `<div class="xs">${esc(em.address)}</div>` : ''}
      ${em.phone ? `<div class="xs">Tel. ${esc(em.phone)}</div>` : ''}
    </div>

    <hr>

    <div class="c b s">${esc(TIPO[doc.doc_type] || doc.doc_type)}</div>
    <div class="c xs">
      ${esc(doc.series)}-${String(doc.number).padStart(8, '0')}<br>
      N.º de control: ${esc(doc.control_code)}<br>
      Código de generación:<br><span class="mono-sm">${esc(doc.generation_code)}</span>
    </div>

    <div class="warn">
      DOCUMENTO DE CONTROL INTERNO<br>
      NO VÁLIDO FISCALMENTE
    </div>

    <div class="row xs"><span>${fecha(doc.issued_at)}</span><span>${doc.status === 'emitido' ? '' : 'ANULADO'}</span></div>

    <hr>

    ${esCcf ? `
      <div class="xs"><b>Cliente:</b> ${esc(rec.name || '')}</div>
      <div class="xs"><b>NIT:</b> ${esc(rec.nit || '—')}${rec.nrc ? `  <b>NRC:</b> ${esc(rec.nrc)}` : ''}</div>
      ${rec.address ? `<div class="xs"><b>Dirección:</b> ${esc(rec.address)}</div>` : ''}
    ` : `
      <div class="xs"><b>Cliente:</b> ${esc(rec.name || 'Consumidor final')}</div>
    `}

    <hr>

    ${items.map((i) => `
      <div class="line">
        <span class="qty">${Number(i.qty)}x</span>${esc(i.name)}
        <span class="amt">${money(i.line_total)}</span>
        <div class="xs" style="color:#666">${esc(i.sku || '')} · ${money(i.unit_price)} c/u</div>
      </div>`).join('')}

    <hr>

    <div class="row"><span>Subtotal</span><span>${money(doc.subtotal ?? doc.gravada + doc.iva)}</span></div>
    ${Number(doc.discount) > 0 ? `<div class="row"><span>Descuento${doc.promo_code ? ' ' + esc(doc.promo_code) : ''}</span><span>−${money(doc.discount)}</span></div>` : ''}
    <div class="row"><span>Gravada</span><span>${money(doc.gravada)}</span></div>
    <div class="row"><span>IVA ${Number(em.iva_pct || 13)}%</span><span>${money(doc.iva)}</span></div>
    ${Number(doc.exenta) > 0 ? `<div class="row"><span>Exenta</span><span>${money(doc.exenta)}</span></div>` : ''}
    <div class="row tot"><span>TOTAL</span><span>${money(doc.total)}</span></div>

    <div class="xs c" style="margin-top:4px">${esc(doc.total_letters || '')}</div>

    <hr>

    <div class="row xs"><span>Pago</span><span>${esc(PAGO[doc.payment_method] || doc.payment_method || '—')}</span></div>
    ${doc.card_auth ? `<div class="row xs"><span>Autorización</span><span>${esc(doc.card_auth)}</span></div>` : ''}
    ${doc.card_last4 ? `<div class="row xs"><span>Tarjeta</span><span>****${esc(doc.card_last4)}</span></div>` : ''}

    <hr>
    <div class="c xs">Gracias por tu compra</div>
    <div class="c xs" style="margin-top:3px">${esc(em.phone || '')}</div>
  `);
}

function pintar(html) {
  el.innerHTML = html;
}

main().catch((e) => pintar(`<p class="s c">Error: ${esc(e.message)}</p>`));
