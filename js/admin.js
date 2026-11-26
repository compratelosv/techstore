/* admin.js — shell del panel: pedidos, preparación e inventario */
import { sb, money, esc, toast, fmtDate, errMessage, STATUS_LABEL, getUser, loadCurrency, loadTheme, applyTheme, getCurrency, openDrawerUI, closeDrawerUI, initDrawerDismiss } from './core.js?v=3b15e8e6';
import { initPos, scanOnce, scanStream, stopScan, scanFeedback } from './pos.js?v=556f86f2';
import { Scanner } from './scanner.js?v=90ef2e67';
import { initMarketing, loadMarketing, renderMarketing, renderEditorial, renderContent, renderMetrics } from './marketing.js?v=7ad6e894';
import { initRequisitions, loadRequisitions, renderRequisitions } from './requisitions.js?v=08a54485';
import { initIncidents, loadIncidents, renderIncidents, openDamageForm, openIncident } from './incidents.js?v=414f354f';
import { initSupport, loadCases, renderCases } from './support.js?v=d2569642';
import { initFiscal, loadFiscal } from './fiscal.js?v=c8826954';

/* ---------------- estado ---------------- */
const state = {
  view: 'orders',
  orders: [],
  products: [],
  categories: [],
  statusFilter: 'all',
  search: '',
  sortKey: 'created_at',
  sortDir: 'desc',
  channel: 'all',
  fulfillment: 'all',
  dateFrom: '',
  dateTo: '',
  grouped: false,
  profile: null,
  salesDays: 30,
  salesData: null,
  settings: null,
  quotes: [],
  quoteFilter: 'all',
  banks: [],
  customers: [],
  suppliers: [],
  purchases: [],
  couriers: [],
  deliveries: [],
  delFilter: 'today',
  cash: null,
  promos: [],
  agenda: [],
  calDate: null,
  calMode: 'month',
  calEvents: [],
  calSlots: [],
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
  drawer.classList.remove('hidden');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  openDrawerUI();
  $('#dBody').scrollTop = 0;
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  closeDrawerUI();
}
$('#dClose').onclick = closeDrawer;
initDrawerDismiss();

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
  if (!profile || !['admin', 'operador', 'cajero', 'transportista', 'community_manager'].includes(profile.role)) {
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
  await loadTheme();
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
  if (profile.must_change_password) maybeForcePasswordChange();

  // La sección de usuarios es solo para el administrador.
  const isAdmin = profile.role === 'admin';
  const isCourier = profile.role === 'transportista';
  const isCM = profile.role === 'community_manager';
  const isCashier = profile.role === 'cajero';
  const canMarketing = isAdmin || isCM;
  // El cajero solo ve sala de ventas: POS, caja y clientes.
  if (isCashier) {
    const allowed = ['pos', 'cash', 'customers'];
    $$('#sideNav button').forEach((b) => b.classList.toggle('hidden', !allowed.includes(b.dataset.view)));
    $$('.nav-group').forEach((g) => {
      g.hidden = g.querySelectorAll('button:not(.hidden)').length === 0;
    });
  }
  $('#navUsers').classList.toggle('hidden', !isAdmin);
  $('#navPromos').classList.toggle('hidden', !isAdmin);
  $('#navSuppliers').classList.toggle('hidden', !isAdmin);
  $('#navSettings').classList.toggle('hidden', !isAdmin);
  $('#navInventory')?.classList.toggle('hidden', !isAdmin);
  $('#navDeliveries').classList.toggle('hidden', !isCourier);
  const growth = $('#navGrowth');
  if (growth) growth.hidden = !canMarketing;

  // El personal operativo (repartidor, cajero) no sale a la tienda desde el panel.
  const lnkShop = document.getElementById('lnkShop');
  if (lnkShop) lnkShop.hidden = !(isAdmin || isCM);

  // El community manager entra solo a marketing: nada de pedidos, dinero ni inventario.
  if (isCM) {
    const allowed = ['marketing', 'editorial', 'content', 'metrics'];
    $$('#sideNav button').forEach((b) => b.classList.toggle('hidden', !allowed.includes(b.dataset.view)));
    $$('.nav-group').forEach((g) => {
      g.hidden = g.querySelectorAll('button:not(.hidden)').length === 0;
    });
    await loadSettings();
    initMarketing();
    const t = viewFromHash();
    setView(allowed.includes(t) ? t : 'marketing');
    return;
  }

  // El transportista solo entra a sus entregas: nada de costos, ventas ni clientes.
  if (isCourier) {
    $$('#sideNav button').forEach((b) => b.classList.toggle('hidden', b.dataset.view !== 'deliveries'));
    $$('.nav-group').forEach((g) => {
      g.hidden = g.querySelectorAll('button:not(.hidden)').length === 0;
    });
    await loadSettings();
    setView('deliveries');
    return;
  }

  await loadSettings();
  loadOrderPrefs();
  await refreshAll();
  initPos({ sb, money, esc, toast, errMessage });
  initMarketing();
  initRequisitions(isAdmin);
  initIncidents(isAdmin);
  initSupport();
  initFiscal();
  const target = viewFromHash();
  if (isCashier) {
    setView(['pos', 'cash', 'customers'].includes(target) ? target : 'pos');
  } else if (target === 'deliveries' || (target === 'users' && !isAdmin)) {
    setView('orders');
  } else {
    setView(target);
  }
}

function maybeForcePasswordChange() {
  openDrawer({
    title: 'Cambia tu contraseña',
    subtitle: 'Entraste con una clave temporal. Elige una nueva para continuar.',
    body: `
      <div class="panel">
        <div class="field"><label for="cpNew">Nueva contraseña *</label>
          <input id="cpNew" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
        <div class="field"><label for="cpRepeat">Repite la contraseña *</label>
          <input id="cpRepeat" type="password" autocomplete="new-password"></div>
        <p class="small muted">No puede ser igual a la temporal que te entregaron.</p>
      </div>`,
    foot: `<button class="btn primary" id="cpGo">Guardar y entrar</button>`,
  });
  $('#cpGo').onclick = async () => {
    const a = $('#cpNew').value || '';
    const b = $('#cpRepeat').value || '';
    if (a.length < 8) return toast('La contraseña debe tener al menos 8 caracteres', 'err');
    if (a !== b) return toast('Las contraseñas no coinciden', 'err');
    const btn = $('#cpGo');
    btn.disabled = true;
    const { error } = await sb.rpc('ts_self_change_password', { p_password: a });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    if (state.profile) state.profile.must_change_password = false;
    closeDrawer();
    toast('Contraseña actualizada');
  };
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
  cash: ['Caja', 'Turno abierto, arqueo y diferencia'],
  agenda: ['Calendario de entregas', 'Tus días de reparto, confirmaciones y plan de ruta'],
  promos: ['Promociones', 'Cupones, descuentos por temporada y cupón de bienvenida'],
  sales: ['Ventas', 'Ingresos, ticket promedio, margen y productos más vendidos'],
  quotes: ['Cotizaciones', 'Propuestas de precio para clientes, listas para enviar'],
  deliveries: ['Mis entregas', 'Pedidos asignados a ti: sal a ruta y marca la entrega'],
  customers: ['Clientes', 'Quién compra, cuánto gasta y qué notas dejó el equipo'],
  suppliers: ['Proveedores', 'A quién le compras y qué mercancía viene en camino'],
  users: ['Usuarios', 'Quién entra al panel y con qué rol'],
  settings: ['Configuración', 'Negocio, apariencia, cobros y redes sociales'],
  inventory: ['Inventario', 'Stock, precios y movimientos'],
  requisitions: ['Requisiciones', 'Compras y servicios: solicitud, aprobación del CEO, recepción y pago'],
  incidents: ['Contingencias', 'Daños antes de la entrega: gravedad, aviso al cliente y resolución'],
  support: ['Soporte', 'Casos de atención al cliente con folio, plazo y cierre con resolución'],
  fiscal: ['Facturación', 'Datos fiscales del negocio y emisión electrónica ante Hacienda'],
  marketing: ['Marketing', 'Redes del negocio, audiencia y estado de conexión'],
  editorial: ['Calendario editorial', 'Qué se publica cada día y en qué estado está'],
  content: ['Contenido', 'Piezas, borradores y publicaciones'],
  metrics: ['Métricas', 'Alcance e interacción de lo que ya publicaste'],
};

// enlaces directos: admin.html#pedidos, #preparacion, #pos, #cotizaciones, #ventas, #usuarios, #configuracion, #inventario
const HASH_TO_VIEW = {
  pedidos: 'orders', orders: 'orders',
  preparacion: 'fulfillment', fulfillment: 'fulfillment',
  pos: 'pos',
  caja: 'cash', cash: 'cash',
  citas: 'agenda', agenda: 'agenda',
  promos: 'promos', promociones: 'promos',
  cotizaciones: 'quotes', quotes: 'quotes',
  entregas: 'deliveries', deliveries: 'deliveries',
  clientes: 'customers', customers: 'customers',
  proveedores: 'suppliers', suppliers: 'suppliers',
  ventas: 'sales', sales: 'sales',
  usuarios: 'users', users: 'users',
  configuracion: 'settings', settings: 'settings',
  inventario: 'inventory', inventory: 'inventory',
  requisiciones: 'requisitions', requisitions: 'requisitions',
  contingencias: 'incidents', incidents: 'incidents', soporte: 'support', support: 'support',
  facturacion: 'fiscal', fiscal: 'fiscal',
  marketing: 'marketing', editorial: 'editorial',
  contenido: 'content', content: 'content',
  metricas: 'metrics', metrics: 'metrics', metricas_marketing: 'metrics',
};
const VIEW_TO_HASH = {
  orders: 'pedidos', fulfillment: 'preparacion', pos: 'pos', cash: 'caja',
  agenda: 'citas', promos: 'promos', quotes: 'cotizaciones',
  deliveries: 'entregas',
  customers: 'clientes', suppliers: 'proveedores',
  sales: 'ventas', users: 'usuarios', settings: 'configuracion', inventory: 'inventario',
  requisitions: 'requisiciones', incidents: 'contingencias',
  marketing: 'marketing', editorial: 'editorial', content: 'contenido', metrics: 'metricas',
};

function viewFromHash() {
  const key = (location.hash || '').replace('#', '').trim().toLowerCase();
  return HASH_TO_VIEW[key] || 'orders';
}

function setView(view, { syncHash = true } = {}) {
  // El community manager solo entra a marketing, aunque escriba otro hash.
  if (state.profile?.role === 'community_manager') {
    const allowed = ['marketing', 'editorial', 'content', 'metrics'];
    if (!allowed.includes(view)) {
      view = 'marketing';
      syncHash = true;
    }
  }
  // Solo el CEO entra a inventario, promos, proveedores, usuarios y configuración,
  // aunque escriba el hash a mano.
  if (state.profile?.role !== 'admin' && ['inventory', 'promos', 'suppliers', 'users', 'settings', 'fiscal'].includes(view)) {
    view = state.profile?.role === 'cajero' ? 'pos' : 'orders';
    syncHash = true;
  }
  // El cajero no sale de sala de ventas.
  if (state.profile?.role === 'cajero' && !['pos', 'cash', 'customers'].includes(view)) {
    view = 'pos';
    syncHash = true;
  }
  state.view = view;
  $$('#sideNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['orders', 'fulfillment', 'deliveries', 'pos', 'cash', 'agenda', 'promos', 'quotes', 'customers', 'suppliers', 'sales', 'users', 'settings', 'inventory', 'marketing', 'editorial', 'content', 'metrics', 'requisitions', 'incidents', 'support', 'fiscal'].forEach((v) => {
    const sec = $(`#view-${v}`);
    if (sec) sec.classList.toggle('hidden', v !== view);
  });
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];
  if (syncHash && location.hash !== `#${VIEW_TO_HASH[view]}`) {
    history.replaceState(null, '', `#${VIEW_TO_HASH[view]}`);
  }
  closeMobileMenu();
  if (view === 'orders') renderOrders();
  if (view === 'fulfillment') renderKanban();
  if (view === 'deliveries') renderDeliveries();
  if (view === 'inventory') renderInventory();
  if (view === 'requisitions') loadRequisitions().then(() => renderRequisitions(state.profile?.role === 'admin'));
  if (view === 'incidents') loadIncidents().then(() => renderIncidents());
  if (view === 'pos') renderPos();
  if (view === 'cash') renderCash();
  if (view === 'agenda') { renderCalendar(); }
  if (view === 'promos') renderPromos();
  if (view === 'sales') renderSales();
  if (view === 'quotes') renderQuotes();
  if (view === 'customers') renderCustomers();
  if (view === 'support') loadCases().then(renderCases);
  if (view === 'fiscal') loadFiscal();
  if (view === 'marketing') loadMarketing().then(renderMarketing);
  if (view === 'editorial') loadMarketing().then(renderEditorial);
  if (view === 'content') loadMarketing().then(renderContent);
  if (view === 'metrics') loadMarketing().then(renderMetrics);
  if (view === 'suppliers') renderSuppliers();
  if (view === 'users') renderUsers();
  if (view === 'settings') renderSettings();
}

window.addEventListener('hashchange', () => setView(viewFromHash(), { syncHash: false }));

async function refreshAll() {
  await Promise.all([loadOrders(), loadProducts(), loadCategories()]);
  await loadCouriers();
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
  // el costo vive en una tabla que solo ve el administrador
  if (state.profile?.role === 'admin') {
    const { data: costs } = await sb.from('ts_product_costs').select('product_id, cost');
    const map = new Map((costs || []).map((c) => [c.product_id, c.cost]));
    state.products.forEach((p) => { p.cost = map.has(p.id) ? map.get(p.id) : null; });
  }
}

