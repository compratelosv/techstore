/* pos.js — punto de venta presencial.
 * Crea el pedido con canal 'pos' y lo cobra en el acto. El stock lo descuenta
 * ts_confirm_payment, nunca el navegador por su cuenta.
 */
let booted = false;
let api = null;
let products = [];
let cart = []; // [{id, sku, name, price, qty, stock}]

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
    if (t) addToCart(t.dataset.posAdd);
  });
  $('#posLines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pos-del]');
    if (b) {
      cart = cart.filter((i) => i.id !== b.dataset.posDel);
      renderCart();
    }
  });
  $('#posClear').addEventListener('click', () => {
    cart = [];
    renderCart();
  });
  $('#posCharge').addEventListener('click', charge);

  loadProducts();
}

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

function renderProducts() {
  const q = ($('#posSearch').value || '').trim().toLowerCase();
  const list = products.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
  );
  $('#posProducts').innerHTML = list
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

function addToCart(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const found = cart.find((c) => c.id === id);
  const nextQty = (found?.qty || 0) + 1;
  if (nextQty > p.stock) return api.toast(`Solo hay ${p.stock} de ${p.name}`, 'err');
  if (found) found.qty = nextQty;
  else cart.push({ id: p.id, sku: p.sku, name: p.name, price: Number(p.price), qty: 1, stock: p.stock });
  renderCart();
}

function total() {
  return cart.reduce((n, i) => n + i.price * i.qty, 0);
}

function renderCart() {
  $('#posLines').innerHTML = cart
    .map(
      (i) => `
      <div class="pos-line">
        <span>${api.esc(i.name)} <span class="muted small">×${i.qty}</span></span>
        <span class="row" style="gap:.6rem">
          <b>${api.money(i.price * i.qty)}</b>
          <button class="rm" data-pos-del="${i.id}" title="Quitar">✕</button>
        </span>
      </div>`
    )
    .join('');
  $('#posEmpty').hidden = cart.length > 0;
  $('#posTotal').textContent = api.money(total());
  $('#posCharge').disabled = cart.length === 0;
}

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
    btn.textContent = 'Cobrar y generar pedido';
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
    btn.textContent = 'Cobrar y generar pedido';
    return;
  }

  api.toast(`Venta ${order.code} cobrada · ${api.money(order.total)}`);
  cart = [];
  $('#posName').value = '';
  btn.textContent = 'Cobrar y generar pedido';
  await loadProducts();
  document.dispatchEvent(new CustomEvent('pos:sale', { detail: order }));
}
