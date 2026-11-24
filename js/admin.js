/* admin.js — shell del panel: pedidos, preparación e inventario */
import { sb, money, esc, toast, fmtDate, errMessage, STATUS_LABEL, getUser, loadCurrency, getCurrency } from './core.js?v=18c48370';
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
  salesDays: 30,
  salesData: null,
  settings: null,
  quotes: [],
  quoteFilter: 'all',
  banks: [],
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
  $('#adminBar').classList.remove('hidden');
  await loadCurrency();
  $('#sideWho').textContent = `${profile.email || user.email}`;
  // versión del código cargado: sirve para diagnosticar cachés viejas
  const own = Array.from(document.scripts).find((s) => s.src.includes('js/admin.js'));
  const ver = own ? new URL(own.src).searchParams.get('v') : 'dev';
  $('#sideFoot').innerHTML = `
    <div>${esc(profile.full_name || '')} · <b>${esc(profile.role)}</b></div>
    <div>v${ver}</div>
    <button id="logoutBtn2">Cerrar sesión</button>`;
  $('#logoutBtn2').onclick = async () => {
    await sb.auth.signOut();
    location.reload();
  };
  window.__tsReady = true;

  // La sección de usuarios es solo para el administrador.
  const isAdmin = profile.role === 'admin';
  $('#navUsers').classList.toggle('hidden', !isAdmin);
  $('#navSettings').classList.toggle('hidden', !isAdmin);

  await loadSettings();
  await refreshAll();
  initPos({ sb, money, esc, toast, errMessage });
  const target = viewFromHash();
  setView(target === 'users' && !isAdmin ? 'orders' : target);
}

function showLogin() {
  $('#loginWrap').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
  $('#adminBar').classList.add('hidden');
}

/* menú lateral en móvil */
function closeMobileMenu() {
  $('#sideBar').classList.remove('open');
  $('#sideScrim').classList.remove('show');
}
$('#btnMenu').addEventListener('click', () => {
  $('#sideBar').classList.toggle('open');
  $('#sideScrim').classList.toggle('show');
});
$('#sideScrim').addEventListener('click', closeMobileMenu);

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
  sales: ['Ventas', 'Ingresos, ticket promedio, margen y productos más vendidos'],
  quotes: ['Cotizaciones', 'Propuestas de precio para clientes, listas para enviar'],
  users: ['Usuarios', 'Quién entra al panel y con qué rol'],
  settings: ['Configuración', 'Moneda, datos del negocio, impuestos y cuentas bancarias'],
  inventory: ['Inventario', 'Stock, precios y movimientos'],
};

// enlaces directos: admin.html#pedidos, #preparacion, #pos, #cotizaciones, #ventas, #usuarios, #configuracion, #inventario
const HASH_TO_VIEW = {
  pedidos: 'orders', orders: 'orders',
  preparacion: 'fulfillment', fulfillment: 'fulfillment',
  pos: 'pos',
  cotizaciones: 'quotes', quotes: 'quotes',
  ventas: 'sales', sales: 'sales',
  usuarios: 'users', users: 'users',
  configuracion: 'settings', settings: 'settings',
  inventario: 'inventory', inventory: 'inventory',
};
const VIEW_TO_HASH = {
  orders: 'pedidos', fulfillment: 'preparacion', pos: 'pos', quotes: 'cotizaciones',
  sales: 'ventas', users: 'usuarios', settings: 'configuracion', inventory: 'inventario',
};

function viewFromHash() {
  const key = (location.hash || '').replace('#', '').trim().toLowerCase();
  return HASH_TO_VIEW[key] || 'orders';
}

function setView(view, { syncHash = true } = {}) {
  state.view = view;
  $$('#sideNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['orders', 'fulfillment', 'pos', 'quotes', 'sales', 'users', 'settings', 'inventory'].forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
  });
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];
  if (syncHash && location.hash !== `#${VIEW_TO_HASH[view]}`) {
    history.replaceState(null, '', `#${VIEW_TO_HASH[view]}`);
  }
  closeMobileMenu();
  if (view === 'orders') renderOrders();
  if (view === 'fulfillment') renderKanban();
  if (view === 'inventory') renderInventory();
  if (view === 'pos') renderPos();
  if (view === 'sales') renderSales();
  if (view === 'quotes') renderQuotes();
  if (view === 'users') renderUsers();
  if (view === 'settings') renderSettings();
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

/* ---------------- configuración y ajustes ---------------- */
async function loadSettings() {
  const { data } = await sb.from('ts_settings').select('key, value');
  const map = {};
  (data || []).forEach((r) => { map[r.key] = r.value; });
  state.settings = map;
  return map;
}

