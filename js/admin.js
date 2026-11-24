/* admin.js — shell del panel: pedidos, preparación e inventario */
import { sb, money, esc, toast, fmtDate, errMessage, STATUS_LABEL, getUser } from './core.js?v=6bf78bd8';
import { initPos, scanOnce } from './pos.js?v=90cba46c';
import { Scanner } from './scanner.js?v=90ef2e67';

/* ---------------- estado ---------------- */
const state = {
  view: 'orders',
  orders: [],
  products: [],
  categories: [],
  statusFilter: 'all',
  search: '',
  profile: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- drawer ---------------- */
const drawer = $('#drawer');
function openDrawer({ title, subtitle = '', body = '', foot = '' }) {
  $('#dCode').textContent = title;
  $('#dMeta').innerHTML = subtitle;
  $('#dBody').innerHTML = body;
  $('#dFoot').innerHTML = foot;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}
$('#dClose').onclick = closeDrawer;

/* ---------------- auth ---------------- */
async function boot() {
  const user = await getUser();
  if (!user) return showLogin();

  const { data: profile, error } = await sb
    .from('ts_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) toast(errMessage(error), 'err');
  if (!profile || !['admin', 'operador'].includes(profile.role)) {
    await sb.auth.signOut();
    $('#loginWrap').classList.remove('hidden');
    toast('Esa cuenta no tiene permisos de panel.', 'err');
    return;
  }

  state.profile = profile;
  $('#loginWrap').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#sideWho').textContent = `${profile.email || user.email} · ${profile.role}`;
  // versión del código cargado: sirve para diagnosticar cachés viejas
  const own = Array.from(document.scripts).find((s) => s.src.includes('js/admin.js'));
  const ver = own ? new URL(own.src).searchParams.get('v') : 'dev';
  $('#sideWho').textContent += ` · v${ver}`;
  window.__tsReady = true;
  await refreshAll();
  initPos({ sb, money, esc, toast, errMessage });
  setView(viewFromHash()); // respeta admin.html#inventario
}

function showLogin() {
  $('#loginWrap').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $('#lEmail').value.trim(),
    password: $('#lPass').value,
  });
  btn.disabled = false;
  if (error) {
    toast(/Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message, 'err');
    return;
  }
  await boot();
});

$('#logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

/* ---------------- navegación ---------------- */
$('#sideNav').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  setView(btn.dataset.view);
});

const TITLES = {
  orders: ['Pedidos', 'Todo lo que entró por la tienda y por el punto de venta'],
  fulfillment: ['Preparación', 'Lo que hay que embalar y entregar, por etapa'],
  pos: ['Punto de venta', 'Venta presencial: descuenta inventario al cobrar'],
  inventory: ['Inventario', 'Stock, precios y movimientos'],
};

// enlaces directos: admin.html#inventario, #pos, #preparacion, #pedidos
const HASH_TO_VIEW = {
  pedidos: 'orders', orders: 'orders',
  preparacion: 'fulfillment', fulfillment: 'fulfillment',
  pos: 'pos',
  inventario: 'inventory', inventory: 'inventory',
};
const VIEW_TO_HASH = { orders: 'pedidos', fulfillment: 'preparacion', pos: 'pos', inventory: 'inventario' };

function viewFromHash() {
  const key = (location.hash || '').replace('#', '').trim().toLowerCase();
  return HASH_TO_VIEW[key] || 'orders';
}

function setView(view, { syncHash = true } = {}) {
  state.view = view;
  $$('#sideNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['orders', 'fulfillment', 'pos', 'inventory'].forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
  });
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];
  if (syncHash && location.hash !== `#${VIEW_TO_HASH[view]}`) {
    history.replaceState(null, '', `#${VIEW_TO_HASH[view]}`);
  }
  if (view === 'orders') renderOrders();
  if (view === 'fulfillment') renderKanban();
  if (view === 'inventory') renderInventory();
  if (view === 'pos') renderPos();
}

window.addEventListener('hashchange', () => setView(viewFromHash(), { syncHash: false }));

