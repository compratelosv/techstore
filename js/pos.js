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
let pendingScan = null; // resolve() de scanOnce(): lectura suelta para un formulario
let pendingStream = null; // lectura continua: { onCode, resolve }
let customer = null; // cliente de mostrador elegido
let promo = null; // { code, discount, label }

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

  // documento, cliente, cupón y tarjeta
  document.getElementById('posDocType')?.addEventListener('change', syncDocFields);
  document.getElementById('posMethod')?.addEventListener('change', syncPayFields);
  document.getElementById('posCustomerFind')?.addEventListener('click', findCustomer);
  document.getElementById('posCustomerSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findCustomer(); }
  });
  document.getElementById('posCustomerNew')?.addEventListener('click', newCustomer);
  document.getElementById('posPromoApply')?.addEventListener('click', applyPromo);
  document.getElementById('posPromoClear')?.addEventListener('click', clearPromo);
  document.getElementById('posPromo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyPromo(); }
  });

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
    const raw = String(err?.message || '');
    const msg = /permission|denied|notallowed|not allowed/i.test(raw)
      ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador y vuelve a intentar.'
      : (raw || 'No se pudo abrir la cámara');
    feedback(msg, 'miss');
    api.toast(msg, 'err');
  }
}

function closeScan() {
  scanner?.stop();
  scanner = null;
  $('#scanOverlay').classList.add('hidden');
  if (pendingScan) {
    const resolve = pendingScan;
    pendingScan = null;
    resolve(null);
  }
  if (pendingStream) {
    const p = pendingStream;
    pendingStream = null;
    p.resolve(true);
  }
}

/** Mensaje en la barra del visor (para quien usa la lectura continua). */
export function scanFeedback(text, kind = '') {
  feedback(text, kind);
}

/**
 * Lectura continua: abre la cámara y llama onCode por cada código leído
 * sin cerrar el visor (el repartidor escanea varios bultos seguidos).
 * Resuelve cuando se cierra el visor.
 */
export async function scanStream({ title = 'Escanea el código', onCode } = {}) {
  if (pendingScan || pendingStream) return null;
  const done = new Promise((resolve) => { pendingStream = { onCode, resolve }; });
  await openScan();
  feedback(title, '');
  return done;
}

/** Cierra el visor de lectura continua. */
export function stopScan() {
  closeScan();
}

/**
 * Lee un solo código para usarlo en un formulario (alta de producto, búsqueda…).
 * Devuelve { value, format } o null si se cancela.
 */
