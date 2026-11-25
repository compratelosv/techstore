/* checkout.js — crea el pedido (pendiente_pago) con cupón, cita y aceptación de términos */
import { sb, money, esc, toast, mountHeader, getProfile, requireLogin, errMessage } from './core.js?v=ff7704d8';
import { getCart, cartTotal, clearCart } from './cart.js?v=213c08d9';

const items = getCart();
const zonesEl = document.getElementById('cZone');
const totalsEl = document.getElementById('totals');
const linesEl = document.getElementById('orderLines');
const shipFields = document.getElementById('shippingFields');
const pickupFields = document.getElementById('pickupFields');
const pointEl = document.getElementById('cPoint');
const dateEl = document.getElementById('cDate');
const slotEl = document.getElementById('cSlot');
const form = document.getElementById('checkoutForm');
const submitBtn = document.getElementById('submitBtn');
const promoInput = document.getElementById('cPromo');
const promoState = document.getElementById('promoState');

let zones = [];
let slots = [];
let promo = null; // { code, discount, message }
let submitting = false;

function fulfillment() {
  return form.querySelector('input[name="fulfillment"]:checked').value;
}

const isPickup = () => fulfillment() === 'punto';

function shippingCost() {
  if (isPickup()) return 0;
  const z = zones.find((x) => x.id === zonesEl.value);
  if (!z) return 0;
  const sub = cartTotal();
  if (z.free_over !== null && sub >= Number(z.free_over)) return 0;
  return Number(z.cost);
}