const CURRENCY_PRESETS = {
  USD: { symbol: '$', decimals: 2, locale: 'en-US' },
  EUR: { symbol: '€', decimals: 2, locale: 'es-ES' },
  MXN: { symbol: '$', decimals: 2, locale: 'es-MX' },
  GTQ: { symbol: 'Q', decimals: 2, locale: 'es-MX' },
  HNL: { symbol: 'L', decimals: 2, locale: 'es-MX' },
  CRC: { symbol: '₡', decimals: 0, locale: 'es-MX' },
  COP: { symbol: '$', decimals: 0, locale: 'es-MX' },
};

function previewMoney(cfg) {
  const sample = 1234.56;
  try {
    return `${cfg.symbol || ''}${sample.toLocaleString(cfg.locale || 'en-US', {
      minimumFractionDigits: cfg.decimals ?? 2,
      maximumFractionDigits: cfg.decimals ?? 2,
    })}`;
  } catch {
    return `${cfg.symbol || ''}${sample.toFixed(cfg.decimals ?? 2)}`;
  }
}

async function renderSettings() {
  if (state.profile?.role !== 'admin') {
    toast('Solo el administrador puede ver la configuración', 'err');
    return setView('orders');
  }
  const s = state.settings || (await loadSettings());
  const cur = { ...CURRENCY_PRESETS.USD, ...(s.currency || {}) };
  const biz = s.business || {};
  const sales = s.sales || {};

  $('#curCode').value = cur.code || 'USD';
  $('#curSymbol').value = cur.symbol || '$';
  $('#curDecimals').value = String(cur.decimals ?? 2);
  $('#curLocale').value = cur.locale || 'en-US';
  $('#curPreview').textContent = `Vista previa: ${previewMoney(cur)}`;

  $('#bizName').value = biz.name || '';
  $('#bizLegal').value = biz.legal_name || '';
  $('#bizNit').value = biz.nit || '';
  $('#bizPhone').value = biz.phone || '';
  $('#bizWhatsapp').value = biz.whatsapp || '';
  $('#bizEmail').value = biz.email || '';
  $('#bizAddress').value = biz.address || '';

  $('#taxRate').value = sales.tax_rate ?? 0;
  $('#taxIncluded').value = String(sales.tax_included ?? true);
  $('#qPrefix').value = sales.quote_prefix || 'COT';
  $('#qDays').value = sales.quote_valid_days ?? 15;
  $('#lowStock').value = sales.low_stock_default ?? 3;

  const { data: banks } = await sb.from('ts_bank_accounts').select('*').order('created_at');
  state.banks = banks || [];
  $('#bankList').innerHTML = state.banks.length
    ? state.banks
        .map(
          (b) => `<div class="line" style="grid-template-columns:1fr auto;padding:.6rem 0">
            <div>
              <div class="tl-name">${esc(b.bank)} · ${esc(b.account_type)}</div>
              <div class="tl-sub">${esc(b.account_number)} · ${esc(b.holder)} · ${esc(b.currency)}</div>
            </div>
            <div class="row" style="gap:.35rem">
              <button class="btn sm ${b.active ? '' : 'ghost'}" data-bank-toggle="${b.id}" data-active="${b.active}">
                ${b.active ? 'Activa' : 'Inactiva'}
              </button>
              <button class="btn sm danger" data-bank-del="${b.id}">Eliminar</button>
            </div>
          </div>`
        )
        .join('')
    : '<p class="small muted">Sin cuentas registradas.</p>';
}

$('#curCode').addEventListener('change', () => {
  const p = CURRENCY_PRESETS[$('#curCode').value] || CURRENCY_PRESETS.USD;
  $('#curSymbol').value = p.symbol;
  $('#curDecimals').value = String(p.decimals);
  $('#curLocale').value = p.locale;
  $('#curPreview').textContent = `Vista previa: ${previewMoney({ ...p, code: $('#curCode').value })}`;
});

['#curSymbol', '#curDecimals', '#curLocale'].forEach((sel) => {
  $(sel).addEventListener('change', () => {
    $('#curPreview').textContent = `Vista previa: ${previewMoney({
      symbol: $('#curSymbol').value,
      decimals: Number($('#curDecimals').value),
      locale: $('#curLocale').value,
    })}`;
  });
});

$('#formCurrency').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = {
    code: $('#curCode').value,
    symbol: $('#curSymbol').value || '$',
    decimals: Number($('#curDecimals').value),
    locale: $('#curLocale').value,
  };
  const { error } = await sb.rpc('ts_save_setting', { p_key: 'currency', p_value: value });
  if (error) return toast(errMessage(error), 'err');
  await loadCurrency();
  await loadSettings();
  toast('Moneda actualizada');
  renderSettings();
  renderOrders();
  renderInventory();
  renderSales();
});