export async function scanOnce({ title = 'Escanea el código del producto' } = {}) {
  if (pendingScan) return null; // ya hay una lectura en curso
  const done = new Promise((resolve) => { pendingScan = resolve; });
  await openScan();
  feedback(title, '');
  const value = await done;
  return value ? { value } : null;
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

  // Lectura continua (repartidor verificando bultos): no cierra el visor.
  if (pendingStream) {
    beep(true);
    if (navigator.vibrate) navigator.vibrate(30);
    const handler = pendingStream.onCode;
    try { handler?.(code); } catch { /* el handler avisa por su cuenta */ }
    return;
  }

  // Lectura suelta para un formulario: se devuelve y se cierra el visor.
  if (pendingScan) {
    const resolve = pendingScan;
    pendingScan = null;
    beep(true);
    if (navigator.vibrate) navigator.vibrate(35);
    scanner?.stop();
    scanner = null;
    $('#scanOverlay').classList.add('hidden');
    resolve(code);
    return;
  }

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

function discountAmount() {
  if (!promo) return 0;
  // promo.discount ya viene como MONTO calculado por el servidor (ts_promo_eval),
  // el mismo que aplica ts_place_order al cobrar: nunca se recalcula aquí.
  return Math.min(total(), Number(promo.discount) || 0);
}

function finalTotal() {
  return Math.max(0, Math.round((total() - discountAmount()) * 100) / 100);
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
  $('#posTotal').textContent = api.money(finalTotal());

  const dline = document.getElementById('posDiscountLine');
  if (dline) {
    const d = discountAmount();
    dline.hidden = d <= 0;
    if (d > 0) {
      dline.innerHTML = `Descuento <b>${api.esc(promo.code)}</b>: −${api.money(d)}
        <span class="muted">(antes ${api.money(total())})</span>`;
    }
  }

  $('#posCharge').disabled = cart.length === 0;
  $('#posCharge').textContent = cart.length
    ? `Cobrar ${api.money(finalTotal())}`
    : 'Cobrar, emitir e imprimir';
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
  const docType = document.getElementById('posDocType')?.value || 'factura';
  const method = $('#posMethod').value;

  // ---- receptor fiscal ----
  let receiver = { doc_type: 'factura', name: customer?.name || 'Consumidor final', nit: '', nrc: '', address: '' };
  if (docType === 'ccf') {
    const nit = (document.getElementById('posNit')?.value || '').trim();
    const name = (document.getElementById('posFiscalName')?.value || customer?.name || '').trim();
    if (!nit) return api.toast('Para el CCF escribe el NIT del cliente', 'err');
    if (!name) return api.toast('Para el CCF escribe el nombre o razón social', 'err');
    if (!/^\d{4}-\d{6}-\d{3}-\d{1}$/.test(nit)) {
      return api.toast('El NIT debe verse así: 0614-123456-101-1', 'err');
    }
    receiver = {
      doc_type: 'ccf', name, nit,
      nrc: (document.getElementById('posNrc')?.value || '').trim(),
      address: (document.getElementById('posFiscalAddr')?.value || '').trim(),
    };
  }

  // ---- tarjeta: voucher obligatorio ----
  let auth = '';
  let last4 = '';
  if (method === 'tarjeta') {
    auth = (document.getElementById('posCardAuth')?.value || '').trim();
    last4 = (document.getElementById('posCardLast4')?.value || '').trim();
    if (!auth) return api.toast('Anota el número de autorización del voucher', 'err');
    if (last4 && !/^\d{4}$/.test(last4)) return api.toast('Los últimos 4 deben ser 4 dígitos', 'err');
  }

  btn.disabled = true;
  btn.textContent = 'Cobrando…';

  // Sin caja abierta no se puede cobrar: el efectivo no se podría arquear.
  const { data: cash, error: cashErr } = await api.sb.rpc('ts_cash_current');
  if (cashErr || !cash) {
    api.toast(cashErr ? api.errMessage(cashErr) : 'Abre la caja antes de cobrar (menú Caja)', 'err');
    btn.disabled = false;
    renderCart();
    return;
  }

  const { data: order, error } = await api.sb.rpc('ts_place_order', {
    p_items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
    p_fulfillment: 'retiro',
    p_customer: {
      name: receiver.name,
      email: customer?.email || null,
      phone: customer?.phone || null,
      nit: receiver.nit || null,
      nrc: receiver.nrc || null,
      address: receiver.address || null,
    },
    p_shipping: {},
    p_channel: 'pos',
    p_promo: promo?.code || null,
  });

  if (error) {
    api.toast(api.errMessage(error), 'err');
    btn.disabled = false;
    renderCart();
    return;
  }

  const reference = method === 'tarjeta'
    ? `POS-${auth}${last4 ? '-' + last4 : ''}`
    : `POS-${Date.now()}`;

  const { error: payErr } = await api.sb.rpc('ts_confirm_payment', {
    p_order_id: order.id,
    p_provider: method,
    p_reference: reference,
  });

  if (payErr) {
    api.toast(`Pedido ${order.code} creado pero el cobro falló: ${api.errMessage(payErr)}`, 'err');
    btn.disabled = false;
    renderCart();
    return;
  }

  // ---- documento (control interno, no fiscal todavía) ----
  let docId = null;
  const { data: doc, error: docErr } = await api.sb.rpc('ts_pos_issue_doc', {
    p_order_id: order.id,
    p_doc_type: docType,
    p_receiver: receiver,
    p_payment: { method, auth: auth || null, last4: last4 || null },
    p_total_letters: numeroLetras(order.total),
  });
  if (docErr) {
    api.toast(`Cobro hecho, pero el documento falló: ${api.errMessage(docErr)}`, 'err');
  } else {
    docId = doc.id;
  }

  api.toast(`Venta ${order.code} cobrada · ${api.money(order.total)}`);
  const usedPromo = promo?.code;
  cart = [];
  promo = null;
  customer = null;
  resetPosFields();
  await loadProducts();
  renderCart();
  document.dispatchEvent(new CustomEvent('pos:sale', { detail: order, promo: usedPromo }));
  if (docId) window.open(`ticket.html?d=${docId}`, '_blank', 'noopener');
}

/* ============ cliente de mostrador, cupón y documento ============ */

function syncDocFields() {
  const tipo = document.getElementById('posDocType')?.value;
  const box = document.getElementById('posCcfFields');
  if (box) box.hidden = tipo !== 'ccf';
}

function syncPayFields() {
  const method = document.getElementById('posMethod')?.value;
  const box = document.getElementById('posCardFields');
  if (box) box.hidden = method !== 'tarjeta';
}

function pickCustomer(c) {
  customer = c;
  const hint = document.getElementById('posCustomerHint');
  if (hint) {
    hint.innerHTML = `<b>${api.esc(c.name)}</b>${c.nit ? ' · NIT ' + api.esc(c.nit) : ''}${c.phone ? ' · ' + api.esc(c.phone) : ''}
      <button class="btn sm ghost" type="button" id="posCustomerClear" style="margin-left:.4rem">quitar</button>`;
    document.getElementById('posCustomerClear').onclick = () => {
      customer = null;
      hint.textContent = 'Consumidor final';
      document.getElementById('posCustomerSearch').value = '';
      document.getElementById('posCustomerResults')?.remove();
    };
  }
  if (c.nit) document.getElementById('posNit').value = c.nit;
  if (c.nrc) document.getElementById('posNrc').value = c.nrc;
  if (c.address) document.getElementById('posFiscalAddr').value = c.address;
  if (document.getElementById('posFiscalName')) document.getElementById('posFiscalName').value = c.name;
  if (c.default_doc && document.getElementById('posDocType')) {
    document.getElementById('posDocType').value = c.default_doc;
    syncDocFields();
  }
  document.getElementById('posCustomerResults')?.remove();
}

async function findCustomer() {
  const input = document.getElementById('posCustomerSearch');
  const q = (input?.value || '').trim();
  if (!q) return api.toast('Escribe telefono, NIT, correo o nombre', 'err');

  const { data, error } = await api.sb.rpc('ts_pos_customer_find', { p_q: q });
  if (error) return api.toast(api.errMessage(error), 'err');
  const list = data || [];
  if (!list.length) return api.toast('No hay cliente con ese dato. Usa "Nuevo".', 'err');
  if (list.length === 1) return pickCustomer(list[0]);

  document.getElementById('posCustomerResults')?.remove();
  const box = document.createElement('div');
  box.id = 'posCustomerResults';
  box.style.cssText = 'margin:.4rem 0;display:flex;flex-direction:column;gap:.3rem';
  box.innerHTML = list.map((c) => `
    <button type="button" class="btn sm ghost" data-pick="${c.id}" style="justify-content:flex-start;text-align:left">
      ${api.esc(c.name)}${c.nit ? ' · ' + api.esc(c.nit) : ''}${c.phone ? ' · ' + api.esc(c.phone) : ''}
    </button>`).join('');
  document.getElementById('posCustomerHint').after(box);
  box.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    pickCustomer(list.find((x) => x.id === b.dataset.pick));
  };
}