/* ---------------- preferencias de la tabla de pedidos ---------------- */
const ORDER_PREFS = 'ts.orders.prefs';
function saveOrderPrefs() {
  try {
    localStorage.setItem(ORDER_PREFS, JSON.stringify({
      sortKey: state.sortKey, sortDir: state.sortDir,
      channel: state.channel, fulfillment: state.fulfillment,
      dateFrom: state.dateFrom, dateTo: state.dateTo,
      statusFilter: state.statusFilter, search: state.search, grouped: state.grouped,
    }));
  } catch { /* sin almacenamiento: se ignora */ }
}
function loadOrderPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(ORDER_PREFS) || '{}');
    if (p.sortKey) state.sortKey = p.sortKey;
    if (p.sortDir) state.sortDir = p.sortDir;
    state.channel = p.channel || 'all';
    state.fulfillment = p.fulfillment || 'all';
    state.dateFrom = p.dateFrom || '';
    state.dateTo = p.dateTo || '';
    if (p.statusFilter) state.statusFilter = p.statusFilter;
    state.search = p.search || '';
    state.grouped = !!p.grouped;
  } catch { /* prefs corruptas: se ignoran */ }
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
    const okChannel = state.channel === 'all' || (o.channel || 'online') === state.channel;
    const okFulfil = state.fulfillment === 'all' || o.fulfillment === state.fulfillment;
    const dia = (o.created_at || '').slice(0, 10);
    const okFrom = !state.dateFrom || dia >= state.dateFrom;
    const okTo = !state.dateTo || dia <= state.dateTo;
    return okStatus && okQ && okChannel && okFulfil && okFrom && okTo;
  });

  // orden por columna (clic en el encabezado)
  const SORT = {
    code: (o) => o.code || '',
    customer_name: (o) => (o.customer_name || '').toLowerCase(),
    fulfillment: (o) => (o.fulfillment === 'retiro' ? 'retiro' : (o.ship_city || 'envio')).toLowerCase(),
    total: (o) => Number(o.total) || 0,
    status: (o) => o.status || '',
    created_at: (o) => new Date(o.created_at || 0).getTime(),
  };
  const key = SORT[state.sortKey] || SORT.created_at;
  rows.sort((a, b) => {
    const va = key(a), vb = key(b);
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'es');
    return state.sortDir === 'asc' ? cmp : -cmp;
  });

  const rowHtml = (o) => `
      <tr class="order-row" data-order="${o.id}">
        <td class="mono">${esc(o.code)}</td>
        <td>${esc(o.customer_name)}<div class="small muted">${esc(o.customer_phone || '')}</div></td>
        <td>${o.fulfillment === 'retiro' ? 'Retiro' : esc(o.ship_city || 'Envío')}</td>
        <td class="num">${money(o.total)}</td>
        <td><span class="badge ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
        <td class="small muted">${fmtDate(o.created_at)}</td>
        <td><button class="btn sm ghost" data-open="${o.id}">Ver</button></td>
      </tr>`;

  const tabla = $('#ordersTable');
  const wrapTabla = $('#ordersTableWrap');
  const agrupado = $('#ordersGrouped');

  if (state.grouped) {
    // bloques colapsables por estado, conservando el orden elegido dentro de cada uno
    wrapTabla.hidden = true;
    agrupado.hidden = false;
    const grupos = new Map();
    rows.forEach((o) => {
      if (!grupos.has(o.status)) grupos.set(o.status, []);
      grupos.get(o.status).push(o);
    });
    const ORDEN = ['pendiente_pago', 'pagado', 'en_preparacion', 'listo', 'en_ruta', 'entregado', 'no_show', 'cancelado', 'reembolsado'];
    const claves = Array.from(grupos.keys())
      .sort((a, b) => (ORDEN.indexOf(a) + 1 || 99) - (ORDEN.indexOf(b) + 1 || 99));
    agrupado.innerHTML = claves.map((k) => {
      const its = grupos.get(k);
      const suma = its.reduce((n, o) => n + Number(o.total || 0), 0);
      return `<details class="order-group" open>
        <summary>
          <span class="badge ${k}">${STATUS_LABEL[k] || k}</span>
          <b style="margin:0 .35rem">${its.length}</b>
          <span class="small muted">pedido${its.length === 1 ? '' : 's'} · ${money(suma)}</span>
        </summary>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr>
              <th class="sortable" data-sort="code">Código</th>
              <th class="sortable" data-sort="customer_name">Cliente</th>
              <th class="sortable" data-sort="fulfillment">Entrega</th>
              <th class="sortable num" data-sort="total">Total</th>
              <th class="sortable" data-sort="status">Estado</th>
              <th class="sortable" data-sort="created_at">Creado</th>
              <th></th>
            </tr></thead>
            <tbody>${its.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </details>`;
    }).join('');
  } else {
    wrapTabla.hidden = false;
    agrupado.hidden = true;
    tabla.querySelector('tbody').innerHTML = rows.map(rowHtml).join('');
  }

  $('#ordersEmpty').hidden = rows.length > 0;

  // el botón refleja el modo activo
  const gbtn = $('#fGroup');
  if (gbtn) {
    gbtn.setAttribute('aria-pressed', String(state.grouped));
    gbtn.classList.toggle('primary', state.grouped);
  }

  // los controles muestran el estado real (también al volver a la vista)
  if ($('#orderSearch').value !== state.search) $('#orderSearch').value = state.search;
  if ($('#fChannel').value !== state.channel) $('#fChannel').value = state.channel;
  if ($('#fFulfillment').value !== state.fulfillment) $('#fFulfillment').value = state.fulfillment;
  if ($('#fFrom').value !== state.dateFrom) $('#fFrom').value = state.dateFrom;
  if ($('#fTo').value !== state.dateTo) $('#fTo').value = state.dateTo;

  // indicador de la columna ordenada (tabla normal y bloques agrupados)
  $$('#view-orders th.sortable').forEach((th) => {
    const on = th.dataset.sort === state.sortKey;
    th.classList.toggle('sorted', on);
    th.dataset.dir = on ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
  });
  const fc = $('#fCount');
  if (fc) fc.textContent = `${rows.length} de ${state.orders.length} pedidos`;
  saveOrderPrefs();
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

/* filtros combinados: canal, tipo de entrega y rango de fechas */
const readOrderFilters = () => {
  state.channel = $('#fChannel').value;
  state.fulfillment = $('#fFulfillment').value;
  state.dateFrom = $('#fFrom').value;
  state.dateTo = $('#fTo').value;
  renderOrders();
};
['fChannel', 'fFulfillment', 'fFrom', 'fTo'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', readOrderFilters);
});
const clearFilters = document.getElementById('fClear');
if (clearFilters) {
  clearFilters.addEventListener('click', () => {
    state.channel = 'all'; state.fulfillment = 'all';
    state.dateFrom = ''; state.dateTo = ''; state.search = ''; state.statusFilter = 'all';
    $('#fChannel').value = 'all';
    $('#fFulfillment').value = 'all';
    $('#fFrom').value = '';
    $('#fTo').value = '';
    $('#orderSearch').value = '';
    renderOrders();
  });
}

/* ordenar al hacer clic en un encabezado */
const onOrdersClick = (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    if (state.sortKey === k) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = k;
      // columnas numéricas y fechas empiezan de mayor a menor
      state.sortDir = (k === 'total' || k === 'created_at') ? 'desc' : 'asc';
    }
    return renderOrders();
  }
  const row = e.target.closest('[data-order]');
  if (!row) return;
  openOrder(row.dataset.order);
};
$('#ordersTable').addEventListener('click', onOrdersClick);
$('#ordersGrouped').addEventListener('click', onOrdersClick);

/* agrupar / desagrupar por estado */
const groupBtn = document.getElementById('fGroup');
if (groupBtn) {
  groupBtn.addEventListener('click', () => {
    state.grouped = !state.grouped;
    renderOrders();
  });
}

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

        <h3 style="margin-top:.9rem">Transportista a cargo</h3>
        <div class="field" style="margin:0">
          <select id="ordCourier" data-order="${order.id}" ${['pagado', 'en_preparacion', 'en_ruta'].includes(order.status) ? '' : 'disabled'}>
            <option value="">— Sin asignar —</option>
            ${(state.couriers || []).filter((c) => c.active).map((c) => `<option value="${c.id}" ${order.courier_id === c.id ? 'selected' : ''}>
              ${esc(c.full_name || c.email)}${c.assigned ? ` · ${c.assigned} en curso` : ''}
            </option>`).join('')}
          </select>
        </div>
        <p class="small muted" style="margin:.3rem 0 0">Al asignarlo, el pedido aparece en su pantalla de “Mis entregas” con la dirección y la franja.</p>
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
              <td class="num"><button class="btn sm ghost" title="Reportar daño antes de entregar"
                data-damage="${i.id}" data-sku="${esc(i.sku)}" data-name="${esc(i.name)}">⚠</button></td>
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
    ['en_ruta', 'En ruta'],
  ];
  const courierName = (id) => (state.couriers || []).find((c) => c.id === id)?.full_name || null;

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
              ${o.fulfillment === 'envio' ? `
                <button class="btn sm ghost courier-btn ${o.courier_id ? 'assigned' : ''}" style="margin-top:.4rem;width:100%" data-assign="${o.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="5.5" cy="17" r="2.6"/><circle cx="18.5" cy="17" r="2.6"/>
                    <path d="M8.1 17h7.8"/><path d="M15.5 17l-1.8-6.4H9.2L7.8 14"/>
                    <path d="M13.7 10.6h2.6l2.2 3.4"/>
                  </svg>
                  <span>${o.courier_id ? esc(courierName(o.courier_id) || 'Asignado') : 'Asignar repartidor'}</span>
                </button>` : ''}
            </div>`).join('') || '<p class="small muted">Nada pendiente.</p>'}
        </div>`;
    })
    .join('');

  $('#kanban').onclick = (e) => {
    const a = e.target.closest('[data-assign]');
    if (a) {
      e.stopPropagation();
      openAssignCourier(a.dataset.assign);
      return;
    }
    const t = e.target.closest('[data-open]');
    if (t) openOrder(t.dataset.open);
  };
}

/* reportar daño desde la ficha del pedido */
$('#dBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-damage]');
  if (!b) return;
  e.preventDefault();
  openDamageForm(b.dataset.damage, { sku: b.dataset.sku, name: b.dataset.name });
});

/* ---------------- repartidores ---------------- */
async function loadCouriers() {
  if (state.profile?.role === 'transportista') return;
  const { data } = await sb.rpc('ts_list_couriers');
  state.couriers = data || [];
}

/* asignar transportista directo desde la ficha del pedido */
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('#ordCourier');
  if (!sel) return;
  const orderId = sel.dataset.order;
  sel.disabled = true;
  const { error } = await sb.rpc('ts_assign_courier', {
    p_order_id: orderId,
    p_courier_id: sel.value || null,
  });
  sel.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast(sel.value ? 'Transportista asignado' : 'Pedido sin transportista');
  await refreshAll();
  openOrder(orderId);
});

function openAssignCourier(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const activos = (state.couriers || []).filter((c) => c.active);
  if (!activos.length) {
    return toast('No hay transportistas activos. Créalos en Usuarios con rol Transportista.', 'err');
  }

  openDrawer({
    title: `Asignar repartidor · ${order.code}`,
    subtitle: `${esc(order.customer_name)} · ${esc(order.ship_city || order.fulfillment)}`,
    body: `
      <div class="panel">
        <div class="field"><label for="courierPick">Transportista</label>
          <select id="courierPick">
            <option value="">— Sin asignar —</option>
            ${activos.map((c) => `<option value="${c.id}" ${order.courier_id === c.id ? 'selected' : ''}>
              ${esc(c.full_name || c.email)}${c.assigned ? ` · ${c.assigned} en curso` : ''}
            </option>`).join('')}
          </select>
        </div>
        <p class="small muted" style="margin:0">El transportista verá el pedido en su pantalla con la dirección y podrá marcarlo “en ruta” y “entregado”.</p>
      </div>`,
    foot: `<button class="btn primary" id="courierSave">Guardar</button>
           <button class="btn ghost" id="courierCancel">Cancelar</button>`,
  });

  $('#courierCancel').onclick = closeDrawer;
  $('#courierSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await sb.rpc('ts_assign_courier', {
      p_order_id: orderId,
      p_courier_id: $('#courierPick').value || null,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast($('#courierPick').value ? 'Repartidor asignado' : 'Repartidor removido');
    closeDrawer();
    await loadOrders();
    await loadCouriers();
    renderKanban();
    renderOrders();
  };
}