function renderTotals() {
  const sub = cartTotal();
  const ship = shippingCost();
  const disc = promo ? Number(promo.discount) : 0;
  totalsEl.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${money(sub)}</span></div>
    ${disc > 0 ? `<div class="summary-row"><span>Descuento ${esc(promo.code)}</span><span style="color:var(--ok,#4ec9a5)">−${money(disc)}</span></div>` : ''}
    <div class="summary-row">
      <span>Entrega</span>
      <span>${isPickup() ? 'Punto de entrega · gratis' : ship === 0 ? 'Gratis' : money(ship)}</span>
    </div>
    <div class="summary-row total"><span>Total</span><span>${money(Math.max(sub - disc, 0) + ship)}</span></div>`;
}

function renderLines() {
  linesEl.innerHTML = items
    .map(
      (i) => `<div class="summary-row">
        <span>${esc(i.name)} <span class="muted small">×${i.qty}</span></span>
        <span>${money(i.price * i.qty)}</span>
      </div>`
    )
    .join('');
}

/* ---------- franjas de entrega ---------- */
function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const txt = dt.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function renderSlotsForDate() {
  const day = dateEl.value;
  const list = slots.filter((s) => s.date === day);
  slotEl.innerHTML = list
    .map((s) => `<option value="${s.id}">${s.start} – ${s.end} · ${s.left} lugar(es)</option>`)
    .join('');
  if (list.length) slotEl.value = list[0].id;
}

function renderDates() {
  const dates = [...new Set(slots.map((s) => s.date))];
  dateEl.innerHTML = dates.map((d) => `<option value="${d}">${formatDay(d)}</option>`).join('');
  renderSlotsForDate();
}

async function loadSlots(pointId) {
  const { data, error } = await sb.rpc('ts_slots_available', { p_point: pointId || null, p_days: 28 });
  if (error) return toast(errMessage(error), 'err');
  slots = (data || []).filter((s) => s.left > 0);
  if (!slots.length) {
    dateEl.innerHTML = '<option value="">Sin franjas libres</option>';
    slotEl.innerHTML = '<option value="">—</option>';
    return toast('No hay franjas libres en las próximas 4 semanas', 'err');
  }
  renderDates();
}

async function boot() {
  await mountHeader({ active: 'cart' });
  const user = await requireLogin('checkout.html');
  if (!user) return;

  if (!items.length) {
    location.replace('carrito.html');
    return;
  }

  const [profile, zoneRes, pointsRes] = await Promise.all([
    getProfile(),
    sb.from('ts_shipping_zones').select('*').eq('active', true).order('cost'),
    sb.from('ts_pickup_points').select('*').eq('active', true).order('sort'),
  ]);

  zones = zoneRes.data || [];
  zonesEl.innerHTML = zones
    .map((z) => `<option value="${z.id}">${esc(z.name)} — ${money(z.cost)}${z.free_over ? ` (gratis desde ${money(z.free_over)})` : ''}</option>`)
    .join('');

  const points = pointsRes.data || [];
  pointEl.innerHTML = points.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (points.length) await loadSlots(points[0].id);

  document.getElementById('cEmail').value = user.email || '';
  document.getElementById('cName').value = profile?.full_name || user.user_metadata?.full_name || '';

  const phoneEl = document.getElementById('cPhone');
  const stateEl = document.getElementById('phoneState');
  phoneEl.value = profile?.phone || '';
  if (profile?.phone_verified) {
    stateEl.textContent = '✓ Verificado';
    stateEl.style.color = 'var(--ok, #4ec9a5)';
  } else {
    stateEl.innerHTML = '<span style="color:var(--bad,#f06b6b)">Sin verificar</span> · <a href="cuenta.html#whatsapp">verifica tu WhatsApp</a>';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifica tu WhatsApp para comprar';
  }

  renderLines();
  renderTotals();
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'fulfillment') {
    const pickup = isPickup();
    pickupFields.hidden = !pickup;
    shipFields.hidden = pickup;
    document.getElementById('cAddress').required = !pickup;
    document.getElementById('cCity').required = !pickup;
    zonesEl.required = !pickup;
  }
  renderTotals();
});

pointEl.addEventListener('change', () => loadSlots(pointEl.value));
dateEl.addEventListener('change', () => { renderSlotsForDate(); renderTotals(); });
slotEl.addEventListener('change', renderTotals);
zonesEl.addEventListener('change', renderTotals);

promoInput.addEventListener('input', () => {
  if (promo) {
    promo = null;
    promoState.textContent = '';
    renderTotals();
  }
});

document.getElementById('promoApply').addEventListener('click', async () => {
  const code = promoInput.value.trim();
  if (!code) return toast('Escribe un código', 'err');
  const { data, error } = await sb.rpc('ts_promo_check', {
    p_code: code,
    p_items: items.map((i) => ({ product_id: i.id, qty: i.qty, total: i.price * i.qty })),
  });
  if (error) return toast(errMessage(error), 'err');
  if (!data?.ok) {
    promo = null;
    promoState.textContent = data?.message || 'Cupón inválido';
    promoState.style.color = 'var(--bad,#f06b6b)';
    renderTotals();
    return;
  }
  promo = { code: data.code, discount: data.discount, message: data.message };
  promoState.textContent = `✓ ${data.code} · ${data.message} (−${money(data.discount)})`;
  promoState.style.color = 'var(--ok,#4ec9a5)';
  renderTotals();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;

  if (!document.getElementById('cTerms').checked) {
    return toast('Debes aceptar los términos y la política de privacidad', 'err');
  }
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  if (!name || !phone) return toast('Falta tu nombre o WhatsApp', 'err');

  const pickup = isPickup();
  if (pickup && !slotEl.value) return toast('Elige día y hora de entrega', 'err');

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creando pedido…';

  const payload = {
    p_items: items.map((i) => ({ product_id: i.id, qty: i.qty })),
    p_fulfillment: pickup ? 'retiro' : 'envio',
    p_customer: {
      name,
      email: document.getElementById('cEmail').value.trim(),
      phone,
      terms: true,
    },
    p_shipping: pickup
      ? {}
      : {
          zone_id: zonesEl.value,
          line1: document.getElementById('cAddress').value.trim(),
          city: document.getElementById('cCity').value.trim(),
          department: document.getElementById('cDept').value.trim(),
          notes: document.getElementById('cNotes').value.trim(),
        },
    p_channel: 'online',
    p_promo: promo ? promo.code : null,
    p_slot: pickup ? slotEl.value : null,
    p_point: pickup ? pointEl.value : null,
  };

  const { data, error } = await sb.rpc('ts_place_order', payload);

  if (error) {
    toast(errMessage(error), 'err');
    submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';
    return;
  }

  clearCart();
  location.href = `pago.html?order=${data.id}`;
});

boot().catch((err) => toast(errMessage(err), 'err'));