function newCustomer() {
  document.getElementById('posNewCustomer')?.remove();
  const box = document.createElement('div');
  box.id = 'posNewCustomer';
  box.className = 'panel';
  box.style.cssText = 'margin-top:.6rem';
  box.innerHTML = `
    <h3 style="margin-top:0">Cliente nuevo</h3>
    <div class="field"><label>Nombre o razon social *</label><input id="ncName" placeholder="Ana Perez"></div>
    <div class="row" style="gap:.4rem">
      <div class="field" style="flex:1"><label>Telefono</label><input id="ncPhone" inputmode="tel" placeholder="7777 1234"></div>
      <div class="field" style="flex:1"><label>Correo</label><input id="ncEmail" placeholder="ana@correo.com"></div>
    </div>
    <div class="row" style="gap:.4rem">
      <div class="field" style="flex:1"><label>NIT</label><input id="ncNit" placeholder="0614-123456-101-1"></div>
      <div class="field" style="flex:1"><label>NRC</label><input id="ncNrc" placeholder="123456-7"></div>
    </div>
    <div class="field"><label>Direccion</label><input id="ncAddr" placeholder="San Salvador, Col. Escalon"></div>
    <div class="row" style="gap:.4rem">
      <button class="btn primary sm" id="ncSave">Guardar cliente</button>
      <button class="btn ghost sm" id="ncCancel">Cancelar</button>
    </div>`;
  document.getElementById('posCustomerHint').after(box);

  document.getElementById('ncCancel').onclick = () => box.remove();
  document.getElementById('ncSave').onclick = async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('ncName').value.trim();
    if (!name) return api.toast('El cliente necesita nombre', 'err');
    const nit = document.getElementById('ncNit').value.trim();
    if (nit && !/^\d{4}-\d{6}-\d{3}-\d{1}$/.test(nit)) {
      return api.toast('El NIT debe verse asi: 0614-123456-101-1', 'err');
    }
    btn.disabled = true;
    const { data, error } = await api.sb.rpc('ts_pos_customer_save', {
      p: {
        name, phone: document.getElementById('ncPhone').value.trim(),
        email: document.getElementById('ncEmail').value.trim(), nit,
        nrc: document.getElementById('ncNrc').value.trim(),
        address: document.getElementById('ncAddr').value.trim(),
        default_doc: nit ? 'ccf' : 'factura',
      },
    });
    btn.disabled = false;
    if (error) return api.toast(api.errMessage(error), 'err');
    box.remove();
    pickCustomer(data);
    api.toast('Cliente guardado');
  };
}