/* ---------------- mis entregas (transportista) ---------------- */
async function renderDeliveries() {
  if (state.profile?.role !== 'transportista') {
    toast('Esta sección es del transportista', 'err');
    return setView('orders');
  }

  const scope = state.delFilter || 'today';
  const calls = [sb.rpc('ts_courier_orders', { p_scope: scope })];
  if (scope !== 'today') calls.push(sb.rpc('ts_courier_orders', { p_scope: 'today' }));

  const [res, todayRes] = await Promise.all(calls);
  if (res.error) return toast(errMessage(res.error), 'err');

  const list = res.data || [];
  state.deliveries = list;
  const hoy = (todayRes?.data || (scope === 'today' ? list : [])) || [];
  const activasHoy = hoy.filter((o) => ['listo', 'en_ruta'].includes(o.status));
  const puedeEscanear = state.profile?.scan_delivery !== false;

  $('#delKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Por entregar hoy</span><b>${hoy.filter((o) => o.status === 'listo').length}</b></div>
    <div class="kpi"><span class="k-label">En ruta</span><b>${hoy.filter((o) => o.status === 'en_ruta').length}</b></div>
    <div class="kpi"><span class="k-label">Entregadas hoy</span><b>${hoy.filter((o) => o.status === 'entregado').length}</b></div>
    <div class="kpi"><span class="k-label">Valor de la carga</span><b>${money(activasHoy.reduce((n, o) => n + Number(o.total), 0))}</b></div>`;

  $('#delList').innerHTML = list
    .map((o) => {
      const st = o.scan_state || { required: 0, scanned: 0, order_tag: 0 };
      const completo = Number(st.order_tag) > 0 || Number(st.scanned) >= Number(st.required);
      const maps = [o.ship_line1, o.ship_city, o.ship_department].filter(Boolean).join(', ');
      const tel = (o.customer_phone || '').replace(/[^\d+]/g, '');
      const activo = ['listo', 'en_ruta'].includes(o.status);
      return `<div class="panel" style="margin-bottom:.7rem">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:.6rem">
          <div>
            <div class="tl-name">${esc(o.code)} · ${esc(o.customer_name)}
              <span class="badge ${o.status === 'entregado' ? 'entregado' : o.status === 'en_ruta' ? 'pagado' : 'pendiente_pago'}">${STATUS_LABEL[o.status] || o.status}</span>
            </div>
            <div class="tl-sub" style="margin-top:.25rem">
              ${o.fulfillment === 'retiro' ? '🏬 Retiro en tienda' : '📍 ' + esc(maps || 'Sin dirección')}
            </div>
          </div>
          <b>${money(o.total)}</b>
        </div>
        <div class="small muted" style="margin:.4rem 0">
          ${(o.items || []).map((i) => `${esc(i.name)} ×${i.qty}`).join(' · ')}
        </div>
        ${activo ? `<div class="small" style="margin:.2rem 0;color:${completo ? 'var(--ok,#4ec9a5)' : 'var(--muted)'}">
          ${completo ? '✓ Bultos verificados' : `Bultos escaneados: ${st.scanned}/${st.required}`}
        </div>` : ''}
        ${o.ship_notes ? `<div class="small muted">Nota: ${esc(o.ship_notes)}</div>` : ''}
        <div class="row" style="gap:.4rem;margin-top:.55rem;flex-wrap:wrap">
          ${tel ? `<a class="btn sm ghost" href="tel:${esc(tel)}">📞 Llamar</a>` : ''}
          ${activo && puedeEscanear ? `<button class="btn sm" data-cr-scan="${o.id}">📷 Escanear bultos</button>` : ''}
          ${o.status === 'listo' ? `<button class="btn sm primary" data-cr-go="${o.id}">🚀 Salir a ruta</button>` : ''}
          ${activo ? `<button class="btn sm ${completo ? 'primary' : 'ghost'}" data-cr-done="${o.id}">✅ Entregado</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
  $('#delEmpty').hidden = list.length > 0;
  $('#delEmpty').textContent = scope === 'today'
    ? 'No tienes entregas asignadas para hoy.'
    : scope === 'pending'
      ? 'No tienes entregas pendientes de días anteriores.'
      : 'Todavía no has entregado nada.';
}

$('#delTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-delfilter]');
  if (!b) return;
  state.delFilter = b.dataset.delfilter;
  $$('#delTabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
  renderDeliveries();
});
$('#btnRefreshDel').addEventListener('click', renderDeliveries);

/* escaneo de bultos en la entrega */
let scanBusy = false;

function startDeliveryScan(orderId) {
  const order = (state.deliveries || []).find((o) => o.id === orderId);
  if (!order) return;

  const st = order.scan_state || { required: 0, scanned: 0 };
  const label = (s) => `Escanea los bultos de ${order.code} · ${s.scanned}/${s.required}`;

  scanStream({
    title: label(st),
    onCode: async (code) => {
      if (scanBusy) return;
      scanBusy = true;
      try {
        const { data, error } = await sb.rpc('ts_courier_scan', { p_order_id: orderId, p_code: code });
        if (error) {
          scanFeedback(`✗ ${errMessage(error)}`, 'miss');
          return;
        }
        if (data.result === 'duplicate') {
          scanFeedback(`Ya estaba: ${data.item} · ${data.scanned}/${data.required}`, 'miss');
          return;
        }
        const nombre = data.item || data.label || code;
        if (data.complete) {
          scanFeedback(`✓ ${nombre} · completo ${data.scanned}/${data.required}`, 'hit');
          stopScan();
        } else {
          scanFeedback(`✓ ${nombre} · ${data.scanned}/${data.required}`, 'hit');
        }
      } finally {
        scanBusy = false;
      }
    },
  }).then(() => renderDeliveries());
}

$('#delList').addEventListener('click', async (e) => {
  const scan = e.target.closest('[data-cr-scan]');
  const go = e.target.closest('[data-cr-go]');
  const done = e.target.closest('[data-cr-done]');

  if (scan) return startDeliveryScan(scan.dataset.crScan);
  if (!go && !done) return;

  const id = (go || done).dataset[go ? 'crGo' : 'crDone'];
  const status = go ? 'en_ruta' : 'entregado';
  if (done && !confirm('¿Confirmas que el pedido fue entregado al cliente?')) return;

  const btn = (go || done);
  btn.disabled = true;
  const { error } = await sb.rpc('ts_courier_set_status', { p_order_id: id, p_status: status });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast(status === 'en_ruta' ? 'Marcado en ruta' : 'Entrega confirmada');
  renderDeliveries();
});

/* ---------------- caja / arqueo ---------------- */
const CASH_KIND = { ingreso: 'Ingreso', egreso: 'Egreso', retiro: 'Retiro' };
const BILLS = [
  [100, 'Billete \$100'], [50, 'Billete \$50'], [20, 'Billete \$20'],
  [10, 'Billete \$10'], [5, 'Billete \$5'], [2, 'Billete \$2'], [1, 'Billete \$1'],
  [0.5, 'Moneda 50¢'], [0.25, 'Moneda 25¢'], [0.1, 'Moneda 10¢'],
  [0.05, 'Moneda 5¢'], [0.01, 'Moneda 1¢'],
];

async function renderCash() {
  const [{ data: cur, error }, { data: hist }] = await Promise.all([
    sb.rpc('ts_cash_current'),
    sb.rpc('ts_cash_list', { p_limit: 20 }),
  ]);
  if (error) return toast(errMessage(error), 'err');

  state.cash = cur || null;
  drawCashHistory(hist || []);

  if (!cur) {
    $('#cashClosed').classList.remove('hidden');
    $('#cashOpenView').classList.add('hidden');
    return;
  }

  $('#cashClosed').classList.add('hidden');
  $('#cashOpenView').classList.remove('hidden');

  const s = cur.session;
  const t = cur.summary;
  const dif = Number(t.expected) - Number(s.opening_amount);

  $('#cashKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Fondo inicial</span><b>${money(s.opening_amount)}</b><span class="k-sub">${esc(s.code)}</span></div>
    <div class="kpi"><span class="k-label">Ventas en efectivo</span><b>${money(t.cash_sales)}</b><span class="k-sub">${t.sales_count} ventas</span></div>
    <div class="kpi"><span class="k-label">Otros medios</span><b>${money(t.other_sales)}</b><span class="k-sub">no entran a la caja</span></div>
    <div class="kpi"><span class="k-label">Debería haber</span><b style="color:var(--accent,#6ea8fe)">${money(t.expected)}</b><span class="k-sub">${t.ingresos > 0 ? '+' + money(t.ingresos) + ' ingresos ' : ''}${t.egresos > 0 ? '−' + money(t.egresos) + ' egresos ' : ''}${t.retiros > 0 ? '−' + money(t.retiros) + ' retiros' : ''}</span></div>`;

  const orders = cur.orders || [];
  $('#cashOrders').innerHTML = orders.length
    ? orders.map((o) => `<div class="line" style="grid-template-columns:1fr auto;padding:.45rem 0">
        <div><div class="tl-name">${esc(o.code)}</div>
             <div class="tl-sub">${fmtDate(o.created_at)} · ${esc(o.provider || '—')} · ${esc(o.customer_name || '')}</div></div>
        <b>${money(o.total)}</b>
      </div>`).join('')
    : '<p class="small muted">Aún no hay ventas en este turno.</p>';

  const movs = cur.movements || [];
  $('#cashMovs').innerHTML = movs.length
    ? movs.map((m) => `<div class="line" style="grid-template-columns:1fr auto;padding:.4rem 0">
        <div><div class="tl-name">${CASH_KIND[m.kind] || m.kind}</div>
             <div class="tl-sub">${esc(m.reason || '')} · ${fmtDate(m.created_at)}</div></div>
        <b style="color:${m.kind === 'ingreso' ? 'var(--ok,#4ec9a5)' : 'var(--bad,#f06b6b)'}">
          ${m.kind === 'ingreso' ? '+' : '−'}${money(m.amount)}</b>
      </div>`).join('')
    : '<p class="small muted">Sin movimientos.</p>';
}

function drawCashHistory(list) {
  $('#cashHistory').innerHTML = list.length
    ? list.map((s) => {
        const d = s.difference === null ? null : Number(s.difference);
        const tone = d === null ? '' : d === 0 ? 'var(--muted)' : d > 0 ? 'var(--ok,#4ec9a5)' : 'var(--bad,#f06b6b)';
        return `<div class="line" style="grid-template-columns:1fr auto;padding:.5rem 0">
          <div>
            <div class="tl-name">${esc(s.code)} · ${esc(s.opened_by_name || '')}
              <span class="badge ${s.status === 'abierta' ? 'pagado' : 'entregado'}">${s.status}</span></div>
            <div class="tl-sub">${fmtDate(s.opened_at)} → ${s.closed_at ? fmtDate(s.closed_at) : 'abierta'}
              · ventas ${money(s.sales_total)}</div>
          </div>
          <div style="text-align:right">
            ${s.expected_amount !== null
              ? `<b style="color:${tone}">${d === 0 ? 'cuadrada' : (d > 0 ? '+' : '') + money(d)}</b>
                 <div class="small muted">esperado ${money(s.expected_amount)} · contado ${money(s.counted_amount)}</div>`
              : `<span class="small muted">en curso</span>`}
          </div>
        </div>`;
      }).join('')
    : '<p class="small muted">Todavía no hay turnos cerrados.</p>';
}

$('#btnOpenCash').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const opening = Number($('#cashOpening').value || 0);
  btn.disabled = true;
  const { error } = await sb.rpc('ts_cash_open', {
    p_opening: opening,
    p_notes: $('#cashNotes').value.trim() || null,
  });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast('Caja abierta');
  renderCash();
});

$('#view-cash').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cash-mov]');
  if (b) openCashMovement(b.dataset.cashMov);
});

