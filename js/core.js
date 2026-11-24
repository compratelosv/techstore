/* core.js — cliente Supabase, utilidades y cabecera compartida. */

import './config.js'; // define window.TS_CONFIG antes de crear el cliente

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TS_CONFIG;

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ---------- utilidades ---------- */
export const money = (v) =>
  v === null || v === undefined || v === ''
    ? '—'
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.className = `toast ${kind} show`;
  box.textContent = msg;
  clearTimeout(box._t);
  box._t = setTimeout(() => (box.className = 'toast'), 3200);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export const STATUS_LABEL = {
  pendiente_pago: 'Pendiente de pago',
  pagado: 'Pagado · por preparar',
  en_preparacion: 'En preparación',
  listo: 'Listo para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  reembolsado: 'Reembolsado',
};

/* ---------- sesión ---------- */
export async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await sb.from('ts_profiles').select('*').eq('id', user.id).maybeSingle();
  return data;
}

export async function requireLogin(redirect = location.pathname) {
  const user = await getUser();
  if (!user) {
    location.href = `cuenta.html?next=${encodeURIComponent(redirect)}`;
    return null;
  }
  return user;
}

/* ---------- cabecera ---------- */
export async function mountHeader({ active = '' } = {}) {
  const el = document.querySelector('[data-header]');
  if (!el) return;
  const user = await getUser();
  const count = Number(localStorage.getItem('ts.cart.count') || 0);

  el.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="index.html">
        <span class="brand-mark">TS</span>
        <span>${esc(window.TS_CONFIG.STORE_NAME)}</span>
      </a>
      <nav class="main-nav">
        <a href="index.html" class="${active === 'home' ? 'active' : ''}">Tienda</a>
        <a href="index.html#catalogo" class="${active === 'catalog' ? 'active' : ''}">Catálogo</a>
        <a href="cuenta.html" class="${active === 'account' ? 'active' : ''}">${user ? 'Mi cuenta' : 'Ingresar'}</a>
        <a href="admin.html" class="nav-admin">Panel</a>
      </nav>
      <a class="cart-link" href="carrito.html" aria-label="Carrito">
        <span>Carrito</span><b data-cart-count>${count || ''}</b>
      </a>
    </div>`;
}

export function setCartCount(n) {
  localStorage.setItem('ts.cart.count', String(n));
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = n || ''));
}

/* ---------- errores legibles ---------- */
export function errMessage(err) {
  const m = err?.message || String(err);
  if (/JWT|token/i.test(m)) return 'Tu sesión expiró. Vuelve a ingresar.';
  if (/row-level security/i.test(m)) return 'No tienes permiso para esta acción.';
  if (/duplicate key/i.test(m)) return 'Ese registro ya existe.';
  if (/User is banned|banned/i.test(m)) return 'Esta cuenta está desactivada. Habla con el administrador.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Database error querying schema/i.test(m)) return 'No se pudo validar la cuenta. Intenta de nuevo en un momento.';
  return m;
}