$('#formBusiness').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = {
    name: $('#bizName').value.trim(),
    legal_name: $('#bizLegal').value.trim(),
    nit: $('#bizNit').value.trim(),
    phone: $('#bizPhone').value.trim(),
    whatsapp: $('#bizWhatsapp').value.trim(),
    email: $('#bizEmail').value.trim(),
    address: $('#bizAddress').value.trim(),
  };
  const { error } = await sb.rpc('ts_save_setting', { p_key: 'business', p_value: value });
  if (error) return toast(errMessage(error), 'err');
  await loadSettings();
  toast('Datos del negocio guardados');
});

$('#formSales').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = {
    tax_rate: Number($('#taxRate').value || 0),
    tax_included: $('#taxIncluded').value === 'true',
    quote_prefix: ($('#qPrefix').value || 'COT').toUpperCase(),
    quote_valid_days: Number($('#qDays').value || 15),
    low_stock_default: Number($('#lowStock').value || 3),
  };
  const { error } = await sb.rpc('ts_save_setting', { p_key: 'sales', p_value: value });
  if (error) return toast(errMessage(error), 'err');
  await loadSettings();
  toast('Ajustes de ventas guardados');
});

$('#btnNewBank').addEventListener('click', () => {
  openDrawer({
    title: 'Nueva cuenta bancaria',
    subtitle: 'Donde se recibe el dinero de las ventas',
    body: `
      <div class="panel">
        <div class="field"><label for="bkBank">Banco *</label><input id="bkBank" placeholder="Banco Agrícola"></div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="bkType">Tipo</label>
            <select id="bkType"><option>ahorros</option><option>corriente</option><option>cuenta simple</option></select>
          </div>
          <div class="field" style="flex:1"><label for="bkCur">Moneda</label>
            <select id="bkCur"><option>USD</option><option>EUR</option><option>MXN</option></select>
          </div>
        </div>
        <div class="field"><label for="bkNumber">Número de cuenta *</label><input id="bkNumber" inputmode="numeric"></div>
        <div class="field"><label for="bkHolder">Titular *</label><input id="bkHolder"></div>
        <div class="field"><label for="bkNotes">Instrucciones para el cliente</label>
          <textarea id="bkNotes" rows="2" placeholder="Transferencia o depósito a esta cuenta"></textarea>
        </div>
      </div>`,
    foot: `<button class="btn primary" id="bkSave">Guardar cuenta</button>
           <button class="btn ghost" id="bkCancel">Cancelar</button>`,
  });
  $('#bkCancel').onclick = closeDrawer;
  $('#bkSave').onclick = async (e) => {
    const btn = e.currentTarget;
    const payload = {
      bank: $('#bkBank').value.trim(),
      account_type: $('#bkType').value,
      currency: $('#bkCur').value,
      account_number: $('#bkNumber').value.trim(),
      holder: $('#bkHolder').value.trim(),
      instructions: $('#bkNotes').value.trim() || null,
    };
    if (!payload.bank || !payload.account_number || !payload.holder) {
      return toast('Banco, número y titular son obligatorios', 'err');
    }
    btn.disabled = true;
    const { error } = await sb.from('ts_bank_accounts').insert(payload);
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast('Cuenta agregada');
    closeDrawer();
    renderSettings();
  };
});

$('#bankList').addEventListener('click', async (e) => {
  const tog = e.target.closest('[data-bank-toggle]');
  const del = e.target.closest('[data-bank-del]');
  if (tog) {
    const activar = tog.dataset.active === 'false';
    const { error } = await sb.from('ts_bank_accounts').update({ active: activar }).eq('id', tog.dataset.bankToggle);
    if (error) return toast(errMessage(error), 'err');
    renderSettings();
  }
  if (del) {
    if (!confirm('¿Eliminar esta cuenta bancaria?')) return;
    const { error } = await sb.from('ts_bank_accounts').delete().eq('id', del.dataset.bankDel);
    if (error) return toast(errMessage(error), 'err');
    toast('Cuenta eliminada');
    renderSettings();
  }
});

/* ---------------- cotizaciones ---------------- */
const QSTATUS_LABEL = {
  borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada',
  rechazada: 'Rechazada', vencida: 'Vencida', convertida: 'Convertida',
};

let quoteCart = [];