function openCashMovement(kind) {
  const label = CASH_KIND[kind] || kind;
  openDrawer({
    title: `${label} de efectivo`,
    subtitle: kind === 'ingreso' ? 'Entra dinero a la caja' : kind === 'egreso' ? 'Sale dinero para un gasto' : 'Sacas efectivo hacia la bóveda',
    body: `<div class="panel">
      <div class="field"><label for="movAmount">Monto *</label>
        <input id="movAmount" type="number" min="0.01" step="0.01" inputmode="decimal" autofocus></div>
      <div class="field"><label for="movReason">Motivo</label>
        <input id="movReason" placeholder="${kind === 'ingreso' ? 'Cambio, abono de cliente…' : kind === 'egreso' ? 'Compra de bolsas, flete…' : 'Depósito al banco'}"></div>
    </div>`,
    foot: `<button class="btn primary" id="movSave">Registrar</button>
           <button class="btn ghost" id="movCancel">Cancelar</button>`,
  });
  $('#movCancel').onclick = closeDrawer;
  $('#movSave').onclick = async (e) => {
    const amount = Number($('#movAmount').value || 0);
    if (!(amount > 0)) return toast('Escribe un monto mayor que cero', 'err');
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await sb.rpc('ts_cash_movement', {
      p_kind: kind, p_amount: amount, p_reason: $('#movReason').value.trim() || null,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast(`${label} registrado`);
    closeDrawer();
    renderCash();
  };
}

$('#btnCloseCash').addEventListener('click', () => {
  const expected = Number(state.cash?.summary?.expected || 0);

  openDrawer({
    title: 'Cerrar caja · arqueo',
    subtitle: `Debería haber ${money(expected)} en efectivo`,
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <h3 style="margin-top:0">Conteo por denominación</h3>
        <div id="billRows">
          ${BILLS.map(([v, label]) => `
            <div class="row" style="justify-content:space-between;gap:.5rem;padding:.2rem 0">
              <span class="small">${label}</span>
              <input type="number" min="0" step="1" value="0" data-bill="${v}"
                     style="width:84px" inputmode="numeric" aria-label="${label}">
              <span class="small muted" data-sub="${v}" style="width:78px;text-align:right">$0.00</span>
            </div>`).join('')}
        </div>
        <div class="pos-total" style="margin-top:.6rem"><span>Total contado</span><span id="countedTotal">$0.00</span></div>
        <div class="small" id="cashDiff" style="margin-top:.3rem"></div>
      </div>
      <div class="panel">
        <div class="field"><label for="closeNotes">Notas del cierre</label>
          <input id="closeNotes" placeholder="Ej: faltó cambio, propina…"></div>
      </div>`,
    foot: `<button class="btn primary" id="closeConfirm">Confirmar cierre</button>
           <button class="btn ghost" id="closeCancel">Cancelar</button>`,
  });

  const recalc = () => {
    let total = 0;
    const breakdown = {};
    BILLS.forEach(([v]) => {
      const n = Number(document.querySelector(`[data-bill="${v}"]`)?.value || 0);
      const sub = n * v;
      breakdown[v] = n;
      total += sub;
      const el = document.querySelector(`[data-sub="${v}"]`);
      if (el) el.textContent = n ? money(sub) : '—';
    });
    total = Math.round(total * 100) / 100;
    $('#countedTotal').textContent = money(total);
    const d = Math.round((total - expected) * 100) / 100;
    $('#cashDiff').innerHTML = d === 0
      ? '<span style="color:var(--ok,#4ec9a5)">Cuadra exacto ✓</span>'
      : `<span style="color:${d > 0 ? 'var(--warn,#e3b341)' : 'var(--bad,#f06b6b)'}">
           ${d > 0 ? 'Sobrante' : 'Faltante'} de ${money(Math.abs(d))}</span>`;
    return { total, breakdown };
  };

  $('#billRows').addEventListener('input', recalc);
  $('#closeCancel').onclick = closeDrawer;
  $('#closeConfirm').onclick = async (e) => {
    const { total, breakdown } = recalc();
    const btn = e.currentTarget;
    btn.disabled = true;
    const { data, error } = await sb.rpc('ts_cash_close', {
      p_counted: total,
      p_breakdown: breakdown,
      p_notes: $('#closeNotes').value.trim() || null,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    const d = Number(data.difference);
    toast(d === 0 ? 'Caja cerrada: cuadra exacto' : `Caja cerrada con ${d > 0 ? 'sobrante' : 'faltante'} de ${money(Math.abs(d))}`);
    closeDrawer();
    renderCash();
  };
});

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
        <td data-label="Foto"><img class="inv-thumb" src="${esc(p.image_url || 'assets/img/placeholder.svg')}" alt=""></td>
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

  await renderSocial();
  await renderTheme();
}

/* ---------------- tema (claro / oscuro) ---------------- */
const THEME_SCHEMES = {
  store: {
    light: { bg: '#f8fafc', card: '#ffffff', txt: '#0f172a', accent: '#4f46e5', line: '#e2e8f0' },
    dark: { bg: '#0b1020', card: '#121a30', txt: '#e8ecf6', accent: '#818cf8', line: '#243049' },
  },
  admin: {
    dark: { bg: '#0b1020', card: '#121a30', txt: '#e8ecf6', accent: '#6366f1', line: '#25314e' },
    light: { bg: '#f5f7fb', card: '#ffffff', txt: '#111827', accent: '#4f46e5', line: '#dde3ee' },
  },
};

function paintThemePrev(el, s) {
  if (!el) return;
  el.style.background = s.bg;
  el.innerHTML = `
    <div class="tp-bar" style="background:${s.accent};width:42%"></div>
    <div class="tp-bar" style="background:${s.line};width:70%"></div>
    <div class="tp-row">
      <div class="tp-card" style="background:${s.card};border:1px solid ${s.line}"></div>
      <div class="tp-card" style="background:${s.card};border:1px solid ${s.line}"></div>
    </div>
    <div class="tp-row" style="margin-top:.35rem">
      <div class="tp-btn" style="background:${s.accent}"></div>
      <span style="font-size:.62rem;color:${s.txt}">Así se ve el texto</span>
    </div>`;
}

async function renderTheme() {
  const { data, error } = await sb.from('ts_settings').select('value').eq('key', 'theme').maybeSingle();
  if (error) return;
  const cfg = data?.value || { store: 'light', admin: 'dark' };
  $('#themeStore').value = cfg.store || 'light';
  $('#themeAdmin').value = cfg.admin || 'dark';
  updateThemePreview();
}

function updateThemePreview() {
  paintThemePrev($('#prevStore'), THEME_SCHEMES.store[$('#themeStore').value] || THEME_SCHEMES.store.light);
  paintThemePrev($('#prevAdmin'), THEME_SCHEMES.admin[$('#themeAdmin').value] || THEME_SCHEMES.admin.dark);
}

$('#themeStore').addEventListener('change', updateThemePreview);
$('#themeAdmin').addEventListener('change', updateThemePreview);

$('#themeSave').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const value = { store: $('#themeStore').value, admin: $('#themeAdmin').value };
  btn.disabled = true;
  const { error } = await sb.rpc('ts_save_setting', { p_key: 'theme', p_value: value });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  applyTheme(value.admin);
  toast('Tema guardado');
});

$('#themeReset').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const value = { store: 'light', admin: 'dark' };
  btn.disabled = true;
  const { error } = await sb.rpc('ts_save_setting', { p_key: 'theme', p_value: value });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  applyTheme('dark');
  await renderTheme();
  toast('Tema restablecido');
});

$('#settingsTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stab]');
  if (!b) return;
  $$('#settingsTabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
  $$('#view-settings [data-stab-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.stabPanel !== b.dataset.stab));
});

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

/* ---------------- clientes ---------------- */
let customerPicks = [];

async function renderCustomers() {
  const tbody = $('#custTable').querySelector('tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="small muted">Cargando…</td></tr>';

  const { data, error } = await sb.rpc('ts_customers_list');
  if (error) {
    tbody.innerHTML = '';
    return toast(errMessage(error), 'err');
  }
  customerPicks = data || [];
  drawCustomers();
}

function drawCustomers() {
  const term = ($('#custSearch').value || '').toLowerCase().trim();
  const rows = customerPicks.filter((c) =>
    !term ||
    (c.name || '').toLowerCase().includes(term) ||
    (c.email || '').toLowerCase().includes(term) ||
    (c.phone || '').toLowerCase().includes(term)
  );

  const totalSpent = customerPicks.reduce((n, c) => n + Number(c.spent || 0), 0);
  const recurrentes = customerPicks.filter((c) => Number(c.orders) > 1).length;
  const mejor = customerPicks[0];
  $('#custKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Clientes con compras</span><b>${customerPicks.length}</b></div>
    <div class="kpi"><span class="k-label">Recurrentes (2+)</span><b>${recurrentes}</b></div>
    <div class="kpi"><span class="k-label">Gasto acumulado</span><b>${money(totalSpent)}</b></div>
    <div class="kpi"><span class="k-label">Mejor cliente</span><b>${mejor ? esc(mejor.name) : '—'}</b><span class="k-sub">${mejor ? money(mejor.spent) : ''}</span></div>`;

  $('#custTable').querySelector('tbody').innerHTML = rows
    .map((c) => {
      const ticket = Number(c.orders) ? Number(c.spent) / Number(c.orders) : 0;
      return `<tr>
        <td data-label="Cliente"><b>${esc(c.name || 'Cliente')}</b>${c.active === false ? ' <span class="badge cancelado">inactivo</span>' : ''}
            <div class="small muted">${esc(c.city || '')}</div></td>
        <td data-label="Contacto" class="small">${esc(c.email || '—')}<div class="muted">${esc(c.phone || '')}</div></td>
        <td data-label="Pedidos" class="num">${c.orders}</td>
        <td data-label="Gastado" class="num">${money(c.spent)}</td>
        <td data-label="Ticket promedio" class="num">${money(ticket)}</td>
        <td data-label="Última compra" class="small">${c.last_at ? fmtDate(c.last_at) : '—'}</td>
        <td data-label=""><button class="btn sm" data-cust="${c.user_id}">Ver ficha</button></td>
      </tr>`;
    })
    .join('');
  $('#custEmpty').hidden = rows.length > 0;
}

$('#custSearch').addEventListener('input', drawCustomers);
$('#btnRefreshCust').addEventListener('click', renderCustomers);

$('#custTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cust]');
  if (b) openCustomer(b.dataset.cust);
});

async function openCustomer(userId) {
  const { data, error } = await sb.rpc('ts_customer_detail', { p_user_id: userId });
  if (error) return toast(errMessage(error), 'err');

  const p = data.profile || {};
  const orders = data.orders || [];
  const notes = data.notes || [];
  const addrs = data.addresses || [];
  const spent = orders.filter((o) => !['cancelado', 'reembolsado'].includes(o.status))
    .reduce((n, o) => n + Number(o.total), 0);

  openDrawer({
    title: p.full_name || 'Cliente',
    subtitle: p.email || '',
    body: `
      <div class="kpis" style="margin-bottom:.8rem">
        <div class="kpi"><span class="k-label">Pedidos</span><b>${orders.length}</b></div>
        <div class="kpi"><span class="k-label">Gastado</span><b>${money(spent)}</b></div>
        <div class="kpi"><span class="k-label">Ticket promedio</span><b>${money(orders.length ? spent / orders.length : 0)}</b></div>
        <div class="kpi"><span class="k-label">Estado</span><b>${p.active === false ? 'Inactivo' : 'Activo'}</b></div>
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3>Datos</h3>
        <p class="small" style="line-height:1.9">
          Correo: <b>${esc(p.email || '—')}</b><br>
          Teléfono: <b>${esc(p.phone || '—')}</b><br>
          Alta: ${p.created_at ? fmtDate(p.created_at) : '—'}
        </p>
        ${addrs.length ? `<p class="small muted">Direcciones: ${addrs.map((a) => esc(`${a.line1 || ''} ${a.city || ''}`.trim())).join(' · ')}</p>` : ''}
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3>Historial de compras</h3>
        ${orders.length ? `<div class="small">${orders.map((o) => `
          <div class="line" style="grid-template-columns:1fr auto;padding:.45rem 0">
            <div><div class="tl-name">${esc(o.code)} · ${o.items} art.</div>
                 <div class="tl-sub">${fmtDate(o.created_at)} · ${o.channel === 'pos' ? 'mostrador' : 'en línea'}</div></div>
            <div style="text-align:right"><b>${money(o.total)}</b>
                 <div class="small muted">${STATUS_LABEL[o.status] || o.status}</div></div>
          </div>`).join('')}</div>` : '<p class="small muted">Sin pedidos.</p>'}
      </div>

      <div class="panel">
        <h3>Notas internas</h3>
        <p class="small muted" style="margin-top:0">Solo las ve el equipo.</p>
        <div class="field"><textarea id="cNote" rows="2" placeholder="Ej: prefiere entrega los sábados"></textarea></div>
        <button class="btn sm primary" id="cNoteAdd">Agregar nota</button>
        <div id="cNotes" style="margin-top:.7rem">
          ${notes.length
            ? notes.map((n) => `<div class="small" style="border-top:1px solid var(--line);padding:.4rem 0">
                ${esc(n.note)}<div class="muted" style="font-size:.72rem">${fmtDate(n.created_at)}</div></div>`).join('')
            : '<p class="small muted">Sin notas.</p>'}
        </div>
      </div>`,
    foot: `<button class="btn ghost" id="cClose">Cerrar</button>`,
  });

  $('#cClose').onclick = closeDrawer;
  $('#cNoteAdd').onclick = async (e) => {
    const txt = $('#cNote').value.trim();
    if (!txt) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: err } = await sb.from('ts_customer_notes').insert({ user_id: userId, note: txt });
    btn.disabled = false;
    if (err) return toast(errMessage(err), 'err');
    toast('Nota guardada');
    openCustomer(userId);
  };
}

/* ---------------- proveedores y compras ---------------- */
let purchaseCart = [];

async function renderSuppliers() {
  if (state.profile?.role !== 'admin') {
    toast('Solo el administrador ve proveedores y costos', 'err');
    return setView('orders');
  }

  const [{ data: sup, error: e1 }, { data: pur, error: e2 }] = await Promise.all([
    sb.from('ts_suppliers').select('*').order('name'),
    sb.from('ts_purchases').select('*, ts_purchase_items(qty)').order('created_at', { ascending: false }).limit(60),
  ]);
  if (e1 || e2) return toast(errMessage(e1 || e2), 'err');

  state.suppliers = sup || [];
  state.purchases = pur || [];

  const pendientes = state.purchases.filter((p) => p.status === 'pendiente');
  const comprado = state.purchases
    .filter((p) => p.status === 'recibida')
    .reduce((n, p) => n + Number(p.total), 0);

  $('#supKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Proveedores activos</span><b>${state.suppliers.filter((s) => s.active).length}</b></div>
    <div class="kpi"><span class="k-label">Compras pendientes</span><b>${pendientes.length}</b></div>
    <div class="kpi"><span class="k-label">Comprado (recibido)</span><b>${money(comprado)}</b></div>
    <div class="kpi"><span class="k-label">Unidades en tránsito</span><b>${pendientes.reduce((n, p) => n + Number((p.ts_purchase_items || []).reduce((m, i) => m + i.qty, 0)), 0)}</b></div>`;

  $('#supplierList').innerHTML = state.suppliers
    .map((s) => `<div class="line" style="grid-template-columns:1fr auto;padding:.55rem 0">
      <div>
        <div class="tl-name">${esc(s.name)} ${s.active ? '' : '<span class="badge cancelado">inactivo</span>'}</div>
        <div class="tl-sub">${esc(s.contact_name || '—')} · ${esc(s.phone || '')} ${s.email ? '· ' + esc(s.email) : ''}</div>
      </div>
      <div class="row" style="gap:.3rem">
        <button class="btn sm ghost" data-sup-edit="${s.id}">Editar</button>
        <button class="btn sm ${s.active ? 'ghost' : ''}" data-sup-toggle="${s.id}" data-active="${s.active}">${s.active ? 'Pausar' : 'Activar'}</button>
      </div>
    </div>`)
    .join('');
  $('#supEmpty').hidden = state.suppliers.length > 0;

  $('#purchaseList').innerHTML = state.purchases
    .map((p) => {
      const sup = state.suppliers.find((s) => s.id === p.supplier_id);
      const unidades = (p.ts_purchase_items || []).reduce((n, i) => n + i.qty, 0);
      const badge = p.status === 'recibida' ? 'entregado' : p.status === 'cancelada' ? 'cancelado' : 'pendiente_pago';
      return `<div class="line" style="grid-template-columns:1fr auto;padding:.55rem 0">
        <div>
          <div class="tl-name">${esc(p.code)} · ${esc(sup ? sup.name : 'Sin proveedor')}
            <span class="badge ${badge}">${p.status}</span></div>
          <div class="tl-sub">${fmtDate(p.created_at)} · ${unidades} u. · ${money(p.total)}</div>
        </div>
        <div class="row" style="gap:.3rem">
          ${p.status === 'pendiente' ? `
            <button class="btn sm primary" data-pur-receive="${p.id}">Recibir</button>
            <button class="btn sm ghost" data-pur-cancel="${p.id}">Cancelar</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
  $('#purEmpty').hidden = state.purchases.length > 0;
}

$('#supplierList').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-sup-edit]');
  const tog = e.target.closest('[data-sup-toggle]');
  if (edit) {
    const s = state.suppliers.find((x) => x.id === edit.dataset.supEdit);
    openSupplierForm(s);
  }
  if (tog) {
    const { error } = await sb.from('ts_suppliers')
      .update({ active: tog.dataset.active === 'false' })
      .eq('id', tog.dataset.supToggle);
    if (error) return toast(errMessage(error), 'err');
    renderSuppliers();
  }
});

$('#purchaseList').addEventListener('click', async (e) => {
  const rec = e.target.closest('[data-pur-receive]');
  const can = e.target.closest('[data-pur-cancel]');
  if (rec) {
    if (!confirm('Recibir esta compra? Se sumará el stock de cada producto y se actualizará su costo.')) return;
    const { error } = await sb.rpc('ts_purchase_receive', { p_purchase_id: rec.dataset.purReceive });
    if (error) return toast(errMessage(error), 'err');
    toast('Compra recibida e inventario actualizado');
    await loadProducts();
    renderSuppliers();
  }
  if (can) {
    if (!confirm('Cancelar esta compra?')) return;
    const { error } = await sb.rpc('ts_purchase_cancel', { p_purchase_id: can.dataset.purCancel });
    if (error) return toast(errMessage(error), 'err');
    toast('Compra cancelada');
    renderSuppliers();
  }
});

function openSupplierForm(supplier = null) {
  openDrawer({
    title: supplier ? supplier.name : 'Nuevo proveedor',
    subtitle: 'Quién te surte la mercancía',
    body: `<div class="panel">
      <div class="field"><label for="sName">Nombre *</label><input id="sName" value="${esc(supplier?.name || '')}"></div>
      <div class="row" style="gap:.6rem">
        <div class="field" style="flex:1"><label for="sContact">Contacto</label><input id="sContact" value="${esc(supplier?.contact_name || '')}"></div>
        <div class="field" style="flex:1"><label for="sPhone">Teléfono</label><input id="sPhone" value="${esc(supplier?.phone || '')}"></div>
      </div>
      <div class="row" style="gap:.6rem">
        <div class="field" style="flex:1"><label for="sEmail">Correo</label><input id="sEmail" value="${esc(supplier?.email || '')}"></div>
        <div class="field" style="flex:1"><label for="sNit">NIT / registro</label><input id="sNit" value="${esc(supplier?.nit || '')}"></div>
      </div>
      <div class="field"><label for="sAddr">Dirección</label><input id="sAddr" value="${esc(supplier?.address || '')}"></div>
      <div class="field"><label for="sNotes">Notas</label><textarea id="sNotes" rows="2">${esc(supplier?.notes || '')}</textarea></div>
    </div>`,
    foot: `<button class="btn primary" id="sSave">${supplier ? 'Guardar cambios' : 'Crear proveedor'}</button>
           <button class="btn ghost" id="sCancel">Cancelar</button>`,
  });

  $('#sCancel').onclick = closeDrawer;
  $('#sSave').onclick = async (e) => {
    const payload = {
      name: $('#sName').value.trim(),
      contact_name: $('#sContact').value.trim() || null,
      phone: $('#sPhone').value.trim() || null,
      email: $('#sEmail').value.trim() || null,
      nit: $('#sNit').value.trim() || null,
      address: $('#sAddr').value.trim() || null,
      notes: $('#sNotes').value.trim() || null,
    };
    if (!payload.name) return toast('El nombre es obligatorio', 'err');
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = supplier
      ? await sb.from('ts_suppliers').update(payload).eq('id', supplier.id)
      : await sb.from('ts_suppliers').insert(payload);
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast(supplier ? 'Proveedor actualizado' : 'Proveedor creado');
    closeDrawer();
    renderSuppliers();
  };
}

$('#btnNewSupplier').addEventListener('click', () => openSupplierForm(null));

$('#btnNewPurchase').addEventListener('click', () => {
  if (!state.suppliers?.length) return toast('Crea primero un proveedor', 'err');
  openPurchaseForm();
});

function openPurchaseForm() {
  purchaseCart = [];
  openDrawer({
    title: 'Registrar compra',
    subtitle: 'Entrada de mercancía al inventario',
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="field"><label for="pSup">Proveedor *</label>
          <select id="pSup">${state.suppliers.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="pNotes">Notas</label><input id="pNotes" placeholder="Factura 00123, entrega parcial…"></div>
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3>Productos</h3>
        <div class="field"><input id="pSearch" placeholder="Buscar por nombre o SKU…"></div>
        <div class="pos-products" id="pProducts" style="max-height:200px"></div>
      </div>

      <div class="panel">
        <h3>Líneas</h3>
        <div id="pLines"></div>
        <p class="small muted" id="pLinesEmpty">Aún no hay productos.</p>
        <div class="pos-total"><span>Total compra</span><span id="pTotal">$0.00</span></div>
        <p class="small muted">La compra queda <b>pendiente</b>: el stock se suma cuando pulses "Recibir".</p>
      </div>`,
    foot: `<button class="btn primary" id="pSave">Guardar compra</button>
           <button class="btn ghost" id="pCancel">Cancelar</button>`,
  });

  const drawProducts = () => {
    const term = ($('#pSearch').value || '').toLowerCase();
    $('#pProducts').innerHTML = state.products
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .slice(0, 40)
      .map((p) => `<button class="pos-tile" data-p-add="${p.id}">
        <div class="n">${esc(p.name)}</div>
        <div class="s">${esc(p.sku)} · stock ${p.stock}</div>
        <div class="p">costo ${money(p.cost || 0)}</div></button>`)
      .join('');
  };

  const drawLines = () => {
    $('#pLines').innerHTML = purchaseCart
      .map((i, idx) => `<div class="ticket-line">
        <div><div class="tl-name">${esc(i.name)}</div><div class="tl-sub">${esc(i.sku)}</div></div>
        <div class="tl-right">
          <input type="number" min="1" value="${i.qty}" data-p-qty="${idx}" style="width:64px" aria-label="cantidad">
          <input type="number" min="0" step="0.01" value="${i.cost}" data-p-cost="${idx}" style="width:86px" aria-label="costo">
          <div class="amount">${money(i.qty * i.cost)}</div>
          <button class="btn ghost sm" data-p-del="${idx}">✕</button>
        </div>
      </div>`)
      .join('');
    $('#pLinesEmpty').hidden = purchaseCart.length > 0;
    $('#pTotal').textContent = money(purchaseCart.reduce((n, i) => n + i.qty * i.cost, 0));
  };

  $('#pSearch').addEventListener('input', drawProducts);
  $('#pProducts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p-add]');
    if (!b) return;
    const p = state.products.find((x) => x.id === b.dataset.pAdd);
    const found = purchaseCart.find((i) => i.id === p.id);
    if (found) found.qty += 1;
    else purchaseCart.push({ id: p.id, sku: p.sku, name: p.name, qty: 1, cost: Number(p.cost || 0) });
    drawLines();
  });

  $('#pLines').addEventListener('input', (e) => {
    const q = e.target.closest('[data-p-qty]');
    const c = e.target.closest('[data-p-cost]');
    let idx = null;
    if (q) {
      idx = Number(q.dataset.pQty);
      purchaseCart[idx].qty = Math.max(1, Math.floor(Number(q.value) || 1));
    } else if (c) {
      idx = Number(c.dataset.pCost);
      purchaseCart[idx].cost = Math.max(0, Number(c.value) || 0);
    } else return;
    const line = $('#pLines').children[idx];
    if (line) line.querySelector('.amount').textContent = money(purchaseCart[idx].qty * purchaseCart[idx].cost);
    $('#pTotal').textContent = money(purchaseCart.reduce((n, x) => n + x.qty * x.cost, 0));
  });

  $('#pLines').addEventListener('click', (e) => {
    const del = e.target.closest('[data-p-del]');
    if (!del) return;
    purchaseCart.splice(Number(del.dataset.pDel), 1);
    drawLines();
  });

  $('#pCancel').onclick = closeDrawer;
  $('#pSave').onclick = async (e) => {
    if (!purchaseCart.length) return toast('Agrega al menos un producto', 'err');
    const btn = e.currentTarget;
    btn.disabled = true;
    const { data, error } = await sb.rpc('ts_purchase_create', {
      p_supplier_id: $('#pSup').value,
      p_items: purchaseCart.map((i) => ({ product_id: i.id, qty: i.qty, unit_cost: i.cost })),
      p_notes: $('#pNotes').value.trim() || null,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast(`Compra ${data.code} registrada`);
    closeDrawer();
    renderSuppliers();
  };

  drawProducts();
  drawLines();
}

/* ---------------- promociones ---------------- */
async function renderPromos() {
  if (state.profile?.role !== 'admin') {
    toast('Solo el administrador gestiona promociones', 'err');
    return setView('orders');
  }

  const [{ data: promos, error }, { data: reds }] = await Promise.all([
    sb.from('ts_promos').select('*').order('created_at', { ascending: false }),
    sb.from('ts_promo_redemptions').select('promo_id, amount'),
  ]);
  if (error) return toast(errMessage(error), 'err');

  state.promos = promos || [];
  const totalDesc = (reds || []).reduce((n, r) => n + Number(r.amount), 0);
  const usos = (reds || []).length;

  $('#promoKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Promos activas</span><b>${state.promos.filter((p) => p.active).length}</b></div>
    <div class="kpi"><span class="k-label">Cupones usados</span><b>${usos}</b></div>
    <div class="kpi"><span class="k-label">Descuento otorgado</span><b>${money(totalDesc)}</b></div>
    <div class="kpi"><span class="k-label">De bienvenida</span><b>${state.promos.filter((p) => p.kind === 'bienvenida').length}</b></div>`;

  $('#promoTable').querySelector('tbody').innerHTML = state.promos
    .map((p) => {
      const vencida = p.ends_at && new Date(p.ends_at) < new Date();
      const estado = !p.active ? 'cancelado' : vencida ? 'pendiente_pago' : 'entregado';
      const etiqueta = !p.active ? 'Pausada' : vencida ? 'Vencida' : 'Activa';
      return `<tr>
        <td data-label="Código"><span class="mono">${esc(p.code)}</span>
          <div class="small muted">${esc(p.name || '')}${p.owner_id ? ' · personal' : ''}</div></td>
        <td data-label="Tipo" class="small">${p.scope === 'all' ? 'Todo el catálogo' : 'Productos elegidos'}${p.new_customers_only ? ' · solo nuevos' : ''}</td>
        <td data-label="Valor" class="num">${p.discount_type === 'percent' ? p.discount_value + '%' : money(p.discount_value)}</td>
        <td data-label="Vigencia" class="small">${p.ends_at ? fmtDate(p.ends_at) : 'sin fin'}</td>
        <td data-label="Usos" class="num">${p.used_count}${p.max_uses ? ' / ' + p.max_uses : ''}</td>
        <td data-label="Estado"><span class="badge ${estado}">${etiqueta}</span></td>
        <td data-label="">
          <button class="btn sm ghost" data-promo-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Pausar' : 'Activar'}</button>
        </td>
      </tr>`;
    })
    .join('');
  $('#promoEmpty').hidden = state.promos.length > 0;
}

$('#promoTable').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-promo-toggle]');
  if (!b) return;
  const activar = b.dataset.active !== 'true';
  b.disabled = true;
  const { error } = await sb.from('ts_promos').update({ active: activar }).eq('id', b.dataset.promoId || b.dataset.promoToggle);
  b.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  renderPromos();
});

$('#btnNewPromo').addEventListener('click', () => openPromoForm());

function openPromoForm() {
  openDrawer({
    title: 'Nueva promoción',
    subtitle: 'Cupón por código, con vigencia y alcance',
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="field"><label for="prName">Nombre</label><input id="prName" placeholder="Promo navideña"></div>
        <div class="field"><label for="prCode">Código</label>
          <div class="row" style="gap:.4rem">
            <input id="prCode" placeholder="NAVIDAD25" style="flex:1">
            <button class="btn sm" type="button" id="prGen">Generar</button>
          </div>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="prType">Tipo</label>
            <select id="prType"><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select>
          </div>
          <div class="field" style="flex:1"><label for="prValue">Valor</label>
            <input id="prValue" type="number" min="0.01" step="0.01" value="10"></div>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="prMin">Compra mínima</label>
            <input id="prMin" type="number" min="0" step="0.01" value="0"></div>
          <div class="field" style="flex:1"><label for="prMax">Usos totales</label>
            <input id="prMax" type="number" min="0" placeholder="sin límite"></div>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="prStart">Desde</label><input id="prStart" type="date"></div>
          <div class="field" style="flex:1"><label for="prEnd">Hasta</label><input id="prEnd" type="date"></div>
        </div>
        <div class="field"><label for="prScope">Aplica a</label>
          <select id="prScope"><option value="all">Todo el catálogo</option><option value="products">Productos seleccionados</option></select>
        </div>
        <label class="row" style="gap:.5rem;align-items:center;font-size:.86rem">
          <input type="checkbox" id="prNew"> Solo clientes nuevos (primera compra)
        </label>
      </div>

      <div class="panel" id="prProductsBox" hidden>
        <h3 style="margin-top:0">Productos</h3>
        <div class="field"><input id="prSearch" placeholder="Buscar…"></div>
        <div id="prProducts" style="max-height:240px;overflow:auto"></div>
      </div>`,
    foot: `<button class="btn primary" id="prSave">Crear promoción</button>
           <button class="btn ghost" id="prCancel">Cancelar</button>`,
  });

  const picked = new Set();
  const drawProducts = () => {
    const term = ($('#prSearch').value || '').toLowerCase();
    $('#prProducts').innerHTML = state.products
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .slice(0, 60)
      .map((p) => `<label class="row" style="gap:.5rem;padding:.3rem 0;font-size:.84rem">
        <input type="checkbox" data-prod="${p.id}" ${picked.has(p.id) ? 'checked' : ''}>
        <span>${esc(p.name)} <span class="muted">· ${esc(p.sku)}</span></span>
      </label>`)
      .join('');
  };

  $('#prScope').onchange = () => {
    $('#prProductsBox').hidden = $('#prScope').value !== 'products';
    if (!$('#prProductsBox').hidden) drawProducts();
  };
  $('#prSearch').addEventListener('input', drawProducts);
  $('#prProducts').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-prod]');
    if (!cb) return;
    if (cb.checked) picked.add(cb.dataset.prod);
    else picked.delete(cb.dataset.prod);
  });
  $('#prGen').onclick = () => {
    $('#prCode').value = 'PROMO' + Math.random().toString(36).slice(2, 6).toUpperCase();
  };
  $('#prCancel').onclick = closeDrawer;

  $('#prSave').onclick = async (e) => {
    const code = $('#prCode').value.trim().toUpperCase();
    if (!code) return toast('Falta el código', 'err');
    const payload = {
      code,
      name: $('#prName').value.trim() || null,
      kind: 'cupon',
      discount_type: $('#prType').value,
      discount_value: Number($('#prValue').value || 0),
      min_subtotal: Number($('#prMin').value || 0),
      max_uses: $('#prMax').value ? Number($('#prMax').value) : null,
      max_uses_per_user: 1,
      scope: $('#prScope').value,
      new_customers_only: $('#prNew').checked,
      starts_at: $('#prStart').value ? new Date($('#prStart').value + 'T00:00:00').toISOString() : new Date().toISOString(),
      ends_at: $('#prEnd').value ? new Date($('#prEnd').value + 'T23:59:59').toISOString() : null,
      active: true,
    };
    if (!(payload.discount_value > 0)) return toast('El valor debe ser mayor que cero', 'err');

    const btn = e.currentTarget;
    btn.disabled = true;
    const { data, error } = await sb.from('ts_promos').insert(payload).select('id').maybeSingle();
    if (error) {
      btn.disabled = false;
      return toast(errMessage(error), 'err');
    }
    if (payload.scope === 'products' && picked.size) {
      const rows = [...picked].map((pid) => ({ promo_id: data.id, product_id: pid }));
      const { error: e2 } = await sb.from('ts_promo_products').insert(rows);
      if (e2) toast('Promo creada, pero no se guardaron los productos: ' + errMessage(e2), 'err');
    }
    btn.disabled = false;
    toast('Promoción creada');
    closeDrawer();
    renderPromos();
  };
}