async function applyPromo() {
  const code = (document.getElementById('posPromo')?.value || '').trim();
  const hint = document.getElementById('posPromoHint');
  if (!code) return api.toast('Escribe el codigo del cupon', 'err');
  if (!cart.length) return api.toast('Agrega productos antes del cupon', 'err');

  const items = cart.map((i) => ({ product_id: i.id, qty: i.qty, total: Number(i.price) * i.qty }));
  const { data, error } = await api.sb.rpc('ts_promo_check', { p_code: code, p_items: items });
  if (error) { if (hint) hint.textContent = ''; return api.toast(api.errMessage(error), 'err'); }
  if (!data?.ok) {
    promo = null;
    if (hint) hint.textContent = '';
    document.getElementById('posPromoClear').hidden = true;
    renderCart();
    return api.toast(data?.message || 'Ese cupon no aplica', 'err');
  }

  promo = { code: data.code, discount: Number(data.discount), label: data.message };
  if (hint) hint.innerHTML = 'OK · <b>' + api.esc(data.name) + '</b> · ' + api.esc(data.message);
  document.getElementById('posPromoClear').hidden = false;
  renderCart();
}

function clearPromo() {
  promo = null;
  document.getElementById('posPromo').value = '';
  document.getElementById('posPromoHint').textContent = '';
  document.getElementById('posPromoClear').hidden = true;
  renderCart();
}

function resetPosFields() {
  ['posCustomerSearch', 'posNit', 'posNrc', 'posFiscalName', 'posFiscalAddr',
   'posPromo', 'posCardAuth', 'posCardLast4'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const hint = document.getElementById('posCustomerHint');
  if (hint) hint.textContent = 'Consumidor final';
  const ph = document.getElementById('posPromoHint');
  if (ph) ph.textContent = '';
  const pc = document.getElementById('posPromoClear');
  if (pc) pc.hidden = true;
  document.getElementById('posCustomerResults')?.remove();
  document.getElementById('posNewCustomer')?.remove();
}

/* monto en letras para el documento */
const UNI = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
  'once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve',
  'veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis',
  'veintisiete','veintiocho','veintinueve'];
const DEC = ['', '', '', 'treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
const CEN = ['', 'ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos',
  'setecientos','ochocientos','novecientos'];

function centenas(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (c) parts.push(CEN[c]);
  if (r) {
    if (r < 30) parts.push(UNI[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      parts.push(u ? DEC[d] + ' y ' + UNI[u] : DEC[d]);
    }
  }
  return parts.join(' ');
}

function enteroLetras(n) {
  if (n === 0) return 'cero';
  if (n < 1000) return centenas(n);
  if (n < 1000000) {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    const m = miles === 1 ? 'mil' : enteroLetras(miles) + ' mil';
    return resto ? m + ' ' + centenas(resto) : m;
  }
  const mill = Math.floor(n / 1000000);
  const resto = n % 1000000;
  const m = mill === 1 ? 'un millon' : enteroLetras(mill) + ' millones';
  return resto ? m + ' ' + enteroLetras(resto) : m;
}

function numeroLetras(monto) {
  const n = Math.floor(Number(monto) || 0);
  const cents = Math.round(((Number(monto) || 0) - n) * 100);
  const txt = enteroLetras(n).toUpperCase();
  return txt + ' ' + (cents ? 'CON ' + String(cents).padStart(2, '0') + '/100' : 'CON 00/100') + ' DOLARES';
}
