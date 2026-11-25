/* sticker.js — etiqueta imprimible del pedido (QR + SKUs) */
import { sb, esc, toast, errMessage, getUser, fmtDate } from './core.js?v=454f869e';

const host = document.getElementById('labelHost');
const id = new URLSearchParams(location.search).get('id');

function drawQR(canvas, text, px = 208) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const quiet = 2;
  const modules = qr.getModuleCount() + quiet * 2;
  const scale = Math.max(2, Math.floor(px / modules));
  const size = modules * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < qr.getModuleCount(); r++) {
    for (let c = 0; c < qr.getModuleCount(); c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }
}

async function load() {
  const user = await getUser();
  if (!user) {
    location.replace('admin.html');
    return;
  }
  if (!id) {
    host.innerHTML = '<p class="hint">Falta el pedido.</p>';
    return;
  }

  const { data: o, error } = await sb
    .from('ts_orders')
    .select('*, ts_order_items(*)')
    .eq('id', id)
    .maybeSingle();

  if (error || !o) {
    host.innerHTML = `<p class="hint">${esc(error ? errMessage(error) : 'Pedido no encontrado')}</p>`;
    return;
  }

  const items = o.ts_order_items || [];
  host.innerHTML = `
    <div class="label">
      <canvas id="qr"></canvas>
      <div>
        <p class="code">${esc(o.code)}</p>
        <div class="meta">${esc(o.customer_name)}</div>
        <div class="sub">${o.fulfillment === 'retiro' ? 'RETIRO EN TIENDA' : `ENVÍO · ${esc(o.ship_city || '')}`}</div>
        <div class="sub">${fmtDate(o.created_at)} · ${o.channel === 'pos' ? 'POS' : 'ONLINE'}</div>
        <div class="items">
          ${items.map((i) => `<div><span>${esc(i.sku)} · ${esc(i.name)}</span><span class="q">×${i.qty}</span></div>`).join('')}
        </div>
        <div class="foot">
          <span>TechStore SV</span>
          <span>${items.reduce((n, i) => n + i.qty, 0)} pza(s)</span>
        </div>
      </div>
    </div>`;

  drawQR(document.getElementById('qr'), o.code, 208);
  document.title = `Etiqueta ${o.code}`;
}

document.getElementById('printBtn').onclick = () => window.print();

load().catch((err) => toast(errMessage(err), 'err'));