async function renderQuotes() {
  const tbody = $('#quotesTable').querySelector('tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="small muted">Cargando…</td></tr>';

  const { data, error } = await sb
    .from('ts_quotes')
    .select('*, ts_quote_items(qty)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    tbody.innerHTML = '';
    return toast(errMessage(error), 'err');
  }
  state.quotes = data || [];

  const filter = state.quoteFilter || 'all';
  const rows = state.quotes.filter((q) => filter === 'all' || q.status === filter);

  tbody.innerHTML = rows
    .map((q) => {
      const items = (q.ts_quote_items || []).reduce((n, i) => n + i.qty, 0);
      return `<tr>
        <td class="mono">${esc(q.code)}</td>
        <td>${esc(q.customer_name)}<div class="small muted">${esc(q.customer_phone || '')}</div></td>
        <td class="small">${q.valid_until || '—'}</td>
        <td class="num">${money(q.total)}</td>
        <td><span class="badge ${q.status === 'convertida' ? 'entregado' : q.status === 'aceptada' ? 'pagado' : 'pendiente_pago'}">${QSTATUS_LABEL[q.status] || q.status}</span></td>
        <td class="row" style="gap:.3rem">
          <button class="btn sm" data-q-print="${q.id}">Imprimir</button>
          ${q.status === 'convertida'
            ? ''
            : `<button class="btn sm primary" data-q-convert="${q.id}">A pedido</button>
               <button class="btn sm ghost" data-q-edit="${q.id}">Editar</button>`}
        </td>
      </tr>`;
    })
    .join('');
  $('#quotesEmpty').hidden = rows.length > 0;
}

$('#quoteTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-qstatus]');
  if (!b) return;
  state.quoteFilter = b.dataset.qstatus;
  $$('#quoteTabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
  renderQuotes();
});

$('#quotesTable').addEventListener('click', async (e) => {
  const print = e.target.closest('[data-q-print]');
  const conv = e.target.closest('[data-q-convert]');
  const edit = e.target.closest('[data-q-edit]');

  if (print) window.open(`cotizacion.html?id=${print.dataset.qPrint}`, '_blank');
  if (edit) return openQuoteEditor(edit.dataset.qEdit);
  if (conv) {
    const q = state.quotes.find((x) => x.id === conv.dataset.qConvert);
    if (!confirm(`Convertir ${q?.code} en pedido? Se creará un pedido pendiente de pago.`)) return;
    const { data: order, error } = await sb.rpc('ts_quote_convert', { p_quote_id: conv.dataset.qConvert });
    if (error) return toast(errMessage(error), 'err');
    toast(`Pedido ${order.code} creado desde ${q?.code}`);
    await loadOrders();
    renderQuotes();
    renderOrders();
  }
});