/* ---------------- calendario de entregas ---------------- */
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function calendarRange() {
  const base = state.calDate;
  if (state.calMode === 'week') {
    const offset = (base.getDay() + 6) % 7;
    const from = addDays(base, -offset);
    return { from, to: addDays(from, 6) };
  }
  const first = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const from = addDays(first, -offset);
  return { from, to: addDays(from, 41) };
}

async function renderCalendar() {
  if (!state.calDate) state.calDate = new Date();
  const { from, to } = calendarRange();
  const f = isoDate(from);
  const t = isoDate(to);

  const [{ data: events, error }, { data: slots }] = await Promise.all([
    sb.rpc('ts_calendar', { p_from: f, p_to: t }),
    sb.rpc('ts_calendar_slots', { p_from: f, p_to: t }),
  ]);
  if (error) return toast(errMessage(error), 'err');

  state.calEvents = events || [];
  state.calSlots = slots || [];

  const title = state.calMode === 'week'
    ? `${from.getDate()} – ${to.getDate()} de ${MONTHS[to.getMonth()]} ${to.getFullYear()}`
    : `${MONTHS[state.calDate.getMonth()]} ${state.calDate.getFullYear()}`;
  $('#calTitle').textContent = title;

  const todayISO = isoDate(new Date());
  const byDay = {};
  state.calEvents.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const freeByDay = {};
  state.calSlots.forEach((s) => {
    if (s.free > 0) (freeByDay[s.date] = freeByDay[s.date] || []).push(s);
  });

  const cells = [];
  cells.push(...DOW.map((d) => `<div class="cal-dow">${d}</div>`));

  const total = state.calMode === 'week' ? 7 : 42;
  for (let i = 0; i < total; i++) {
    const d = addDays(from, i);
    const iso = isoDate(d);
    const dow = d.getDay();
    const isDelivery = dow === 3 || dow === 6;
    const outMonth = state.calMode === 'month' && d.getMonth() !== state.calDate.getMonth();
    const evs = byDay[iso] || [];
    const free = freeByDay[iso] || [];

    const chips = evs.map((e) => {
      const cls = e.status === 'no_show' ? 'bad' : e.confirmed ? 'ok' : 'warn';
      return `<div class="cal-chip ${cls}" data-ev="${e.order_id}" title="${esc(e.code)} · ${esc(e.customer)} · ${esc(e.point)}">
        ${e.start} ${esc(e.point.split(' ')[0])} · ${esc(e.customer || '')}</div>`;
    }).join('');

    const freeChips = state.calMode === 'week'
      ? free.slice(0, 4).map((s) => `<div class="cal-chip free">libre ${s.start} · ${esc(s.point.split(' ')[0])}</div>`).join('')
      : '';

    cells.push(`<div class="cal-cell ${outMonth ? 'off' : ''} ${iso === todayISO ? 'today' : ''} ${isDelivery ? 'delivery-day' : ''}" data-day="${iso}">
      <div class="cal-num">${d.getDate()}</div>
      ${chips}${freeChips}
    </div>`);
  }

  $('#calGrid').className = `cal-grid ${state.calMode === 'week' ? 'cal-week' : ''}`;
  $('#calGrid').innerHTML = cells.join('');

  const sel = isoDate(state.calDate);
  $('#calPlanDate').textContent = `${parseISO(sel).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  await renderPlan(sel);
}

async function renderPlan(dayISO) {
  const { data, error } = await sb.rpc('ts_delivery_plan', { p_date: dayISO });
  if (error) return toast(errMessage(error), 'err');

  const journeys = data || [];
  if (!journeys.length) {
    $('#calPlan').innerHTML = '<p class="small muted">Sin entregas programadas ese día.</p>';
    return;
  }

  $('#calPlan').innerHTML = journeys.map((j) => {
    const ir = j.decision === 'ir';
    const bloque = j.bloque === 'manana' ? 'Mañana' : 'Tarde';
    const route = (j.route || []).map((r) => r.name.split(' ')[0]).join(' → ');
    const stops = (j.stops || []).map((s) => `<div class="cal-stop">
        <b>${esc(s.start)}</b>
        <span class="${s.confirmed ? '' : 'muted'}">${s.confirmed ? '✓' : '·'} ${esc(s.code)} · ${esc(s.customer || '')}</span>
        <span class="muted" style="margin-left:auto">${esc(s.point || '')}</span>
      </div>`).join('');

    return `<div class="cal-verdict ${ir ? 'ir' : 'no_ir'}">
      <b>${bloque}</b>${route ? ` · Ruta: ${esc(route)}` : ''} — ${ir
        ? `Sí hay entrega: ${j.confirmed} de ${j.total} confirmaron${route.includes('→') ? `, te desplazás a ${(j.route || []).length} puntos` : ''}.`
        : `No vayas: nadie confirmó (${j.total} cita${j.total === 1 ? '' : 's'}).`}
    </div>
    <div style="margin-bottom:.7rem">${stops}</div>`;
  }).join('');
}

/* enlaces a Google Calendar y .ics */
function googleUrl(ev) {
  const d = ev.date.replace(/-/g, '');
  const start = `${d}T${ev.start.replace(':', '')}00`;
  const end = `${d}T${ev.end.replace(':', '')}00`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Entrega ${ev.code} · ${ev.customer || ''}`,
    dates: `${start}/${end}`,
    ctz: 'America/El_Salvador',
    location: ev.point || '',
    details: `${ev.total ? 'Monto: $' + ev.total + '\n' : ''}Estado: ${STATUS_LABEL[ev.status] || ev.status}\nConfirmó: ${ev.confirmed ? 'sí' : 'no'}\nWhatsApp: ${ev.phone || '—'}\nPanel: https://compratelosv.github.io/techstore/admin.html#citas`,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function downloadIcs() {
  const evs = state.calEvents || [];
  if (!evs.length) return toast('No hay entregas en este rango', 'err');
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const body = evs.map((e) => {
    const d = e.date.replace(/-/g, '');
    return [
      'BEGIN:VEVENT',
      `UID:${e.order_id}@techstore`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/El_Salvador:${d}T${e.start.replace(':', '')}00`,
      `DTEND;TZID=America/El_Salvador:${d}T${e.end.replace(':', '')}00`,
      `SUMMARY:Entrega ${e.code} - ${(e.customer || '').replace(/[,;]/g, ' ')}`,
      `LOCATION:${(e.point || '').replace(/[,;]/g, ' ')}`,
      `DESCRIPTION:${STATUS_LABEL[e.status] || e.status} | Confirmado: ${e.confirmed ? 'si' : 'no'} | ${e.total || ''}`,
      'END:VEVENT',
    ].join('\r\n');
  }).join('\r\n');

  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TechStore SV//Entregas//ES', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR'].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'entregas-techstore.ics';
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${evs.length} entrega(s) exportadas`);
}

$('#calPrev').addEventListener('click', () => {
  state.calDate = state.calMode === 'week' ? addDays(state.calDate, -7)
    : new Date(state.calDate.getFullYear(), state.calDate.getMonth() - 1, 1, 12);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  state.calDate = state.calMode === 'week' ? addDays(state.calDate, 7)
    : new Date(state.calDate.getFullYear(), state.calDate.getMonth() + 1, 1, 12);
  renderCalendar();
});
$('#calToday').addEventListener('click', () => { state.calDate = new Date(); renderCalendar(); });

$('#calMode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-calmode]');
  if (!b) return;
  state.calMode = b.dataset.calmode;
  $$('#calMode .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
  renderCalendar();
});

$('#calIcs').addEventListener('click', downloadIcs);

$('#calCheck').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const day = isoDate(state.calDate);
  const { data, error } = await sb.rpc('ts_day_check', { p_date: day });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast(`Revisión del ${day}: ${data.avisos} aviso(s) a clientes sin confirmar`);
  renderCalendar();
});

