/* admin.js — shell del panel: pedidos, preparación e inventario */
import { sb, money, esc, toast, fmtDate, errMessage, STATUS_LABEL, getUser } from './core.js';
import { initPos } from './pos.js';

/* ---------------- estado ---------------- */
const state = {
  view: 'orders',
  orders: [],
  products: [],
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
  await refreshAll();
  initPos({ sb, money, esc, toast, errMessage });
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

function setView(view) {
  state.view = view;
  $$('#sideNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['orders', 'fulfillment', 'pos', 'inventory'].forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
  });
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];
  if (view === 'orders') renderOrders();
  if (view === 'fulfillment') renderKanban();
  if (view === 'inventory') renderInventory();
  if (view === 'pos') renderPos();
}

async function refreshAll() {
  await Promise.all([loadOrders(), loadProducts()]);
  renderOrders();
  renderKanban();
  renderInventory();
  renderPos();
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
        <td><button class="btn sm" data-inv="${p.id}">Ajustar</button></td>
      </tr>`)
    .join('');

  $('#invTable').onclick = (e) => {
    const b = e.target.closest('[data-inv]');
    if (b) openInventory(b.dataset.inv);
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

/* ---------------- POS (delegado) ---------------- */
function renderPos() {
  if (state.products.length) {
    initPos({ sb, money, esc, toast, errMessage });
  }
}

boot().catch((err) => toast(errMessage(err), 'err'));
