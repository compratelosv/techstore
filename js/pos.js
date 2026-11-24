/* pos.js — punto de venta tipo caja de supermercado.
 *
 * Flujo real: el cliente pone los productos en el mostrador, se escanea el
 * código de barras con la cámara del teléfono y cada lectura suma una unidad al
 * ticket. También acepta código escrito a mano (lector USB) y toque manual.
 *
 * El cobro usa las mismas funciones que la tienda: ts_place_order (canal 'pos')
 * y ts_confirm_payment, que es la única que descuenta stock.
 */
import { Scanner } from './scanner.js?v=90ef2e67';

let booted = false;
let api = null;
let products = [];
let cart = []; // [{id, sku, barcode, name, price, qty, stock}]
let scanner = null;

const $ = (s) => document.querySelector(s);

export function initPos(deps) {
  api = deps;
  if (booted) {
    loadProducts();
    return;
  }
  booted = true;

  $('#posSearch').addEventListener('input', renderProducts);
  $('#posProducts').addEventListener('click', (e) => {
    const t = e.target.closest('[data-pos-add]');
    if (t) addById(t.dataset.posAdd);
  });

  $('#posLines').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const del = e.target.closest('[data-del]');
    if (inc) changeQty(inc.dataset.inc, +1);
    else if (dec) changeQty(dec.dataset.dec, -1);
    else if (del) {
      cart = cart.filter((i) => i.id !== del.dataset.del);
      renderCart();
    }
  });

  $('#posScanBtn').addEventListener('click', openScan);
  $('#scanClose').addEventListener('click', closeScan);
  $('#posPhotoBtn').addEventListener('click', () => $('#posPhotoInput').click());
  $('#posPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await scanFromFile(file);
  });
  $('#posCodeAdd').addEventListener('click', addFromInput);
  $('#posCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  });
  $('#posClear').addEventListener('click', () => {
    cart = [];
    renderCart();
  });
  $('#posCharge').addEventListener('click', charge);

  loadProducts();
}

/* ---------------- datos ---------------- */
async function loadProducts() {
  const { data, error } = await api.sb
    .from('ts_products')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) return api.toast(api.errMessage(error), 'err');
  products = data || [];
  renderProducts();
  renderCart();
}

/* ---------------- cámara ---------------- */
async function openScan() {
  const overlay = $('#scanOverlay');
  overlay.classList.remove('hidden');
  feedback('Enfoca el código…', '');

  if (!window.isSecureContext && location.hostname !== 'localhost') {
    feedback('La cámara necesita HTTPS. Abre el panel desde su dirección https://', 'miss');
    return;
  }

  try {
    scanner = new Scanner({
      video: $('#posVideo'),
      cooldownMs: 1200, // permite volver a escanear el mismo producto
      onDetect: ({ value }) => handleScanned(value),
      onStatus: (msg) => feedback(msg, ''),
    });
    await scanner.start('environment');
    $('#scanCount').textContent = `${cartCount()} artículos · ${api.money(total())}`;
  } catch (err) {
    feedback(err.message || 'No se pudo abrir la cámara', 'miss');
    api.toast(err.message || 'No se pudo abrir la cámara', 'err');
  }
}

function closeScan() {
  scanner?.stop();
  scanner = null;
  $('#scanOverlay').classList.add('hidden');
}

/** Lee un código desde una imagen (foto o captura) y lo agrega al ticket. */
async function scanFromFile(file) {
  try {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const engine = scanner || new Scanner({ video: document.createElement('video'), onDetect: () => {} });
    const res = await engine.decodeImageElement(img);
    URL.revokeObjectURL(img.src);
    handleScanned(res.value);
  } catch (err) {
    api.toast('No se encontró un código legible en esa imagen', 'err');
  }
}

function feedback(text, kind = '') {
  const el = $('#scanFeedback');
  if (!el) return;
  el.textContent = text;
  el.className = `scan-bottom ${kind}`.trim();
}

function beep(ok = true) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = ok ? 1180 : 260;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.07 : 0.16));
    setTimeout(() => ctx.close(), 400);
  } catch { /* sin audio */ }
}

function handleScanned(raw) {
  const code = String(raw || '').trim();
  if (!code) return;

  const result = addByCode(code);
  if (result.ok) {
    beep(true);
    if (navigator.vibrate) navigator.vibrate(35);
    feedback(`✓ ${result.product.name} ×${result.qty}`, 'hit');
  } else {
    beep(false);
    feedback(result.reason, 'miss');
  }
  const count = $('#scanCount');
  if (count) count.textContent = `${cartCount()} artículos · ${api.money(total())}`;
}

/* ---------------- ticket ---------------- */
function normalize(code) {
  return String(code ?? '').trim().toUpperCase();
}