$('#calGrid').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-ev]');
  if (chip) {
    const ev = (state.calEvents || []).find((x) => x.order_id === chip.dataset.ev);
    if (ev) {
      openDrawer({
        title: `${ev.code} · ${ev.customer || ''}`,
        subtitle: `${ev.date} · ${ev.start}–${ev.end} · ${ev.point}`,
        body: `<div class="panel">
          <p class="small" style="line-height:1.9;margin:0">
            Estado: <b>${STATUS_LABEL[ev.status] || ev.status}</b><br>
            Confirmó: <b>${ev.confirmed ? 'sí' : 'no'}</b><br>
            WhatsApp: <b>${esc(ev.phone || '—')}</b><br>
            Monto: <b>${money(ev.total)}</b>${ev.no_show_count ? `<br>Inasistencias: <b>${ev.no_show_count}</b>` : ''}
          </p>
        </div>`,
        foot: `<a class="btn primary" target="_blank" rel="noopener" href="${googleUrl(ev)}">Añadir a Google Calendar</a>
               <a class="btn" href="cita.html?t=${ev.token}" target="_blank" rel="noopener">Ver cita del cliente</a>
               <button class="btn ghost" id="evClose">Cerrar</button>`,
      });
      $('#evClose').onclick = closeDrawer;
    }
    return;
  }
  const cell = e.target.closest('[data-day]');
  if (cell) {
    state.calDate = parseISO(cell.dataset.day);
    $('#agDate').value = cell.dataset.day;
    renderCalendar();
    renderAgenda();
  }
});

/* ---------------- agenda de citas ---------------- */
async function renderAgenda() {
  const dayEl = $('#agDate');
  if (!dayEl.value) {
    dayEl.value = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await sb.rpc('ts_pickup_agenda', { p_date: dayEl.value });
  if (error) return toast(errMessage(error), 'err');

  const list = data || [];
  state.agenda = list;
  const confirmadas = list.filter((x) => x.confirmed).length;
  const noShows = list.filter((x) => x.status === 'no_show').length;

  $('#agKpis').innerHTML = `
    <div class="kpi"><span class="k-label">Citas del día</span><b>${list.length}</b></div>
    <div class="kpi"><span class="k-label">Confirmadas</span><b>${confirmadas}</b></div>
    <div class="kpi"><span class="k-label">Inasistencias</span><b>${noShows}</b></div>
    <div class="kpi"><span class="k-label">Sin confirmar</span><b>${Math.max(list.length - confirmadas - noShows, 0)}</b></div>`;

  $('#agList').innerHTML = list
    .map((x) => `<div class="line" style="grid-template-columns:auto 1fr auto;gap:.8rem;padding:.6rem 0;align-items:start">
      <div class="mono" style="font-size:1rem;min-width:52px">${esc(x.start)}</div>
      <div>
        <div class="tl-name">${esc(x.code)} · ${esc(x.customer_name || '')}</div>
        <div class="tl-sub">${esc(x.point || '')} · ${x.confirmed ? '✓ confirmado' : 'sin confirmar'} · ${x.no_show_count ? 'inasistencias: ' + x.no_show_count : ''}</div>
      </div>
      <div class="row" style="gap:.3rem">
        <span class="badge ${x.status === 'no_show' ? 'cancelado' : x.status === 'entregado' ? 'entregado' : 'pagado'}">${STATUS_LABEL[x.status] || x.status}</span>
        ${['pagado', 'en_preparacion', 'listo', 'en_ruta'].includes(x.status)
          ? `<button class="btn sm ghost" data-nshow="${x.order_id}">No se presentó</button>` : ''}
        ${x.status === 'no_show' ? `<button class="btn sm danger" data-ncancel="${x.order_id}">Cancelar · retiene 20%</button>` : ''}
      </div>
    </div>`)
    .join('');
  $('#agEmpty').hidden = list.length > 0;
}

$('#agRefresh').addEventListener('click', renderAgenda);
$('#agDate').addEventListener('change', renderAgenda);

$('#agList').addEventListener('click', async (e) => {
  const ns = e.target.closest('[data-nshow]');
  const nc = e.target.closest('[data-ncancel]');
  if (ns) {
    if (!confirm('Marcar como inasistencia? Se le enviará la opción de reagendar.')) return;
    const { error } = await sb.rpc('ts_mark_no_show', { p_order_id: ns.dataset.nshow });
    if (error) return toast(errMessage(error), 'err');
    toast('Marcado como inasistencia');
    renderAgenda();
  }
  if (nc) {
    if (!confirm('Cancelar definitivamente? Se retiene el 20% del total.')) return;
    const { data, error } = await sb.rpc('ts_cancel_no_show', { p_order_id: nc.dataset.ncancel });
    if (error) return toast(errMessage(error), 'err');
    toast(`Cancelado. Retención ${money(data.refund_retained)}`);
    renderAgenda();
  }
});

/* ---------------- redes sociales y APIs ---------------- */
const SOCIAL_NETS = [
  { key: 'instagram', label: 'Instagram', secret: 'meta_secret' },
  { key: 'facebook', label: 'Facebook', secret: 'meta_secret' },
  { key: 'tiktok', label: 'TikTok', secret: 'tiktok_secret' },
  { key: 'whatsapp', label: 'WhatsApp Business', secret: 'whatsapp_token' },
];

async function renderSocial() {
  const [{ data: cfg }, { data: secrets }] = await Promise.all([
    sb.from('ts_settings').select('value').eq('key', 'social').maybeSingle(),
    sb.rpc('ts_secrets_status'),
  ]);
  const social = cfg?.value || {};
  const conf = secrets || {};

  $('#socialGrid').innerHTML = SOCIAL_NETS.map((net) => {
    const v = social[net.key] || {};
    const api = v.api || {};
    const hasSecret = !!conf[net.secret]?.configured;
    return `<div class="panel" style="margin-bottom:.8rem;background:var(--bg-2)">
      <div class="row" style="justify-content:space-between;align-items:center">
        <b>${net.label}</b>
        <label class="row" style="gap:.4rem;font-size:.8rem;align-items:center">
          <input type="checkbox" data-net="${net.key}" data-field="enabled" ${v.enabled ? 'checked' : ''}> Mostrar en la tienda
        </label>
      </div>
      <div class="row" style="gap:.6rem">
        <div class="field" style="flex:1"><label>Usuario</label>
          <input data-net="${net.key}" data-field="handle" value="${esc(v.handle || '')}" placeholder="@tunegocio"></div>
        <div class="field" style="flex:1"><label>Enlace</label>
          <input data-net="${net.key}" data-field="url" value="${esc(v.url || '')}" placeholder="https://…"></div>
      </div>
      <div class="row" style="gap:.6rem;align-items:flex-end;margin-top:.3rem">
        <div class="field" style="flex:1"><label>App / Client ID</label>
          <input data-net="${net.key}" data-field="app_id" value="${esc(api.app_id || '')}" placeholder="1234567890"></div>
        <div class="field" style="flex:1"><label>Client Secret ${hasSecret ? '· guardado ✓' : ''}</label>
          <input type="password" data-secret="${net.secret}" placeholder="${hasSecret ? '•••••••• (dejar vacío para conservar)' : 'pegar secreto'}"></div>
      </div>
      <div class="small muted" style="margin-top:.3rem">
        ${api.enabled ? 'API activada' : 'API sin activar'} · ${hasSecret ? 'credencial guardada, no legible desde el navegador' : 'sin credencial'}
      </div>
    </div>`;
  }).join('');
}

$('#socialSave').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const social = {};
  SOCIAL_NETS.forEach((net) => {
    const get = (f) => document.querySelector(`[data-net="${net.key}"][data-field="${f}"]`);
    social[net.key] = {
      handle: get('handle')?.value.trim() || '',
      url: get('url')?.value.trim() || '',
      enabled: !!get('enabled')?.checked,
      api: {
        enabled: false,
        app_id: get('app_id')?.value.trim() || '',
        secret_key: net.secret,
        status: 'no_configurado',
      },
    };
  });

  const { error } = await sb.rpc('ts_save_setting', { p_key: 'social', p_value: social });
  if (error) { btn.disabled = false; return toast(errMessage(error), 'err'); }

  let guardados = 0;
  for (const net of SOCIAL_NETS) {
    const inp = document.querySelector(`[data-secret="${net.secret}"]`);
    if (inp?.value.trim()) {
      const { error: se } = await sb.rpc('ts_save_secret', { p_key: net.secret, p_value: inp.value.trim() });
      if (!se) guardados++;
    }
  }
  btn.disabled = false;
  toast(guardados ? `Redes guardadas · ${guardados} credencial(es) asegurada(s)` : 'Redes guardadas');
  renderSocial();
});