async function refreshAll() {
  await Promise.all([loadOrders(), loadProducts(), loadCategories()]);
  renderOrders();
  renderKanban();
  renderInventory();
  renderPos();
}

async function loadCategories() {
  const { data } = await sb.from('ts_categories').select('*').order('sort_order');
  state.categories = data || [];
}

$('#refreshBtn').addEventListener('click', async () => {
  await refreshAll();
  toast('Datos actualizados');
});

/* ---------------- datos ---------------- */
async function loadOrders() {
  const { data, error } = await sb
    .from('ts_orders')
    .select('*, ts_order_items(*)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return toast(errMessage(error), 'err');
  state.orders = data || [];
}

async function loadProducts() {
  const { data, error } = await sb.from('ts_products').select('*').order('name');
  if (error) return toast(errMessage(error), 'err');
  state.products = data || [];
}

/* ---------------- pedidos: KPIs y tabla ---------------- */
function renderOrders() {
  // Activo = todavía en curso; un pedido entregado ya está cerrado.
  const active = state.orders.filter((o) =>
    ['pendiente_pago', 'pagado', 'en_preparacion', 'listo'].includes(o.status)
  );
  // Cobrado = todo lo que ya pasó por pago, incluidos los ya entregados.
  const paid = state.orders.filter((o) =>
    ['pagado', 'en_preparacion', 'listo', 'entregado'].includes(o.status)
  );
  const revenue = paid.reduce((n, o) => n + Number(o.total), 0);
  const toPrepare = state.orders.filter((o) => ['pagado', 'en_preparacion'].includes(o.status)).length;
  const ready = state.orders.filter((o) => o.status === 'listo').length;

  $('#kpis').innerHTML = `
    <div class="kpi"><span>Ventas cobradas</span><b>${money(revenue)}</b></div>
    <div class="kpi"><span>Pedidos activos</span><b>${active.length}</b></div>
    <div class="kpi"><span>Por preparar</span><b>${toPrepare}</b></div>
    <div class="kpi"><span>Listos</span><b>${ready}</b></div>`;

  const tabs = [
    ['all', 'Todos'],
    ['pendiente_pago', 'Pendientes de pago'],
    ['pagado', 'Por preparar'],
    ['en_preparacion', 'En preparación'],
    ['listo', 'Listos'],
    ['entregado', 'Entregados'],
    ['cancelado', 'Cancelados'],
  ];
  $('#statusTabs').innerHTML = tabs
    .map(([k, label]) => {
      const n = k === 'all' ? state.orders.length : state.orders.filter((o) => o.status === k).length;
      return `<button class="tab-btn ${state.statusFilter === k ? 'active' : ''}" data-status="${k}">${label} (${n})</button>`;
    })
    .join('');

  const q = state.search.trim().toLowerCase();
  const rows = state.orders.filter((o) => {
    const okStatus = state.statusFilter === 'all' || o.status === state.statusFilter;
    const okQ = !q || o.code.toLowerCase().includes(q) || (o.customer_name || '').toLowerCase().includes(q)
      || (o.customer_email || '').toLowerCase().includes(q) || (o.customer_phone || '').includes(q);
    return okStatus && okQ;
  });

  $('#ordersTable').querySelector('tbody').innerHTML = rows
    .map((o) => `
      <tr class="order-row" data-order="${o.id}">
        <td class="mono">${esc(o.code)}</td>
        <td>${esc(o.customer_name)}<div class="small muted">${esc(o.customer_phone || '')}</div></td>
        <td>${o.fulfillment === 'retiro' ? 'Retiro' : esc(o.ship_city || 'Envío')}</td>
        <td class="num">${money(o.total)}</td>
        <td><span class="badge ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
        <td class="small muted">${fmtDate(o.created_at)}</td>
        <td><button class="btn sm ghost" data-open="${o.id}">Ver</button></td>
      </tr>`)
    .join('');
  $('#ordersEmpty').hidden = rows.length > 0;
}

$('#statusTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  state.statusFilter = b.dataset.status;
  renderOrders();
});

