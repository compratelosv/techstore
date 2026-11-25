/* core.js — cliente Supabase, utilidades y cabecera compartida. */

import './config.js'; // define window.TS_CONFIG antes de crear el cliente

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TS_CONFIG;

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ---------- utilidades ---------- */
/* ---------- moneda ---------- */
// Configuración viva de la moneda; se carga de ts_settings al arrancar.
let CUR = { code: 'USD', symbol: '$', decimals: 2, locale: 'en-US' };

export function getCurrency() {
  return { ...CUR };
}

export function setCurrency(cfg) {
  if (cfg && typeof cfg === 'object') CUR = { ...CUR, ...cfg };
  return CUR;
}

/** Lee la moneda configurada por el administrador (lectura pública). */
export async function loadCurrency() {
  try {
    const { data } = await sb.from('ts_settings').select('value').eq('key', 'currency').maybeSingle();
    if (data?.value) setCurrency(data.value);
  } catch { /* se queda con la moneda por defecto */ }
  return CUR;
}

/* ---------- tema (claro / oscuro) ---------- */
/** Aplica el tema guardado. La tienda y el panel tienen su propio ajuste. */
export async function loadTheme() {
  const isAdmin = !!document.getElementById('appShell');
  let mode = isAdmin ? 'dark' : 'light';
  try {
    const { data } = await sb.from('ts_settings').select('value').eq('key', 'theme').maybeSingle();
    const cfg = data?.value || {};
    mode = (isAdmin ? cfg.admin : cfg.store) || mode;
  } catch { /* se queda con el tema por defecto */ }
  applyTheme(mode);
  return mode;
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  return mode;
}

/* ---------- panel deslizante: cortina y cierre al tocar fuera ---------- */
export function openDrawerUI() {
  const s = document.getElementById('drawerScrim');
  if (s) {
    s.hidden = false;
    requestAnimationFrame(() => s.classList.add('show'));
  }
  document.body.classList.add('drawer-open');
}

export function closeDrawerUI() {
  const d = document.querySelector('.drawer.open');
  if (d) {
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  }
  const s = document.getElementById('drawerScrim');
  if (s) {
    s.classList.remove('show');
    setTimeout(() => {
      if (!document.querySelector('.drawer.open')) s.hidden = true;
    }, 220);
  }
  document.body.classList.remove('drawer-open');
}

/** Engancha la cortina y la tecla Escape (una sola vez por página). */
export function initDrawerDismiss() {
  const s = document.getElementById('drawerScrim');
  if (!s) return;
  s.addEventListener('click', closeDrawerUI);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.drawer.open')) closeDrawerUI();
  });
}

/* ---------- redes sociales en la tienda ---------- */
const SOCIAL_META = {
  instagram: { label: 'Instagram', icon: '📷' },
  facebook: { label: 'Facebook', icon: '📘' },
  tiktok: { label: 'TikTok', icon: '🎵' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
};

/** Solo acepta enlaces http(s): evita javascript: u otros esquemas. */
function safeUrl(u) {
  try {
    const parsed = new URL(String(u), location.origin);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

/** Pinta en el pie los enlaces sociales marcados como visibles. */
export async function mountSocial() {
  const host = document.querySelector('[data-social]') || document.querySelector('footer');
  if (!host || host.querySelector('.social-links')) return;
  try {
    const { data } = await sb.from('ts_settings').select('value').eq('key', 'social').maybeSingle();
    const social = data?.value || {};
    const links = Object.entries(social)
      .map(([key, v]) => ({ key, url: safeUrl(v?.url), on: !!v?.enabled, handle: v?.handle || '' }))
      .filter((r) => r.on && r.url)
      .map((r) => `<a class="social-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">${SOCIAL_META[r.key]?.icon || '↗'}</span> ${esc(r.handle || SOCIAL_META[r.key]?.label || r.key)}
      </a>`);
    if (!links.length) return;
    const box = document.createElement('div');
    box.className = 'social-links';
    box.innerHTML = `<span class="muted small">Síguenos:</span> ${links.join('')}`;
    host.appendChild(box);
  } catch { /* sin redes configuradas: no se muestra nada */ }
}

export const money = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  let formatted;
  try {
    formatted = n.toLocaleString(CUR.locale || 'en-US', {
      minimumFractionDigits: CUR.decimals ?? 2,
      maximumFractionDigits: CUR.decimals ?? 2,
    });
  } catch {
    formatted = n.toFixed(CUR.decimals ?? 2);
  }
  return `${CUR.symbol || ''}${formatted}`;
};

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
  en_ruta: 'En ruta',
  entregado: 'Entregado',
  no_show: 'No se presentó',
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
  await loadCurrency();
  await loadTheme();
  mountSocial();
  const business = await loadBusinessName();
  const count = Number(localStorage.getItem('ts.cart.count') || 0);

  el.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="index.html">
        <span class="brand-mark">TS</span>
        <span>${esc(business || window.TS_CONFIG.STORE_NAME)}</span>
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

async function loadBusinessName() {
  try {
    const { data } = await sb.from('ts_settings').select('value').eq('key', 'business').maybeSingle();
    return data?.value?.name || null;
  } catch {
    return null;
  }
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