/* ---------------- usuarios y roles ---------------- */
const ROLE_LABEL = { admin: 'Administrador', operador: 'Operador', cajero: 'Cajero', transportista: 'Transportista', community_manager: 'Community manager', cliente: 'Cliente' };

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

const USERS = {
  list: [],
  cargada: false,
  q: '',
  role: 'all',
  active: 'all',
  sort: { key: 'name', dir: 'asc' },
};

const ROLE_ORDER = { admin: 0, operador: 1, transportista: 2, community_manager: 3, cliente: 4 };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function saveUsersPrefs() {
  try {
    localStorage.setItem('ts.users.prefs', JSON.stringify({
      q: USERS.q, role: USERS.role, active: USERS.active, sort: USERS.sort,
    }));
  } catch { /* modo privado: se ignora */ }
}

function loadUsersPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ts.users.prefs') || '{}');
    if (typeof p.q === 'string') USERS.q = p.q;
    if (p.role) USERS.role = p.role;
    if (p.active) USERS.active = p.active;
    if (p.sort?.key) USERS.sort = { key: p.sort.key, dir: p.sort.dir === 'desc' ? 'desc' : 'asc' };
  } catch { /* preferencias corruptas: se usan los valores por defecto */ }
}

function usersFiltrados() {
  const q = norm(USERS.q).trim();
  const rows = USERS.list.filter((u) => {
    if (USERS.role !== 'all' && u.role !== USERS.role) return false;
    if (USERS.active !== 'all' && String(u.active) !== USERS.active) return false;
    if (!q) return true;
    return norm(u.full_name).includes(q) || norm(u.email).includes(q);
  });

  const { key, dir } = USERS.sort;
  const mul = dir === 'asc' ? 1 : -1;
  const byName = (a, b) => norm(a.full_name).localeCompare(norm(b.full_name));

  rows.sort((a, b) => {
    if (key === 'role') return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byName(a, b);
    if (key === 'active') return (Number(b.active) - Number(a.active)) * mul || byName(a, b);
    if (key === 'last') {
      const ta = a.last_sign_in ? new Date(a.last_sign_in).getTime() : -1;
      const tb = b.last_sign_in ? new Date(b.last_sign_in).getTime() : -1;
      return (ta - tb) * mul;
    }
    if (key === 'email') return norm(a.email).localeCompare(norm(b.email)) * mul;
    return byName(a, b) * mul;
  });
  return rows;
}