$('#orderSearch').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderOrders();
});

$('#ordersTable').addEventListener('click', (e) => {
  const row = e.target.closest('[data-order]');
  if (!row) return;
  openOrder(row.dataset.order);
});

/* ---------------- detalle de pedido ---------------- */
const NEXT_ACTION = {
  pendiente_pago: { status: 'pagado', label: 'Confirmar pago (simulado)', confirm: true },
  pagado: { status: 'en_preparacion', label: 'Empezar preparación' },
  en_preparacion: { status: 'listo', label: 'Marcar listo' },
  listo: { status: 'entregado', label: 'Marcar entregado' },
};

async function openOrder(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;

  const items = order.ts_order_items || [];
  const { data: events } = await sb
    .from('ts_order_events')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  const addr = order.fulfillment === 'envio'
    ? `${esc(order.ship_line1 || '')}${order.ship_line2 ? ', ' + esc(order.ship_line2) : ''}<br>${esc(order.ship_city || '')}, ${esc(order.ship_department || '')}`
    : 'Retiro en tienda (sin costo de envío)';

  openDrawer({
    title: order.code,
    subtitle: `<span class="badge ${order.status}">${STATUS_LABEL[order.status]}</span>
      <span class="small muted" style="margin-left:.5rem">${fmtDate(order.created_at)} · ${order.channel === 'pos' ? 'Punto de venta' : 'Tienda en línea'}</span>`,
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <h3>Cliente</h3>
        <div class="small">${esc(order.customer_name)}</div>
        <div class="small muted">${esc(order.customer_phone || '—')} · ${esc(order.customer_email || '—')}</div>
        <h3 style="margin-top:.9rem">Entrega</h3>
        <div class="small">${order.fulfillment === 'retiro' ? 'Retiro en tienda' : 'Envío a domicilio'}</div>
        <div class="small muted">${addr}</div>
        ${order.ship_notes ? `<div class="small muted">Nota: ${esc(order.ship_notes)}</div>` : ''}
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3>Productos a preparar</h3>
        <table class="table">
          <tbody>
          ${items.map((i) => `
            <tr>
              <td class="mono small">${esc(i.sku)}</td>
              <td>${esc(i.name)}</td>
              <td class="num">×${i.qty}</td>
              <td class="num">${money(i.line_total)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="summary-row" style="display:flex;justify-content:space-between;margin-top:.6rem">
          <span class="muted small">Subtotal / Envío</span>
          <span class="small">${money(order.subtotal)} / ${money(order.shipping_cost)}</span>
        </div>
        <div class="pos-total"><span>Total</span><span>${money(order.total)}</span></div>
      </div>

      <div class="panel">
        <h3>Historial</h3>
        ${(events || []).map((ev) => `
          <div class="evline">
            <b>${STATUS_LABEL[ev.to_status] || ev.to_status}</b>
            ${ev.from_status ? ` ← ${STATUS_LABEL[ev.from_status]}` : ''}
            <div>${esc(ev.note || '')} · ${fmtDate(ev.created_at)}</div>
          </div>`).join('') || '<p class="small muted">Sin eventos.</p>'}
      </div>`,
    foot: `
      <a class="btn primary" href="sticker.html?id=${order.id}" target="_blank" rel="noopener">🖨 Imprimir etiqueta</a>
      ${NEXT_ACTION[order.status]
        ? `<button class="btn" data-advance="${order.status}">${NEXT_ACTION[order.status].label}</button>`
        : ''}
      ${['pagado', 'en_preparacion', 'listo'].includes(order.status)
        ? `<button class="btn danger" data-cancel>Cancelar pedido</button>` : ''}
      <button class="btn ghost" id="dClose2">Cerrar</button>`,
  });

  $('#dBody').dataset.orderId = order.id;
  $('#dFoot').addEventListener('click', async (e) => {
    const adv = e.target.closest('[data-advance]');
    const cancel = e.target.closest('[data-cancel]');
    if (e.target.id === 'dClose2') return closeDrawer();

    if (adv) {
      const from = adv.dataset.advance;
      const next = NEXT_ACTION[from];
      const btn = e.target;
      btn.disabled = true;
      let error;
      if (next.status === 'pagado') {
        ({ error } = await sb.rpc('ts_confirm_payment', { p_order_id: order.id, p_provider: 'simulado', p_reference: `POS-${Date.now()}` }));
      } else {
        ({ error } = await sb.rpc('ts_set_order_status', { p_order_id: order.id, p_status: next.status }));
      }
      btn.disabled = false;
      if (error) return toast(errMessage(error), 'err');
      toast('Estado actualizado');
      await loadOrders();
      renderOrders();
      renderKanban();
      closeDrawer();
      openOrder(order.id);
    }

    if (cancel) {
      if (!confirm(`¿Cancelar el pedido ${order.code}? Se devuelve el inventario si ya estaba cobrado.`)) return;
      const { error } = await sb.rpc('ts_set_order_status', {
        p_order_id: order.id, p_status: 'cancelado', p_note: 'Cancelado desde el panel',
      });
      if (error) return toast(errMessage(error), 'err');
      toast('Pedido cancelado');
      await loadOrders();
      renderOrders();
      renderKanban();
      closeDrawer();
    }
  }, { once: true });
}

/* ---------------- preparación (kanban) ---------------- */
function renderKanban() {
  const cols = [
    ['pagado', 'Por preparar / embalar'],
    ['en_preparacion', 'En preparación'],
    ['listo', 'Listos para entregar'],
  ];
  $('#kanban').innerHTML = cols
    .map(([status, label]) => {
      const list = state.orders.filter((o) => o.status === status);
      return `
        <div class="col">
          <h3>${label} <span>${list.length}</span></h3>
          ${list.map((o) => `
            <div class="ticket" data-open="${o.id}">
              <div class="row" style="justify-content:space-between">
                <span class="code">${esc(o.code)}</span>
                <span class="small muted">${o.fulfillment === 'retiro' ? 'Retiro' : 'Envío'}</span>
              </div>
              <div class="items">${(o.ts_order_items || []).map((i) => `${esc(i.sku)} ×${i.qty}`).join(' · ')}</div>
              <div class="items">${esc(o.customer_name)} · ${fmtDate(o.created_at)}</div>
            </div>`).join('') || '<p class="small muted">Nada pendiente.</p>'}
        </div>`;
    })
    .join('');

  $('#kanban').onclick = (e) => {
    const t = e.target.closest('[data-open]');
    if (t) openOrder(t.dataset.open);
  };
}

/* ---------------- inventario ---------------- */
function renderInventory() {
  const prods = state.products;
  const low = prods.filter((p) => p.stock > 0 && p.stock <= p.low_stock);
  const out = prods.filter((p) => p.stock === 0);
  const value = prods.reduce((n, p) => n + p.stock * Number(p.price), 0);

  $('#invKpis').innerHTML = `
    <div class="kpi"><span>SKUs</span><b>${prods.length}</b></div>
    <div class="kpi"><span>Stock bajo</span><b style="color:var(--warn)">${low.length}</b></div>
    <div class="kpi"><span>Agotados</span><b style="color:var(--bad)">${out.length}</b></div>
    <div class="kpi"><span>Valor a precio de venta</span><b>${money(value)}</b></div>`;

  const q = ($('#invSearch').value || '').trim().toLowerCase();
  const rows = prods.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
  );

  $('#invTable').querySelector('tbody').innerHTML = rows
    .map((p) => `
      <tr>
        <td class="mono small">${esc(p.sku)}</td>
        <td>${esc(p.name)}</td>
        <td class="small muted">${esc(p.brand || '')}</td>
        <td class="num">${money(p.price)}</td>
        <td class="num" style="color:${p.stock === 0 ? 'var(--bad)' : p.stock <= p.low_stock ? 'var(--warn)' : 'inherit'}">${p.stock}</td>
        <td><button class="btn sm" data-inv="${p.id}">Ajustar</button>
            <button class="btn sm ghost" data-edit="${p.id}">Editar</button>
            <a class="btn sm ghost" href="product-label.html?sku=${encodeURIComponent(p.sku)}" target="_blank" rel="noopener">Etiqueta</a></td>
      </tr>`)
    .join('');

  $('#invTable').onclick = (e) => {
    const b = e.target.closest('[data-inv]');
    if (b) return openInventory(b.dataset.inv);
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const p = state.products.find((x) => x.id === ed.dataset.edit);
      if (p) openProductEditor(p);
    }
  };
}