async function openQuoteEditor(quoteId = null) {
  const saleSettings = (state.settings || (await loadSettings())).sales || {};
  quoteCart = [];

  let quote = null;
  if (quoteId) {
    const [{ data: q }, { data: items }] = await Promise.all([
      sb.from('ts_quotes').select('*').eq('id', quoteId).maybeSingle(),
      sb.from('ts_quote_items').select('*').eq('quote_id', quoteId),
    ]);
    quote = q;
    quoteCart = (items || []).map((i) => ({
      id: i.product_id, sku: i.sku, name: i.name, price: Number(i.unit_price), qty: i.qty,
    }));
  }

  const products = state.products;
  openDrawer({
    title: quote ? quote.code : 'Nueva cotización',
    subtitle: quote ? 'Editar cotización' : 'Propuesta de precio para el cliente',
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="field"><label for="qName">Cliente *</label><input id="qName" value="${esc(quote?.customer_name || '')}"></div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="qPhone">Teléfono</label><input id="qPhone" value="${esc(quote?.customer_phone || '')}"></div>
          <div class="field" style="flex:1"><label for="qEmail">Correo</label><input id="qEmail" value="${esc(quote?.customer_email || '')}"></div>
        </div>
        <div class="field"><label for="qAddr">Dirección</label><input id="qAddr" value="${esc(quote?.customer_address || '')}"></div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="qDiscount">Descuento %</label>
            <input id="qDiscount" type="number" min="0" max="100" step="0.5" value="${quote?.discount ?? 0}">
          </div>
          <div class="field" style="flex:1"><label for="qDays">Validez (días)</label>
            <input id="qDays" type="number" min="1" max="120" value="${saleSettings.quote_valid_days || 15}">
          </div>
        </div>
        <div class="field"><label for="qNotes">Notas / condiciones</label>
          <textarea id="qNotes" rows="2">${esc(quote?.notes || '')}</textarea>
        </div>
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3>Productos</h3>
        <div class="field"><input id="qSearch" placeholder="Buscar producto o escanear…"></div>
        <div class="pos-products" id="qProducts" style="max-height:220px"></div>
      </div>

      <div class="panel">
        <h3>Líneas</h3>
        <div id="qLines"></div>
        <p class="small muted" id="qLinesEmpty">Aún no hay productos.</p>
        <div class="pos-total"><span>Total</span><span id="qTotal">$0.00</span></div>
        <div class="small muted" id="qTaxLine"></div>
      </div>`,
    foot: `<button class="btn primary" id="qSave">Guardar cotización</button>
           <button class="btn ghost" id="qCancel">Cancelar</button>`,
  });

  const drawProducts = () => {
    const term = ($('#qSearch').value || '').toLowerCase();
    $('#qProducts').innerHTML = products
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .slice(0, 40)
      .map((p) => `<button class="pos-tile" data-q-add="${p.id}">
        <div class="n">${esc(p.name)}</div><div class="p">${money(p.price)}</div>
        <div class="s">${esc(p.sku)}</div></button>`)
      .join('');
  };

  const drawLines = () => {
    $('#qLines').innerHTML = quoteCart
      .map((i, idx) => `<div class="ticket-line">
        <div><div class="tl-name">${esc(i.name)}</div><div class="tl-sub">${esc(i.sku)} · ${money(i.price)}</div></div>
        <div class="tl-right">
          <div class="qty-box">
            <button data-q-dec="${idx}">−</button><span>${i.qty}</span><button data-q-inc="${idx}">+</button>
          </div>
          <div class="amount">${money(i.price * i.qty)}</div>
          <button class="btn ghost sm" data-q-del="${idx}">✕</button>
        </div>
      </div>`)
      .join('');
    $('#qLinesEmpty').hidden = quoteCart.length > 0;

    const subtotal = quoteCart.reduce((n, i) => n + i.price * i.qty, 0);
    const disc = Number($('#qDiscount').value || 0);
    const base = subtotal * (1 - disc / 100);
    const rate = Number(saleSettings.tax_rate || 0);
    const included = saleSettings.tax_included !== false;
    const tax = rate > 0 ? (included ? base - base / (1 + rate / 100) : base * rate / 100) : 0;
    const total = rate > 0 && !included ? base + tax : base;
    $('#qTotal').textContent = money(total);
    $('#qTaxLine').textContent = rate > 0
      ? `Subtotal ${money(subtotal)} · descuento ${disc}% · impuesto ${rate}% ${included ? '(incluido)' : '(sumado)'}: ${money(tax)}`
      : `Subtotal ${money(subtotal)} · descuento ${disc}%`;
  };

  $('#qSearch').addEventListener('input', drawProducts);
  $('#qDiscount').addEventListener('input', drawLines);

  $('#qProducts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q-add]');
    if (!b) return;
    const p = products.find((x) => x.id === b.dataset.qAdd);
    const found = quoteCart.find((i) => i.id === p.id);
    if (found) found.qty += 1;
    else quoteCart.push({ id: p.id, sku: p.sku, name: p.name, price: Number(p.price), qty: 1 });
    drawLines();
  });

  $('#qLines').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-q-inc]');
    const dec = e.target.closest('[data-q-dec]');
    const del = e.target.closest('[data-q-del]');
    if (inc) quoteCart[Number(inc.dataset.qInc)].qty += 1;
    else if (dec) {
      const i = Number(dec.dataset.qDec);
      quoteCart[i].qty -= 1;
      if (quoteCart[i].qty <= 0) quoteCart.splice(i, 1);
    } else if (del) quoteCart.splice(Number(del.dataset.qDel), 1);
    else return;
    drawLines();
  });

  $('#qCancel').onclick = closeDrawer;

  $('#qSave').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!quoteCart.length) return toast('Agrega al menos un producto', 'err');
    if (!$('#qName').value.trim()) return toast('Falta el nombre del cliente', 'err');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const { data, error } = await sb.rpc('ts_quote_save', {
      p_quote_id: quote ? quote.id : null,
      p_customer: {
        name: $('#qName').value.trim(),
        phone: $('#qPhone').value.trim(),
        email: $('#qEmail').value.trim(),
        address: $('#qAddr').value.trim(),
      },
      p_items: quoteCart.map((i) => ({ product_id: i.id, qty: i.qty })),
      p_valid_days: Number($('#qDays').value || 15),
      p_notes: $('#qNotes').value.trim() || null,
      p_discount: Number($('#qDiscount').value || 0),
      p_status: quote ? quote.status : 'borrador',
    });

    if (error) {
      toast(errMessage(error), 'err');
      btn.disabled = false;
      btn.textContent = 'Guardar cotización';
      return;
    }
    toast(`Cotización ${data.code} guardada`);
    closeDrawer();
    await renderQuotes();
  };

  drawProducts();
  drawLines();
}

$('#btnNewQuote').addEventListener('click', () => openQuoteEditor(null));

/* ---------------- usuarios y roles ---------------- */
const ROLE_LABEL = { admin: 'Administrador', operador: 'Operador', cliente: 'Cliente' };

function randomPassword(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('');
}

function showCredentials({ email, password, role, name }) {
  const host = $('#userCreds');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <h3>Credenciales generadas</h3>
    <p class="small muted">Guárdalas ahora: la contraseña no se puede volver a mostrar.</p>
    <div class="mono" style="font-size:.95rem;line-height:1.9">
      <div>Correo: <b>${esc(email)}</b></div>
      <div>Contraseña: <b>${esc(password)}</b></div>
      <div>Rol: <b>${esc(ROLE_LABEL[role] || role)}</b>${name ? ` · ${esc(name)}` : ''}</div>
    </div>
    <div class="row" style="margin-top:.8rem">
      <button class="btn primary sm" id="copyCreds">Copiar todo</button>
      <button class="btn ghost sm" id="hideCreds">Ocultar</button>
    </div>`;
  $('#copyCreds').onclick = async () => {
    const text = `${name || ''}\nCorreo: ${email}\nContraseña: ${password}\nRol: ${ROLE_LABEL[role] || role}\nPanel: https://compratelosv.github.io/techstore/admin.html`;
    try {
      await navigator.clipboard.writeText(text.trim());
      toast('Credenciales copiadas');
    } catch {
      toast('No se pudo copiar: selecciónalas a mano', 'err');
    }
  };
  $('#hideCreds').onclick = () => { host.hidden = true; };
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function renderUsers() {
  if (state.profile?.role !== 'admin') {
    toast('Solo el administrador puede ver los usuarios', 'err');
    return setView('orders');
  }
  const tbody = $('#usersTable').querySelector('tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="small muted">Cargando…</td></tr>';

  const { data, error } = await sb.rpc('ts_admin_list_users');
  if (error) {
    tbody.innerHTML = '';
    return toast(errMessage(error), 'err');
  }

  tbody.innerHTML = (data || [])
    .map((u) => {
      const self = u.id === state.profile.id;
      return `<tr>
        <td>${esc(u.full_name || '—')}${self ? ' <span class="small muted">(tú)</span>' : ''}</td>
        <td class="small mono">${esc(u.email || '')}</td>
        <td>
          <select class="btn sm" data-role="${u.id}" ${self ? 'disabled' : ''}>
            ${['admin', 'operador', 'cliente']
              .map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`)
              .join('')}
          </select>
        </td>
        <td>${u.active
          ? '<span class="badge entregado">Activo</span>'
          : '<span class="badge cancelado">Inactivo</span>'}</td>
        <td class="small muted">${u.last_sign_in ? fmtDate(u.last_sign_in) : 'nunca'}</td>
        <td class="row" style="gap:.35rem">
          <button class="btn sm" data-reset="${u.id}" data-email="${esc(u.email || '')}">Contraseña</button>
          ${self ? '' : `<button class="btn sm ${u.active ? 'danger' : ''}" data-toggle="${u.id}" data-active="${u.active}">
              ${u.active ? 'Desactivar' : 'Activar'}
            </button>`}
        </td>
      </tr>`;
    })
    .join('');
}

$('#usersTable').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  const { error } = await sb.rpc('ts_admin_set_user_role', {
    p_user_id: sel.dataset.role,
    p_role: sel.value,
  });
  if (error) {
    toast(errMessage(error), 'err');
    return renderUsers();
  }
  toast('Rol actualizado');
  await renderUsers();
});

$('#usersTable').addEventListener('click', async (e) => {
  const reset = e.target.closest('[data-reset]');
  const toggle = e.target.closest('[data-toggle]');

  if (reset) {
    const password = randomPassword();
    const { error } = await sb.rpc('ts_admin_reset_password', {
      p_user_id: reset.dataset.reset,
      p_password: password,
    });
    if (error) return toast(errMessage(error), 'err');
    toast('Contraseña restablecida');
    showCredentials({ email: reset.dataset.email, password, role: 'operador' });
    await renderUsers();
  }

  if (toggle) {
    const activar = toggle.dataset.active === 'false';
    if (!activar && !confirm('¿Desactivar esta cuenta? No podrá iniciar sesión hasta que la reactives.')) return;
    const { error } = await sb.rpc('ts_admin_set_user_active', {
      p_user_id: toggle.dataset.toggle,
      p_active: activar,
    });
    if (error) return toast(errMessage(error), 'err');
    toast(activar ? 'Cuenta activada' : 'Cuenta desactivada');
    await renderUsers();
  }
});

$('#btnNewUser').addEventListener('click', () => {
  const password = randomPassword();
  openDrawer({
    title: 'Nuevo usuario',
    subtitle: 'Alta de miembro del equipo',
    body: `
      <div class="panel">
        <div class="field">
          <label for="uName">Nombre completo *</label>
          <input id="uName" placeholder="Ana Martínez">
        </div>
        <div class="field">
          <label for="uEmail">Correo *</label>
          <input id="uEmail" type="email" placeholder="ana@tunegocio.com" autocomplete="off">
        </div>
        <div class="field">
          <label for="uPhone">Teléfono</label>
          <input id="uPhone" inputmode="tel" placeholder="7000 0000">
        </div>
        <div class="field">
          <label for="uRole">Rol *</label>
          <select id="uRole">
            <option value="operador" selected>Operador — ventas y logística</option>
            <option value="admin">Administrador — acceso total</option>
          </select>
        </div>
        <div class="field">
          <label for="uPass">Contraseña temporal *</label>
          <div class="row">
            <input id="uPass" value="${password}">
            <button class="btn sm" id="uGenPass" type="button" title="Generar otra">⟳</button>
          </div>
          <span class="small muted">Mínimo 8 caracteres. La persona debe cambiarla después.</span>
        </div>
      </div>`,
    foot: `<button class="btn primary" id="uSave">Crear usuario</button>
           <button class="btn ghost" id="uCancel">Cancelar</button>`,
  });

  $('#uGenPass').onclick = () => { $('#uPass').value = randomPassword(); };
  $('#uCancel').onclick = closeDrawer;

  $('#uSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Creando…';
    const payload = {
      p_email: $('#uEmail').value.trim(),
      p_password: $('#uPass').value,
      p_full_name: $('#uName').value.trim(),
      p_role: $('#uRole').value,
      p_phone: $('#uPhone').value.trim() || null,
    };
    if (!payload.p_email || !payload.p_full_name) {
      toast('Nombre y correo son obligatorios', 'err');
      btn.disabled = false;
      btn.textContent = 'Crear usuario';
      return;
    }
    const { error } = await sb.rpc('ts_admin_create_user', payload);
    if (error) {
      toast(errMessage(error), 'err');
      btn.disabled = false;
      btn.textContent = 'Crear usuario';
      return;
    }
    closeDrawer();
    toast('Usuario creado');
    showCredentials({
      email: payload.p_email,
      password: payload.p_password,
      role: payload.p_role,
      name: payload.p_full_name,
    });
    await renderUsers();
  };
});

/* ---------------- ventas ---------------- */
function pct(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function deltaBadge(value) {
  if (value === null) return '<span class="small muted">sin periodo previo</span>';
  const up = value >= 0;
  const color = up ? 'var(--ok)' : 'var(--bad)';
  return `<span class="small" style="color:${color};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%</span>`;
}

function emptyDays(fromDate, days) {
  const out = [];
  const start = new Date(`${fromDate}T00:00:00`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function chartSvg(daily, fromDate, days) {
  const map = new Map((daily || []).map((d) => [String(d.day).slice(0, 10), Number(d.revenue)]));
  const series = emptyDays(fromDate, days).map((day) => ({
    day,
    revenue: map.get(day) || 0,
  }));
  const max = Math.max(...series.map((s) => s.revenue), 1);
  const W = 820;
  const H = 230;
  const padL = 46;
  const padB = 28;
  const padT = 12;
  const plotW = W - padL - 12;
  const plotH = H - padB - padT;
  const bw = plotW / series.length;
  const barW = Math.max(2, Math.min(28, bw * 0.62));
  const step = Math.ceil(series.length / 8);

  const bars = series
    .map((s, i) => {
      const h = (s.revenue / max) * plotH;
      const x = padL + i * bw + (bw - barW) / 2;
      const y = padT + plotH - h;
      const label = s.revenue > 0
        ? `<title>${s.day}: ${money(s.revenue)}</title>`
        : `<title>${s.day}: sin ventas</title>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
                 rx="2" fill="${s.revenue > 0 ? '#6366f1' : '#1f2a44'}">${label}</rect>`;
    })
    .join('');

  const guides = [0, 0.5, 1]
    .map((frac) => {
      const y = padT + plotH - frac * plotH;
      return `<line x1="${padL}" y1="${y}" x2="${W - 12}" y2="${y}" stroke="#25314e" stroke-width="1" stroke-dasharray="3 4"/>
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#93a0bd">${money(max * frac).replace('.00', '')}</text>`;
    })
    .join('');

  const labels = series
    .map((s, i) => {
      if (i % step !== 0) return '';
      const x = padL + i * bw + bw / 2;
      return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#93a0bd">${s.day.slice(5)}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="230" preserveAspectRatio="none" role="img" aria-label="Ventas por día">
    ${guides}${bars}${labels}
  </svg>`;
}

function breakdown(rows, labelKey, valueKey) {
  const total = rows.reduce((n, r) => n + Number(r[valueKey] || 0), 0);
  if (!rows.length) return '<p class="small muted">Sin datos.</p>';
  return rows
    .map((r) => {
      const share = total ? (Number(r[valueKey]) / total) * 100 : 0;
      return `
        <div style="margin-bottom:.55rem">
          <div class="row" style="justify-content:space-between;font-size:.84rem">
            <span>${esc(String(r[labelKey]))}</span>
            <b>${money(r[valueKey])}</b>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:999px;overflow:hidden;margin-top:.25rem">
            <div style="width:${share.toFixed(1)}%;height:100%;background:var(--accent)"></div>
          </div>
          <div class="small muted" style="font-size:.72rem">${share.toFixed(0)}%</div>
        </div>`;
    })
    .join('');
}

async function renderSales() {
  const days = state.salesDays || 30;
  $('#salesKpis').innerHTML = '<div class="kpi"><span>Cargando</span><b>…</b></div>';

  const { data, error } = await sb.rpc('ts_sales_summary', { p_days: days });
  if (error) {
    $('#salesKpis').innerHTML = '';
    toast(errMessage(error), 'err');
    return;
  }
  state.salesData = data;

  const t = data.totals || {};
  const p = data.previous || {};
  const shareDelta = pct(Number(t.revenue), Number(p.revenue));
  const ordersDelta = pct(Number(t.orders), Number(p.orders));

  $('#salesKpis').innerHTML = `
    <div class="kpi"><span>Ingresos</span><b>${money(t.revenue)}</b>${deltaBadge(shareDelta)}</div>
    <div class="kpi"><span>Pedidos</span><b>${t.orders || 0}</b>${deltaBadge(ordersDelta)}</div>
    <div class="kpi"><span>Ticket promedio</span><b>${money(t.avg_ticket)}</b></div>
    <div class="kpi"><span>Unidades vendidas</span><b>${t.units || 0}</b></div>
    <div class="kpi"><span>Margen bruto</span><b>${money(t.margin)}</b>
      <span class="small muted" style="text-transform:none;letter-spacing:0">costo ${money(t.cost)}</span></div>`;

  $('#salesChart').innerHTML = chartSvg(data.daily, data.from_date, days);
  $('#salesChartSub').innerHTML =
    `${data.from_date} → ${data.to_date} · productos ${money(t.products)} + envíos ${money(t.shipping)} = <b>${money(t.revenue)}</b>`;

  const top = data.top_products || [];
  $('#salesTop').querySelector('tbody').innerHTML = top
    .map(
      (r) => `<tr>
        <td>${esc(r.name)}</td>
        <td class="mono small">${esc(r.sku)}</td>
        <td class="num">${r.units}</td>
        <td class="num">${money(r.revenue)}</td>
      </tr>`
    )
    .join('');
  $('#salesTopEmpty').hidden = top.length > 0;

  $('#salesChannel').innerHTML = breakdown(data.by_channel || [], 'channel', 'revenue');
  $('#salesPayment').innerHTML = breakdown(data.by_payment || [], 'provider', 'revenue');
}

$('#salesRange').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-days]');
  if (!btn) return;
  state.salesDays = Number(btn.dataset.days);
  $$('#salesRange .tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderSales();
});

$('#salesExport').addEventListener('click', () => {
  const d = state.salesData;
  if (!d) return toast('Abre el reporte primero', 'err');
  const map = new Map((d.daily || []).map((r) => [String(r.day).slice(0, 10), r]));
  const rows = [['dia', 'ingresos', 'pedidos']];
  for (const day of emptyDays(d.from_date, d.salesDays || state.salesDays || 30)) {
    const r = map.get(day);
    rows.push([day, r ? Number(r.revenue).toFixed(2) : '0.00', r ? r.orders : 0]);
  }
  const csv = rows.map((r) => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ventas-${d.from_date}-a-${d.to_date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV descargado');
});

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