/** Busca por código de barras o SKU y suma una unidad. */
export function addByCode(code) {
  const key = normalize(code);
  const product =
    products.find((p) => normalize(p.barcode) === key) ||
    products.find((p) => normalize(p.sku) === key);

  if (!product) {
    return { ok: false, reason: `Código ${key} no está en el catálogo` };
  }
  if (product.stock === 0) {
    return { ok: false, reason: `${product.name} está agotado` };
  }

  const found = cart.find((c) => c.id === product.id);
  const nextQty = (found?.qty || 0) + 1;
  if (nextQty > product.stock) {
    return { ok: false, reason: `Solo hay ${product.stock} de ${product.name}` };
  }

  if (found) found.qty = nextQty;
  else
    cart.push({
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      price: Number(product.price),
      qty: 1,
      stock: product.stock,
    });

  renderCart();
  return { ok: true, product, qty: nextQty };
}

function addById(id) {
  const p = products.find((x) => x.id === id);
  if (p) handleScanned(p.barcode || p.sku);
}

function addFromInput() {
  const input = $('#posCodeInput');
  const code = input.value.trim();
  if (!code) return;
  const res = addByCode(code);
  if (!res.ok) api.toast(res.reason, 'err');
  else api.toast(`Agregado: ${res.product.name} ×${res.qty}`);
  input.value = '';
  input.focus();
}

function changeQty(id, delta) {
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  const next = item.qty + delta;
  if (next <= 0) {
    cart = cart.filter((i) => i.id !== id);
  } else if (next > item.stock) {
    api.toast(`Solo hay ${item.stock} de ${item.name}`, 'err');
    return;
  } else {
    item.qty = next;
  }
  renderCart();
}

function cartCount() {
  return cart.reduce((n, i) => n + i.qty, 0);
}

function total() {
  return cart.reduce((n, i) => n + i.price * i.qty, 0);
}

function renderCart() {
  $('#posLines').innerHTML = cart
    .map(
      (i) => `
      <div class="ticket-line">
        <div>
          <div class="tl-name">${api.esc(i.name)}</div>
          <div class="tl-sub">${api.esc(i.barcode || i.sku)} · ${api.money(i.price)} c/u</div>
        </div>
        <div class="tl-right">
          <div class="qty-box">
            <button data-dec="${i.id}" aria-label="Restar">−</button>
            <span>${i.qty}</span>
            <button data-inc="${i.id}" aria-label="Sumar">+</button>
          </div>
          <div class="amount">${api.money(i.price * i.qty)}</div>
          <button class="btn ghost sm" data-del="${i.id}" title="Quitar">✕</button>
        </div>
      </div>`
    )
    .join('');
  $('#posEmpty').hidden = cart.length > 0;
  $('#posTotal').textContent = api.money(total());
  $('#posCharge').disabled = cart.length === 0;
  $('#posCharge').textContent = cart.length
    ? `Cobrar ${api.money(total())}`
    : 'Cobrar y generar pedido';
  const count = $('#scanCount');
  if (count) count.textContent = `${cartCount()} artículos · ${api.money(total())}`;
}

function renderProducts() {
  const q = ($('#posSearch').value || '').trim().toLowerCase();
  const list = products.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q)
  );
  $('#posProducts').innerHTML =
    list
      .map(
        (p) => `
      <button class="pos-tile" data-pos-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
        <div class="n">${api.esc(p.name)}</div>
        <div class="p">${api.money(p.price)}</div>
        <div class="s">${p.stock === 0 ? 'Agotado' : `Stock ${p.stock}`}</div>
      </button>`
      )
      .join('') || '<p class="small muted">Sin resultados.</p>';
}

/* ---------------- cobro ---------------- */
async function charge() {
  if (!cart.length) return;
  const btn = $('#posCharge');
  btn.disabled = true;
  btn.textContent = 'Cobrando…';

  const customerName = ($('#posName').value || '').trim() || 'Consumidor final';
  const method = $('#posMethod').value;

  const { data: order, error } = await api.sb.rpc('ts_place_order', {
    p_items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
    p_fulfillment: 'retiro',
    p_customer: { name: customerName, email: null, phone: null },
    p_shipping: {},
    p_channel: 'pos',
  });

  if (error) {
    api.toast(api.errMessage(error), 'err');
    btn.disabled = false;
    renderCart();
    return;
  }

  const { error: payErr } = await api.sb.rpc('ts_confirm_payment', {
    p_order_id: order.id,
    p_provider: method === 'efectivo' ? 'efectivo' : method,
    p_reference: `POS-${Date.now()}`,
  });

  if (payErr) {
    api.toast(`Pedido ${order.code} creado pero el cobro falló: ${api.errMessage(payErr)}`, 'err');
    btn.disabled = false;
    renderCart();
    return;
  }

  api.toast(`Venta ${order.code} cobrada · ${api.money(order.total)}`);
  cart = [];
  $('#posName').value = '';
  await loadProducts();
  renderCart();
  document.dispatchEvent(new CustomEvent('pos:sale', { detail: order }));
}