$('#invSearch').addEventListener('input', renderInventory);

async function openInventory(productId) {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const { data: moves } = await sb
    .from('ts_inventory_movements')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(12);

  openDrawer({
    title: p.sku,
    subtitle: `${esc(p.name)} · stock actual <b>${p.stock}</b>`,
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="field">
          <label for="dDelta">Movimiento (usa negativo para restar)</label>
          <input id="dDelta" type="number" value="1" step="1">
        </div>
        <div class="field">
          <label for="dNote">Motivo</label>
          <input id="dNote" placeholder="Compra a proveedor, merma, conteo físico…">
        </div>
        <button class="btn primary" id="dApply">Registrar movimiento</button>
      </div>
      <div class="panel">
        <h3>Últimos movimientos</h3>
        ${(moves || []).map((m) => `
          <div class="evline"><b>${m.delta > 0 ? '+' : ''}${m.delta}</b> · ${esc(m.reason)}
            <div>${esc(m.note || '')} · ${fmtDate(m.created_at)}</div>
          </div>`).join('') || '<p class="small muted">Sin movimientos.</p>'}
      </div>`,
    foot: `<button class="btn ghost" id="dClose2">Cerrar</button>`,
  });

  $('#dApply').onclick = async () => {
    const delta = Number($('#dDelta').value);
    if (!delta) return toast('Escribe una cantidad distinta de cero', 'err');
    const { error } = await sb.rpc('ts_adjust_stock', {
      p_product_id: productId, p_delta: delta, p_note: $('#dNote').value.trim() || null,
    });
    if (error) return toast(errMessage(error), 'err');
    toast('Inventario actualizado');
    await loadProducts();
    renderInventory();
    openInventory(productId);
  };
  $('#dFoot').addEventListener('click', (e) => {
    if (e.target.id === 'dClose2') closeDrawer();
  }, { once: true });
}

/* ---------------- alta y edición de productos ---------------- */
function ean13(base12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return base12 + String((10 - (sum % 10)) % 10);
}

function newBarcode() {
  // prefijo 200 = uso interno; 9 dígitos del reloj para no repetir
  return ean13(`200${String(Date.now()).slice(-9)}`);
}

/* ---------- generación de SKU ----------
 * Formato: <CAT3>-<MARCA3>-<NNN>
 *   CAT3   = abreviatura de la categoría (LAP, PHN, AUD, ACC, MON, STO…)
 *   MARCA3 = primeras 3 letras de la marca (GEN si no hay)
 *   NNN    = número derivado del código de barras (últimos 3 dígitos antes del
 *            verificador), corrido hacia arriba hasta encontrar uno libre.
 * Así el SKU es determinista: mismo producto y mismo código ⇒ mismo SKU, y
 * sigue siendo legible para una persona.
 */
const CAT_PREFIX = {
  laptops: 'LAP',
  smartphones: 'PHN',
  audio: 'AUD',
  accesorios: 'ACC',
  monitores: 'MON',
  almacenamiento: 'STO',
};

function letters3(text) {
  const clean = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return clean.slice(0, 3) || 'GEN';
}

function generateSku({ categoryId, brand, barcode, existing = [] } = {}) {
  const cat = state.categories.find((c) => c.id === categoryId);
  const prefix = CAT_PREFIX[cat?.slug] || letters3(cat?.name) || 'GEN';
  const mark = letters3(brand);

  const digits = String(barcode || '').replace(/\D/g, '');
  // últimos 3 dígitos antes del verificador (más estables que el final)
  const seed = digits.length >= 6 ? Number(digits.slice(-4, -1)) : 1;

  const used = new Set(
    [...state.products, ...existing].map((p) => String(p.sku || '').toUpperCase())
  );

  for (let i = 0; i < 900; i += 1) {
    const num = String(100 + ((seed + i) % 900)).padStart(3, '0');
    const sku = `${prefix}-${mark}-${num}`;
    if (!used.has(sku)) return { sku, prefix, mark, num, origen: digits ? 'barcode' : 'secuencial' };
  }
  return { sku: `${prefix}-${mark}-${String(Date.now()).slice(-3)}`, prefix, mark, origen: 'fallback' };
}

/* Bases públicas por código de barras (sin API key). Si no hay datos, se
 * devuelve null y el formulario queda para llenado manual. */
const PRODUCT_SOURCES = [
  ['Open Food Facts', 'https://world.openfoodfacts.org/api/v2/product/'],
  ['Open Beauty Facts', 'https://world.openbeautyfacts.org/api/v2/product/'],
  ['Open Products Facts', 'https://world.openproductsfacts.org/api/v2/product/'],
];

async function lookupProductData(code) {
  if (!/^\d{8,13}$/.test(code)) return null;
  // El rango 200… es de uso interno: no corresponde a ningún producto comercial,
  // y buscar ahí solo devuelve coincidencias falsas.
  if (code.startsWith('200')) return null;

  const attempts = PRODUCT_SOURCES.map(async ([source, base]) => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(`${base}${code}.json?fields=product_name,brands`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      const name = json?.product?.product_name?.trim();
      if (json?.status === 1 && name) {
        return { name, brand: (json.product.brands || '').split(',')[0].trim(), source };
      }
      return null;
    } catch {
      return null;
    }
  });

  const all = Promise.all(attempts).then((list) => list.find(Boolean) || null);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 7000));
  return Promise.race([all, timeout]);
}

function openProductEditor(p = null) {
  const catOptions = state.categories
    .map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  openDrawer({
    title: p ? p.sku : 'Nuevo producto',
    subtitle: p ? 'Editar producto' : 'Alta de producto en el inventario',
    body: `
      <div class="panel">
        <div class="field">
          <label for="fSku">SKU / código interno *</label>
          <div class="row">
            <input id="fSku" value="${esc(p?.sku || '')}" ${p ? 'readonly' : ''} placeholder="se genera al escanear">
            ${p ? '' : '<button class="btn sm" id="fSkuGen" type="button" title="Generar SKU">⟳</button>'}
          </div>
          ${p ? '' : '<span class="small muted" id="fSkuHint">Categoría + marca + número del código de barras.</span>'}
        </div>
        <div class="field">
          <label for="fName">Nombre *</label>
          <input id="fName" value="${esc(p?.name || '')}" placeholder="NovaBook Air 15">
        </div>
        <div class="field">
          <label for="fBrand">Marca</label>
          <input id="fBrand" value="${esc(p?.brand || '')}">
        </div>
        <div class="field">
          <label for="fCat">Categoría</label>
          <select id="fCat"><option value="">— sin categoría —</option>${catOptions}</select>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1">
            <label for="fPrice">Precio venta *</label>
            <input id="fPrice" type="number" step="0.01" min="0" value="${p ? Number(p.price) : ''}" placeholder="849.00">
          </div>
          <div class="field" style="flex:1">
            <label for="fCost">Costo</label>
            <input id="fCost" type="number" step="0.01" min="0" value="${p?.cost ?? ''}">
          </div>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1">
            <label for="fStock">Stock</label>
            <input id="fStock" type="number" step="1" min="0" value="${p ? p.stock : 0}">
          </div>
          <div class="field" style="flex:1">
            <label for="fLow">Alerta stock bajo</label>
            <input id="fLow" type="number" step="1" min="0" value="${p ? p.low_stock : 3}">
          </div>
        </div>
        <div class="field">
          <label for="fBarcode">Código de barras (EAN-13)</label>
          <div class="row">
            <input id="fBarcode" value="${esc(p?.barcode || '')}" placeholder="Escanea o deja vacío para generar">
            <button class="btn sm primary" id="fScan" type="button" title="Escanear con la cámara">📷</button>
            <button class="btn sm" id="fPhoto" type="button" title="Leer desde una foto">🖼</button>
            <input type="file" id="fBarcodeFile" accept="image/*" capture="environment" hidden>
          </div>
          <span class="small muted" id="fScanHint">Escanea el código del producto real y se rellena solo.</span>
        </div>
        <div class="field">
          <label for="fDesc">Descripción</label>
          <textarea id="fDesc" rows="3">${esc(p?.description || '')}</textarea>
        </div>
        <label class="row" style="gap:.5rem;align-items:center;font-size:.86rem">
          <input type="checkbox" id="fActive" ${!p || p.active ? 'checked' : ''} style="width:auto">
          Visible en la tienda
        </label>
      </div>`,
    foot: `<button class="btn primary" id="fSave">Guardar producto</button>
           <button class="btn ghost" id="fCancel">Cancelar</button>`,
  });

  const barcodeEl = document.getElementById('fBarcode');
  const hintEl = document.getElementById('fScanHint');
  const skuEl = document.getElementById('fSku');
  const skuHintEl = document.getElementById('fSkuHint');
  let skuTouched = Boolean(p); // al editar un producto existente nunca se toca el SKU

  /** Genera el SKU desde categoría + marca + código de barras. */
  function refreshSku(force = false) {
    if (!skuEl || !skuHintEl) return;
    if (skuTouched && !force) return;
    if (!force && !skuEl.value && !barcodeEl.value) return; // nada sobre qué basarse
    const r = generateSku({
      categoryId: document.getElementById('fCat').value,
      brand: document.getElementById('fBrand').value,
      barcode: barcodeEl.value,
    });
    skuEl.value = r.sku;
    const origen = r.origen === 'barcode' ? 'número tomado del código de barras' : 'secuencial (sin código)';
    skuHintEl.textContent = `${r.prefix} (categoría) · ${r.mark} (marca) · ${r.num} · ${origen}`;
    skuHintEl.style.color = 'var(--muted)';
  }

  if (skuEl) skuEl.addEventListener('input', () => { skuTouched = true; });
  const skuGenBtn = document.getElementById('fSkuGen');
  if (skuGenBtn) {
    skuGenBtn.onclick = () => {
      skuTouched = false;
      refreshSku(true);
    };
  }
  document.getElementById('fCat').addEventListener('change', () => refreshSku());
  document.getElementById('fBrand').addEventListener('input', () => refreshSku());

  /** Normaliza y valida el código leído; avisa de duplicados. */
  async function applyScannedCode(raw) {
    let code = String(raw || '').replace(/\s+/g, '');
    // UPC-A (12) es el mismo símbolo que EAN-13 con un 0 delante.
    if (/^\d{12}$/.test(code)) code = `0${code}`;

    barcodeEl.value = code;

    if (!/^\d{8}$|^\d{13}$/.test(code)) {
      hintEl.textContent = `Código "${code}" no es EAN-8/EAN-13. Puedes guardarlo, pero no se recomienda.`;
      hintEl.style.color = 'var(--warn)';
      return;
    }

    if (/^\d{13}$/.test(code) && ean13(code.slice(0, 12)) !== code) {
      hintEl.textContent = 'El dígito verificador no cuadra: puede ser una lectura errónea. Repite el escaneo.';
      hintEl.style.color = 'var(--bad)';
      return;
    }

    const dup = state.products.find((x) => (x.barcode || '') === code);
    if (dup) {
      hintEl.textContent = `Ese código ya es de "${dup.name}" (${dup.sku}). Editando ese producto en su lugar.`;
      hintEl.style.color = 'var(--warn)';
      toast('Ese código ya existe en el catálogo');
      closeDrawer();
      openProductEditor(dup);
      return;
    }

    hintEl.textContent = `Código ${code} listo. Buscando datos del producto…`;
    hintEl.style.color = 'var(--ok)';
    refreshSku(); // el SKU se arma con la categoría/marca que haya ahora

    const found = await lookupProductData(code);
    if (found?.name) {
      const nameEl = document.getElementById('fName');
      const brandEl = document.getElementById('fBrand');
      if (!nameEl.value) nameEl.value = found.name;
      if (!brandEl.value && found.brand) brandEl.value = found.brand;
      hintEl.textContent = `Datos traídos de ${found.source}: ${found.name}. Revísalos antes de guardar.`;
    } else {
      hintEl.textContent = `Código ${code} listo. No hay datos públicos: escribe nombre y precio.`;
    }
  }

  document.getElementById('fScan').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await scanOnce({ title: 'Escanea el código del producto a dar de alta' });
    btn.disabled = false;
    if (res?.value) await applyScannedCode(res.value);
  };

  document.getElementById('fPhoto').onclick = () => document.getElementById('fBarcodeFile').click();
  document.getElementById('fBarcodeFile').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const sc = new Scanner({ video: document.createElement('video'), onDetect: () => {} });
      const res = await sc.decodeImageElement(img);
      URL.revokeObjectURL(img.src);
      await applyScannedCode(res.value);
    } catch {
      hintEl.textContent = 'No se encontró un código legible en la foto.';
      hintEl.style.color = 'var(--bad)';
    }
  };

  document.getElementById('fCancel').onclick = closeDrawer;

  document.getElementById('fSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const payload = {
      sku: document.getElementById('fSku').value.trim().toUpperCase(),
      name: document.getElementById('fName').value.trim(),
      brand: document.getElementById('fBrand').value.trim() || null,
      category_id: document.getElementById('fCat').value || null,
      price: Number(document.getElementById('fPrice').value),
      cost: document.getElementById('fCost').value === '' ? null : Number(document.getElementById('fCost').value),
      stock: Number(document.getElementById('fStock').value || 0),
      low_stock: Number(document.getElementById('fLow').value || 0),
      barcode: document.getElementById('fBarcode').value.trim() || newBarcode(),
      description: document.getElementById('fDesc').value.trim() || null,
      active: document.getElementById('fActive').checked,
    };

    if (!payload.sku || !payload.name) {
      toast('SKU y nombre son obligatorios', 'err');
      btn.disabled = false;
      btn.textContent = 'Guardar producto';
      return;
    }
    if (!Number.isFinite(payload.price) || payload.price < 0) {
      toast('Precio inválido', 'err');
      btn.disabled = false;
      btn.textContent = 'Guardar producto';
      return;
    }
    if (!/^\d{8}$|^\d{13}$/.test(payload.barcode)) {
      // Códigos no estándar (Code 128, etiquetas propias): se permiten con aviso.
      const seguir = confirm(
        `"${payload.barcode}" no tiene formato EAN-8/EAN-13.\n\nSe puede guardar, pero la etiqueta se imprimirá como Code 128.\n¿Continuar?`
      );
      if (!seguir) {
        btn.disabled = false;
        btn.textContent = 'Guardar producto';
        return;
      }
    }

    const { error } = p
      ? await sb.from('ts_products').update(payload).eq('id', p.id)
      : await sb.from('ts_products').insert(payload);

    if (error) {
      toast(errMessage(error), 'err');
      btn.disabled = false;
      btn.textContent = 'Guardar producto';
      return;
    }

    toast(p ? 'Producto actualizado' : 'Producto agregado al inventario');
    closeDrawer();
    await loadProducts();
    renderInventory();
    renderPos();
  };
}

$('#btnNewProduct').addEventListener('click', () => openProductEditor(null));

/* ---------------- POS (delegado) ---------------- */
function renderPos() {
  if (state.products.length) {
    initPos({ sb, money, esc, toast, errMessage });
  }
}

boot().catch((err) => toast(errMessage(err), 'err'));
