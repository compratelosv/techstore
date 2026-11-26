/* account.js — registro, ingreso, perfil y pedidos del cliente */
import { sb, money, esc, toast, mountHeader, getUser, getProfile, errMessage, fmtDate, STATUS_LABEL } from './core.js?v=3b15e8e6';

const authView = document.getElementById('authView');
const accountView = document.getElementById('accountView');
const authForm = document.getElementById('authForm');
const nameField = document.getElementById('nameField');
const authTitle = document.getElementById('authTitle');
const authSubmit = document.getElementById('authSubmit');
const switchMode = document.getElementById('switchMode');
const switchText = document.getElementById('switchText');

let mode = 'login';

function setMode(next) {
  mode = next;
  const isSignup = mode === 'signup';
  authTitle.textContent = isSignup ? 'Crear cuenta' : 'Ingresar';
  authSubmit.textContent = isSignup ? 'Crear cuenta' : 'Ingresar';
  nameField.hidden = !isSignup;
  switchText.textContent = isSignup ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  switchMode.textContent = isSignup ? 'Ingresar' : 'Crear cuenta';
}

switchMode.addEventListener('click', (e) => {
  e.preventDefault();
  setMode(mode === 'login' ? 'signup' : 'login');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('aEmail').value.trim();
  const password = document.getElementById('aPass').value;
  const fullName = document.getElementById('aName').value.trim();
  authSubmit.disabled = true;

  try {
    if (mode === 'signup') {
      // el enlace del correo debe volver al home de la tienda, no a localhost
      const homeUrl = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${homeUrl}index.html?confirmado=1`,
        },
      });
      if (error) throw error;
      if (!data.session) {
        toast('Cuenta creada. Revisa tu correo para confirmarla.');
        setMode('login');
        return;
      }
      toast('Cuenta creada. ¡Bienvenido!');
      const { data: cupones } = await sb.rpc('ts_my_coupons');
      const c = (cupones || [])[0];
      if (c) toast(`Tenés un cupón de bienvenida: ${c.code} (${c.discount_value}% en tu primera compra)`);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast('Sesión iniciada');
    }
    await render();
  } catch (err) {
    const m = errMessage(err);
    toast(/Invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : m, 'err');
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = await getUser();
  if (!user) return;
  const { error } = await sb
    .from('ts_profiles')
    .update({
      full_name: document.getElementById('pName').value.trim(),
      phone: document.getElementById('pPhone').value.trim(),
    })
    .eq('id', user.id);
  if (error) return toast(errMessage(error), 'err');
  toast('Datos guardados');
});

async function renderOrders(user) {
  const list = document.getElementById('ordersList');
  const empty = document.getElementById('ordersEmpty');
  const { data, error } = await sb
    .from('ts_orders')
    .select('*, ts_order_items(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    list.innerHTML = `<p class="small" style="color:var(--bad)">${esc(errMessage(error))}</p>`;
    return;
  }
  empty.hidden = (data || []).length > 0;

  list.innerHTML = (data || [])
    .map((o) => {
      const itemsCount = (o.ts_order_items || []).reduce((n, i) => n + i.qty, 0);
      const payLink = o.status === 'pendiente_pago'
        ? `<a class="btn primary small" href="pago.html?order=${o.id}">Pagar</a>`
        : '';
      return `
      <div class="order-card">
        <div class="order-head">
          <div>
            <span class="order-code">${esc(o.code)}</span>
            <div class="small muted">${fmtDate(o.created_at)} · ${itemsCount} artículo(s) · ${o.fulfillment === 'retiro' ? 'Retiro' : 'Envío'}</div>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center">
            <span class="badge ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
            ${payLink}
          </div>
        </div>
        <div class="small" style="margin-top:.6rem">
          ${(o.ts_order_items || [])
            .map((i) => `${esc(i.name)} ×${i.qty}`)
            .join(' · ')}
        </div>
        <div class="summary-row total" style="border-top:1px solid var(--line);margin-top:.6rem;padding-top:.5rem">
          <span>Total</span><span>${money(o.total)}</span>
        </div>
      </div>`;
    })
    .join('');
}

async function render() {
  await mountHeader({ active: 'account' });
  const user = await getUser();
  if (!user) {
    authView.hidden = false;
    accountView.hidden = true;
    setMode('login');
    return;
  }
  authView.hidden = true;
  accountView.hidden = false;

  const profile = await getProfile();
  document.getElementById('whoami').textContent = user.email;
  document.getElementById('pName').value = profile?.full_name || user.user_metadata?.full_name || '';
  document.getElementById('pPhone').value = profile?.phone || '';

  const st = document.getElementById('phoneStatus');
  if (profile?.phone_verified) {
    st.textContent = '✓ Número verificado';
    st.style.color = 'var(--ok, #4ec9a5)';
  } else {
    st.textContent = 'Sin verificar — no podrás comprar hasta confirmarlo';
    st.style.color = 'var(--bad, #f06b6b)';
  }
  if (profile?.phone) document.getElementById('vPhone').value = profile.phone;

  await renderCoupons();
  await renderOrders(user);
}

async function renderCoupons() {
  const { data } = await sb.rpc('ts_my_coupons');
  const list = data || [];
  let host = document.getElementById('myCoupons');
  if (!host) {
    host = document.createElement('div');
    host.id = 'myCoupons';
    document.getElementById('profileForm').after(host);
  }
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="panel" style="max-width:460px;margin-top:1rem;border-color:var(--accent,#6ea8fe)">
    <b style="font-size:.9rem">Tus cupones</b>
    ${list.map((c) => `<div class="row" style="justify-content:space-between;padding:.35rem 0">
      <div><div class="mono">${esc(c.code)}</div>
        <div class="small muted">${c.discount_type === 'percent' ? c.discount_value + '%' : money(c.discount_value)} · usos ${c.uses}/${c.max_uses}${c.ends_at ? ' · vence ' + fmtDate(c.ends_at) : ''}</div></div>
    </div>`).join('')}
  </div>`;
}

/* ---------- verificación de WhatsApp ---------- */
document.getElementById('vSend').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const phone = document.getElementById('vPhone').value.trim();
  if (!phone) return toast('Escribe tu número', 'err');
  btn.disabled = true;
  const { data, error } = await sb.rpc('ts_request_phone_code', { p_phone: phone });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  document.getElementById('vCodeBox').hidden = false;
  const mode = document.getElementById('vMode');
  mode.textContent = data.mode === 'demo'
    ? `Modo prueba: tu código es ${data.demo_code}`
    : 'Te lo enviamos por WhatsApp';
  mode.style.color = data.mode === 'demo' ? 'var(--warn,#e3b341)' : 'var(--muted)';
  if (data.mode === 'demo') document.getElementById('vCode').value = data.demo_code;
  toast('Código generado');
});

/* ---------- después de verificar el teléfono: pagar o seguir mirando ---------- */
function itemsEnCarrito() {
  const n = Number(localStorage.getItem('ts.cart.count') || 0);
  if (n > 0) return n;
  try {
    return JSON.parse(localStorage.getItem('ts.cart') || '[]').reduce((s, i) => s + (i.qty || 1), 0);
  } catch {
    return 0;
  }
}

function showPostVerifyDialog(n, cupon) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:9999';
  wrap.innerHTML = `
    <div class="panel" style="max-width:440px;width:100%;text-align:left">
      <h3 style="margin:.1rem 0 .35rem">¡Gracias por registrarte!</h3>
      <p class="small muted" style="margin:0 0 .8rem">
        Nos alegra tenerte en TechStore. Por ser parte de la casa te damos un
        <b>10% de descuento de bienvenida</b> para cualquier compra.
      </p>
      ${cupon ? `<div style="border:1px dashed var(--accent,#ff3300);border-radius:10px;padding:.7rem .8rem;margin-bottom:.8rem">
        <div class="small muted">Tu cupón</div>
        <div class="mono" style="font-size:1.15rem;font-weight:700;letter-spacing:.06em">${esc(cupon.code)}</div>
        <div class="small muted" style="margin-top:.25rem">${cupon.discount_type === 'percent' ? cupon.discount_value + '% de descuento' : money(cupon.discount_value)}${cupon.ends_at ? ' · válido hasta ' + fmtDate(cupon.ends_at) : ''}</div>
      </div>` : ''}
      ${n > 0 ? `<p class="small" style="margin:0 0 .8rem">Tenés <b>${n} ${n === 1 ? 'artículo' : 'artículos'}</b> en tu carrito: podés usarlo ahora mismo.</p>` : ''}
      <p class="small muted" style="font-size:.68rem;line-height:1.35;margin:0 0 .9rem">
        Términos: un cupón por compra, no acumulable con otras promociones (no se suman descuentos),
        tope máximo del 20% por compra. Aplicable solo a productos de la tienda.
      </p>
      <div class="row" style="gap:.5rem;flex-wrap:wrap">
        ${n > 0 ? '<a class="btn" href="carrito.html" style="flex:1;min-width:140px;text-align:center">Ir a pagar</a>' : ''}
        <a class="btn ${n > 0 ? 'ghost' : ''}" href="index.html" style="flex:1;min-width:140px;text-align:center">
          ${n > 0 ? 'Seguir viendo' : 'Ver productos'}
        </a>
      </div>
    </div>`;
  document.body.appendChild(wrap);
}

document.getElementById('vConfirm').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const code = document.getElementById('vCode').value.trim();
  if (!code) return toast('Escribe el código', 'err');
  btn.disabled = true;
  const { error } = await sb.rpc('ts_confirm_phone_code', { p_code: code });
  btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');
  toast('¡WhatsApp verificado! Ya podés comprar.');
  await render();

  // si había algo en el carrito se le ofrece pagar; si no, directo al catálogo
  const n = itemsEnCarrito();
  let cupon = null;
  try {
    const { data } = await sb.rpc('ts_my_coupons');
    cupon = (data || [])[0] || null;
  } catch {
    cupon = null;
  }
  if (n > 0 || cupon) showPostVerifyDialog(n, cupon);
  else location.href = 'index.html';
});

render().catch((err) => toast(errMessage(err), 'err'));
