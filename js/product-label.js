/* product-label.js — etiqueta de anaquel con EAN-13 escaneable */
import { sb, money, esc, toast, errMessage, getUser } from './core.js?v=828d81de';

const host = document.getElementById('labelHost');
const sku = new URLSearchParams(location.search).get('sku');

async function load() {
  const user = await getUser();
  if (!user) {
    location.replace('admin.html');
    return;
  }
  if (!sku) {
    host.innerHTML = '<p class="hint">Falta el SKU del producto.</p>';
    return;
  }

  const { data: p, error } = await sb
    .from('ts_products')
    .select('*')
    .eq('sku', sku)
    .maybeSingle();

  if (error || !p) {
    host.innerHTML = `<p class="hint">${esc(error ? errMessage(error) : 'Producto no encontrado')}</p>`;
    return;
  }

  document.title = `Etiqueta ${p.sku}`;
  host.innerHTML = `
    <div class="plabel">
      <div class="brandline-pl">${esc(p.brand || 'TechStore SV')}</div>
      <div class="pname">${esc(p.name)}</div>
      <div class="psub">${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</div>
      <div class="pprice">${money(p.price)}</div>
      <canvas id="bars"></canvas>
      <div class="pcode">${esc(p.barcode || p.sku)}</div>
    </div>`;

  const canvas = document.getElementById('bars');
  try {
    window.JsBarcode(canvas, p.barcode || p.sku, {
      format: /^\d{13}$/.test(p.barcode || '') ? 'EAN13' : 'CODE128',
      width: 3,
      height: 80,
      displayValue: false,
      margin: 10,
      lineColor: '#000000',
      background: '#ffffff',
    });
  } catch (err) {
    host.querySelector('.plabel').insertAdjacentHTML(
      'beforeend',
      `<p class="pcode" style="color:#b91c1c">No se pudo generar el código: ${esc(err.message)}</p>`
    );
  }
}

document.getElementById('printBtn').onclick = () => window.print();

load().catch((err) => toast(errMessage(err), 'err'));