function pintarUsuarios() {
  const chipsEl = document.getElementById('usrRoleChips');
  const conteo = { all: USERS.list.length };
  USERS.list.forEach((u) => { conteo[u.role] = (conteo[u.role] || 0) + 1; });

  const chips = [['all', 'Todos'], ['admin', 'Admin'], ['operador', 'Operadores'], ['transportista', 'Transportistas']];
  if (conteo.community_manager) chips.push(['community_manager', 'Marketing']);
  chips.push(['cliente', 'Clientes']);

  if (chipsEl) {
    chipsEl.innerHTML = chips.map(([v, label]) => `
      <button type="button" class="usr-chip ${USERS.role === v ? 'active' : ''}" data-role-chip="${v}">
        ${label} <b>${conteo[v] || 0}</b></button>`).join('');
  }

  const selRole = document.getElementById('usrRoleFilter');
  if (selRole) selRole.value = USERS.role;
  const selActive = document.getElementById('usrActiveFilter');
  if (selActive) selActive.value = USERS.active;
  const search = document.getElementById('usrSearch');
  if (search && search.value !== USERS.q) search.value = USERS.q;

  document.querySelectorAll('#usersTable th[data-sort]').forEach((th) => {
    const activo = th.dataset.sort === USERS.sort.key;
    th.classList.toggle('sorted', activo);
    const dir = activo ? (USERS.sort.dir === 'asc' ? '▲' : '▼') : '';
    th.dataset.dir = dir;
    const flecha = th.querySelector('.th-dir');
    if (flecha) flecha.textContent = dir;
  });

  const rows = usersFiltrados();
  const tbody = $('#usersTable').querySelector('tbody');
  const vacio = document.getElementById('usersEmpty');
  if (vacio) vacio.hidden = rows.length > 0;

  tbody.innerHTML = rows.map((u) => {
    const self = u.id === state.profile.id;
    return `<tr>
      <td data-label="Nombre">${esc(u.full_name || '—')}${self ? ' <span class="small muted">(tú)</span>' : ''}</td>
      <td data-label="Correo" class="small mono">${esc(u.email || '')}</td>
      <td data-label="Rol">
        <select class="btn sm" data-role="${u.id}" ${self ? 'disabled' : ''}>
          ${['admin', 'operador', 'cajero', 'transportista', 'community_manager', 'cliente']
            .map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r] || r}</option>`)
            .join('')}
        </select>
      </td>
      <td data-label="Escaneo">${u.role === 'transportista'
        ? `<button class="btn sm ${u.scan_delivery ? '' : 'ghost'}" data-scanperm="${u.id}" data-on="${u.scan_delivery}">
             ${u.scan_delivery ? '📷 Activo' : 'Apagado'}</button>`
        : '<span class="small muted">—</span>'}</td>
      <td data-label="Estado">${u.active
        ? '<span class="badge entregado">Activo</span>'
        : '<span class="badge cancelado">Inactivo</span>'}</td>
      <td data-label="Último acceso" class="small muted">${u.last_sign_in ? fmtDate(u.last_sign_in) : 'nunca'}</td>
      <td data-label="Acciones" class="row" style="gap:.35rem">
        <button class="btn sm" data-reset="${u.id}" data-email="${esc(u.email || '')}">Contraseña</button>
        ${self ? '' : `<button class="btn sm danger" data-del="${u.id}" data-email="${esc(u.email || '')}">Borrar</button>`}
        <button class="btn sm ghost" data-edit="${u.id}" data-name="${esc(u.full_name || '')}" data-phone="${esc(u.phone || '')}" data-email="${esc(u.email || '')}">Editar</button>
        ${self ? '' : `<button class="btn sm ${u.active ? 'danger' : ''}" data-toggle="${u.id}" data-active="${u.active}">
            ${u.active ? 'Desactivar' : 'Activar'}
          </button>`}
      </td>
    </tr>`;
  }).join('');
}

async function renderUsers() {
  if (state.profile?.role !== 'admin') {
    toast('Solo el administrador puede ver los usuarios', 'err');
    return setView('orders');
  }
  if (!USERS.cargada) {
    loadUsersPrefs();
    USERS.cargada = true;
  }

  const tbody = $('#usersTable').querySelector('tbody');
  if (!USERS.list.length) tbody.innerHTML = '<tr><td colspan="7" class="small muted">Cargando…</td></tr>';

  const { data, error } = await sb.rpc('ts_admin_list_users');
  if (error) {
    tbody.innerHTML = '';
    return toast(errMessage(error), 'err');
  }
  USERS.list = data || [];
  pintarUsuarios();
}

/* filtros, orden y selectores de la tabla de usuarios */
$('#usrRoleChips')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-role-chip]');
  if (!b) return;
  USERS.role = b.dataset.roleChip;
  saveUsersPrefs();
  pintarUsuarios();
});

$('#usrRoleFilter')?.addEventListener('change', (e) => {
  USERS.role = e.target.value;
  saveUsersPrefs();
  pintarUsuarios();
});

$('#usrActiveFilter')?.addEventListener('change', (e) => {
  USERS.active = e.target.value;
  saveUsersPrefs();
  pintarUsuarios();
});

$('#usrSearch')?.addEventListener('input', (e) => {
  USERS.q = e.target.value;
  saveUsersPrefs();
  pintarUsuarios();
});

$('#usersTable')?.querySelector('thead')?.addEventListener('click', (e) => {
  if (e.target.closest('.th-sel')) return; // el desplegable filtra, no ordena
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (USERS.sort.key === key) {
    USERS.sort.dir = USERS.sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    USERS.sort = { key, dir: 'asc' };
  }
  saveUsersPrefs();
  pintarUsuarios();
});

$('#usersTable').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-scanperm]');
  if (!b) return;
  const on = String(b.dataset.on) !== 'true';
  b.disabled = true;
  const { error } = await sb.rpc('ts_admin_set_scan_delivery', {
    p_user_id: b.dataset.scanperm,
    p_enabled: on,
  });
  b.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast(on ? 'Escaneo de entregas habilitado' : 'Escaneo de entregas deshabilitado');
  renderUsers();
});

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

/* ---------- cambio de contraseña y datos con motivo registrado ---------- */
const RESET_REASONS = [
  'Olvidó su contraseña y no pudo recuperarla',
  'No le llegó el correo de recuperación',
  'Sospecha de acceso no autorizado',
  'Entrega de credenciales a personal nuevo',
  'Solicitud del titular por otro medio',
  'Cuenta bloqueada por intentos fallidos',
];
const ACTION_LABEL = {
  reset_password: 'Contraseña',
  edit_user: 'Datos',
  set_role: 'Rol',
  set_active: 'Estado',
  create_user: 'Alta',
};

function openResetPassword(userId, email) {
  openDrawer({
    title: 'Restablecer contraseña',
    subtitle: email || '',
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <p class="small muted" style="margin-top:0">Se genera una contraseña temporal y la persona deberá cambiarla la próxima vez que entre.</p>
        <div class="field"><label for="rpReason">Motivo *</label>
          <select id="rpReason">
            <option value="">— Elige el motivo —</option>
            ${RESET_REASONS.map((r) => `<option value="${r}">${r}</option>`).join('')}
          </select></div>
        <div class="field"><label for="rpDetail">Detalle</label>
          <input id="rpDetail" placeholder="Ej: llamó al 7662-6575"></div>
        <p class="small muted">Queda registrado quién lo cambió, cuándo y por qué.</p>
      </div>`,
    foot: `<button class="btn primary" id="rpGo">Restablecer</button>
           <button class="btn ghost" id="rpCancel">Cancelar</button>`,
  });
  $('#rpCancel').onclick = closeDrawer;
  $('#rpGo').onclick = async () => {
    const motivo = $('#rpReason').value;
    if (!motivo) return toast('Elige el motivo del cambio', 'err');
    const detalle = ($('#rpDetail').value || '').trim();
    const btn = $('#rpGo');
    btn.disabled = true;
    const { data, error } = await sb.rpc('ts_admin_reset_password', {
      p_user_id: userId,
      p_reason: detalle ? `${motivo} — ${detalle}` : motivo,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    closeDrawer();
    toast('Contraseña temporal generada');
    showCredentials({ email: data.email, password: data.password, role: 'usuario' });
    await renderUsers();
  };
}

function openEditUser(ds) {
  openDrawer({
    title: 'Editar usuario',
    subtitle: ds.email || '',
    body: `
      <div class="panel">
        <div class="field"><label for="euName">Nombre completo</label>
          <input id="euName" value="${esc(ds.name || '')}"></div>
        <div class="field"><label for="euPhone">Teléfono</label>
          <input id="euPhone" value="${esc(ds.phone || '')}"></div>
        <div class="field"><label for="euReason">Motivo del cambio *</label>
          <input id="euReason" placeholder="Ej: corrigió su número de teléfono"></div>
      </div>`,
    foot: `<button class="btn primary" id="euGo">Guardar</button>
           <button class="btn ghost" id="euCancel">Cancelar</button>`,
  });
  $('#euCancel').onclick = closeDrawer;
  $('#euGo').onclick = async () => {
    const reason = ($('#euReason').value || '').trim();
    if (reason.length < 8) return toast('Escribe el motivo (mínimo 8 caracteres)', 'err');
    const { error } = await sb.rpc('ts_admin_update_user', {
      p_user_id: ds.edit,
      p_full_name: $('#euName').value,
      p_phone: $('#euPhone').value,
      p_reason: reason,
    });
    if (error) return toast(errMessage(error), 'err');
    closeDrawer();
    toast('Usuario actualizado');
    await renderUsers();
  };
}

async function openAuditLog() {
  const { data, error } = await sb.rpc('ts_admin_audit_list', { p_limit: 100 });
  if (error) return toast(errMessage(error), 'err');
  const rows = data || [];
  openDrawer({
    title: 'Historial de cambios',
    subtitle: 'Quién cambió qué, cuándo y por qué',
    body: rows.length
      ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Cuándo</th><th>Acción</th><th>Usuario</th><th>Motivo</th><th>Quién</th></tr></thead>
          <tbody>${rows
            .map(
              (r) => `<tr>
            <td class="small">${fmtDate(r.created_at)}</td>
            <td>${esc(ACTION_LABEL[r.action] || r.action)}</td>
            <td class="small">${esc(r.target_email || '')}</td>
            <td class="small">${esc(r.reason || '')}</td>
            <td class="small muted">${esc(r.actor_email || '')}</td>
          </tr>`
            )
            .join('')}</tbody></table></div>`
      : '<p class="small muted">Sin cambios registrados.</p>',
    foot: `<button class="btn ghost" id="alClose">Cerrar</button>`,
  });
  $('#alClose').onclick = closeDrawer;
}

$('#btnAuditLog').addEventListener('click', openAuditLog);

$('#usersTable').addEventListener('click', async (e) => {
  const reset = e.target.closest('[data-reset]');
  const edit = e.target.closest('[data-edit]');
  const toggle = e.target.closest('[data-toggle]');

  if (reset) return openResetPassword(reset.dataset.reset, reset.dataset.email);
  if (edit) return openEditUser(edit.dataset);

  const del = e.target.closest('[data-del]');
  if (del) {
    const email = del.dataset.email;
    const ok = confirm(
      'BORRADO DEFINITIVO DE CUENTA\n\n' +
        `Se eliminará la cuenta:\n${email}\n\n` +
        'Esta acción NO se puede deshacer: la persona pierde el acceso, su perfil y sus favoritos.\n\n' +
        'Los pedidos ya emitidos se conservan por obligación fiscal.\n\n' +
        '¿Querés continuar?'
    );
    if (!ok) return;

    const escrito = prompt(`Para confirmar el borrado, escribí el correo exacto de la cuenta:\n\n${email}`);
    if (escrito === null) return;

    const motivo = prompt('Motivo del borrado (queda guardado en el registro de auditoría):');
    if (motivo === null) return;
    if ((motivo || '').trim().length < 5) return toast('Escribí un motivo de al menos 5 caracteres', 'err');

    const pass = prompt('Para autorizar el borrado, escribí TU contraseña de administrador:');
    if (pass === null) return;

    del.disabled = true;
    const { data: yo } = await sb.auth.getUser();
    const { error: passMal } = await sb.auth.signInWithPassword({
      email: yo.user.email,
      password: pass,
    });
    if (passMal) {
      del.disabled = false;
      return toast('Contraseña incorrecta: no se borró nada', 'err');
    }

    const { data, error } = await sb.rpc('ts_admin_delete_account', {
      p_user_id: del.dataset.del,
      p_confirmacion: escrito,
      p_reason: motivo,
    });
    del.disabled = false;

    if (error) return toast(errMessage(error), 'err');
    toast(`Cuenta de ${data.email} borrada · quedó registrada en auditoría`);
    await refreshAll();
    return;
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
            <option value="cajero">Cajero / Dependienta — solo POS, caja y clientes</option>
            <option value="transportista">Transportista — solo sus entregas</option>
            <option value="community_manager">Community manager — solo crecimiento</option>
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

  const verMargen = data.is_admin ?? (state.profile?.role === 'admin');
  $('#salesKpis').innerHTML = `
    <div class="kpi"><span>Ingresos</span><b>${money(t.revenue)}</b>${deltaBadge(shareDelta)}</div>
    <div class="kpi"><span>Pedidos</span><b>${t.orders || 0}</b>${deltaBadge(ordersDelta)}</div>
    <div class="kpi"><span>Ticket promedio</span><b>${money(t.avg_ticket)}</b></div>
    <div class="kpi"><span>Unidades vendidas</span><b>${t.units || 0}</b></div>
    ${verMargen ? `<div class="kpi"><span>Margen bruto</span><b>${money(t.margin)}</b>
      <span class="small muted" style="text-transform:none;letter-spacing:0">costo ${money(t.cost)}</span></div>` : ''}`;

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

/* crear categoría al vuelo desde el desplegable del producto */
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('#fCat');
  if (!sel || sel.value !== '__new') return;
  const nombre = prompt('Nombre de la nueva categoría (ej: Ropa, Zapatos, Skincare):');
  if (!nombre || !nombre.trim()) { sel.value = ''; return; }
  const limpio = nombre.trim();
  const slug = limpio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const orden = Math.max(0, ...state.categories.map((c) => c.sort_order || 0)) + 1;
  const { data, error } = await sb.from('ts_categories')
    .insert({ name: limpio, slug, sort_order: orden }).select().single();
  if (error) return toast(errMessage(error), 'err');
  await loadCategories();
  const opts = state.categories
    .map((c) => `<option value="${c.id}" ${c.id === data.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('') + '<option value="__new">＋ Nueva categoría…</option>';
  sel.innerHTML = '<option value="">— sin categoría —</option>' + opts;
  sel.value = data.id;
  toast(`Categoría “${data.name}” creada`);
});

/* administrar categorías */
const btnCat = document.getElementById('btnCategories');
if (btnCat) btnCat.onclick = () => openCategories();

async function openCategories() {
  const { data: cats } = await sb.from('ts_categories').select('*').order('sort_order');
  const { data: prods } = await sb.from('ts_products').select('category_id');
  const usos = {};
  (prods || []).forEach((p) => { if (p.category_id) usos[p.category_id] = (usos[p.category_id] || 0) + 1; });

  openDrawer({
    title: 'Categorías de productos',
    subtitle: 'Agregá rubros nuevos: ropa, zapatos, skincare…',
    body: `
      <div class="field">
        <label>Nueva categoría</label>
        <div class="row" style="gap:.4rem">
          <input id="ncName" placeholder="Ej: Ropa" style="flex:1">
          <button class="btn" id="ncAdd">Agregar</button>
        </div>
      </div>
      <table class="table" style="margin-top:.8rem">
        <thead><tr><th>Categoría</th><th>Productos</th><th></th></tr></thead>
        <tbody>
          ${(cats || []).map((c) => `
            <tr>
              <td data-label="Categoría"><b>${esc(c.name)}</b><div class="small muted mono">${esc(c.slug)}</div></td>
              <td data-label="Productos">${usos[c.id] || 0}</td>
              <td data-label="" class="row" style="gap:.3rem">
                <button class="btn sm ghost" data-cat-rename="${c.id}" data-name="${esc(c.name)}">Renombrar</button>
                ${(usos[c.id] || 0) > 0
                  ? '<span class="small muted">en uso</span>'
                  : `<button class="btn sm danger" data-cat-del="${c.id}" data-name="${esc(c.name)}">Borrar</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="small muted" style="margin-top:.6rem">Una categoría con productos no se puede borrar: primero movés esos productos a otra.</p>`,
    foot: '<button class="btn ghost" data-close-drawer>Cerrar</button>',
  });

  const crear = async () => {
    const inp = document.getElementById('ncName');
    const nombre = (inp.value || '').trim();
    if (nombre.length < 2) return toast('Escribí un nombre', 'err');
    const slug = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const orden = Math.max(0, ...(cats || []).map((c) => c.sort_order || 0)) + 1;
    const { error } = await sb.from('ts_categories').insert({ name: nombre, slug, sort_order: orden });
    if (error) return toast(errMessage(error), 'err');
    toast('Categoría agregada');
    await loadCategories();
    await refreshAll();
    openCategories();
  };
  const btnAdd = document.getElementById('ncAdd');
  if (btnAdd) btnAdd.onclick = crear;
  const inp = document.getElementById('ncName');
  if (inp) inp.onkeydown = (ev) => { if (ev.key === 'Enter') crear(); };
}

document.addEventListener('click', async (e) => {
  const ren = e.target.closest('[data-cat-rename]');
  if (ren) {
    const nuevo = prompt('Nuevo nombre de la categoría:', ren.dataset.name);
    if (!nuevo || !nuevo.trim()) return;
    const { error } = await sb.from('ts_categories').update({ name: nuevo.trim() }).eq('id', ren.dataset.cat_rename);
    if (error) return toast(errMessage(error), 'err');
    toast('Categoría renombrada');
    await loadCategories(); await refreshAll(); openCategories();
    return;
  }
  const del = e.target.closest('[data-cat-del]');
  if (del) {
    if (!confirm(`¿Borrar la categoría “${del.dataset.name}”?\n\nSolo se puede si no tiene productos.`)) return;
    const { error } = await sb.from('ts_categories').delete().eq('id', del.dataset.cat_del);
    if (error) return toast(errMessage(error), 'err');
    toast('Categoría borrada');
    await loadCategories(); await refreshAll(); openCategories();
  }
});

function openProductEditor(p = null) {
  const catOptions = state.categories
    .map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('') + '<option value="__new">＋ Nueva categoría…</option>';

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
          ${state.profile?.role === 'admin' ? `<div class="field" style="flex:1">
            <label for="fCost">Costo</label>
            <input id="fCost" type="number" step="0.01" min="0" value="${p?.cost ?? ''}">
          </div>` : ''}
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
        <div class="field">
          <label>Fotos del producto</label>
          <div id="fGallery" class="photo-grid"></div>
          <div class="row" style="gap:.6rem;margin-top:.45rem;align-items:center">
            <button class="btn sm" type="button" id="fAddPhoto">📷 Agregar fotos</button>
            <span class="small muted" id="fPhotoHint">JPG, PNG o WebP · máx. 5 MB · la primera es la portada</span>
          </div>
          <input type="file" id="fPhotoInput" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden>
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

  /* ---------- fotos del producto ---------- */
  const MAX_PHOTOS = 6;
  const MAX_BYTES = 5 * 1024 * 1024;
  let photos = Array.isArray(p?.images) && p.images.length
    ? p.images.filter(Boolean)
    : (p?.image_url ? [p.image_url] : []);
  const hintPhoto = document.getElementById('fPhotoHint');
  const hintDefault = hintPhoto ? hintPhoto.textContent : '';

  function renderGallery() {
    const box = document.getElementById('fGallery');
    if (!box) return;
    box.innerHTML = photos.length
      ? photos.map((url, i) => `
        <div class="photo-thumb ${i === 0 ? 'primary' : ''}">
          <img src="${esc(url)}" alt="Foto ${i + 1}">
          ${i === 0
            ? '<span class="pt-badge">PORTADA</span>'
            : `<button type="button" class="pt-cover" data-cover="${i}" title="Usar como portada">Portada</button>`}
          <button type="button" class="pt-del" data-del="${i}" title="Quitar foto">✕</button>
        </div>`).join('')
      : '<span class="photo-empty">Sin fotos todavía. La tienda usará la imagen por defecto.</span>';
  }

  document.getElementById('fAddPhoto').onclick = () => document.getElementById('fPhotoInput').click();

  document.getElementById('fGallery').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      photos.splice(Number(del.dataset.del), 1);
      return renderGallery();
    }
    const cov = e.target.closest('[data-cover]');
    if (cov) {
      const [url] = photos.splice(Number(cov.dataset.cover), 1);
      photos.unshift(url);
      renderGallery();
    }
  };

  document.getElementById('fPhotoInput').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return toast(`Máximo ${MAX_PHOTOS} fotos por producto`, 'err');
    if (files.length > room) toast(`Solo caben ${room} foto(s) más`, 'err');

    const skuBase = (document.getElementById('fSku').value.trim() || 'producto')
      .toLowerCase().replace(/[^a-z0-9-]/g, '') || 'producto';
    let subidas = 0;

    for (const file of files.slice(0, room)) {
      if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) {
        toast(`"${file.name}" no es JPG, PNG, WebP ni AVIF`, 'err');
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast(`"${file.name}" pesa ${(file.size / 1048576).toFixed(1)} MB (máximo 5 MB)`, 'err');
        continue;
      }
      if (hintPhoto) hintPhoto.textContent = `Subiendo ${file.name}…`;
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const path = `${skuBase}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from('ts-productos').upload(path, file, {
        cacheControl: '31536000', upsert: false, contentType: file.type,
      });
      if (error) {
        toast(errMessage(error), 'err');
        continue;
      }
      const { data } = sb.storage.from('ts-productos').getPublicUrl(path);
      photos.push(data.publicUrl);
      subidas += 1;
      renderGallery();
    }

    if (hintPhoto) hintPhoto.textContent = hintDefault;
    if (subidas) toast(`${subidas} foto${subidas === 1 ? '' : 's'} subida${subidas === 1 ? '' : 's'}`);
  };

  renderGallery();

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
      stock: Number(document.getElementById('fStock').value || 0),
      low_stock: Number(document.getElementById('fLow').value || 0),
      barcode: document.getElementById('fBarcode').value.trim() || newBarcode(),
      description: document.getElementById('fDesc').value.trim() || null,
      image_url: photos[0] || null,
      images: photos,
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

    const { data: saved, error } = p
      ? await sb.from('ts_products').update(payload).eq('id', p.id).select().single()
      : await sb.from('ts_products').insert(payload).select().single();

    if (error) {
      toast(errMessage(error), 'err');
      btn.disabled = false;
      btn.textContent = 'Guardar producto';
      return;
    }

    // El costo se guarda aparte, en la tabla que solo ve el administrador.
    const costEl = document.getElementById('fCost');
    if (state.profile?.role === 'admin' && costEl && saved?.id) {
      const valor = costEl.value === '' ? null : Number(costEl.value);
      const { error: costErr } = await sb.from('ts_product_costs')
        .upsert({ product_id: saved.id, cost: valor, updated_at: new Date().toISOString() });
      if (costErr) toast(`Costo no guardado: ${errMessage(costErr)}`, 'err');
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
