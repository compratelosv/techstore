/* checkout.js — crea el pedido (estado pendiente_pago) */
import { sb, money, esc, toast, mountHeader, getProfile, requireLogin, errMessage } from './core.js?v=5214a642';
import { getCart, cartTotal, clearCart } from './cart.js?v=213c08d9';

const items = getCart();
const zonesEl = document.getElementById('cZone');
const totalsEl = document.getElementById('totals');
const linesEl = document.getElementById('orderLines');
const shipFields = document.getElementById('shippingFields');
const form = document.getElementById('checkoutForm');
const submitBtn = document.getElementById('submitBtn');

let zones = [];
let submitting = false;

function fulfillment() {
  return form.querySelector('input[name="fulfillment"]:checked').value;
}

function shippingCost() {
  if (fulfillment() === 'retiro') return 0;
  const z = zones.find((x) => x.id === zonesEl.value);
  if (!z) return 0;
  const sub = cartTotal();
  if (z.free_over !== null && sub >= Number(z.free_over)) return 0;
  return Number(z.cost);
}

function renderTotals() {
  const sub = cartTotal();
  const ship = shippingCost();
  totalsEl.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${money(sub)}</span></div>
    <div class="summary-row">
      <span>Envío</span>
      <span>${fulfillment() === 'retiro' ? 'Retiro en tienda' : ship === 0 ? 'Gratis' : money(ship)}</span>
    </div>
    <div class="summary-row total"><span>Total</span><span>${money(sub + ship)}</span></div>`;
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

async function boot() {
  await mountHeader({ active: 'cart' });
  const user = await requireLogin('checkout.html');
  if (!user) return;

  if (!items.length) {
    location.replace('carrito.html');
    return;
  }

  const [profile, zoneRes] = await Promise.all([
    getProfile(),
    sb.from('ts_shipping_zones').select('*').eq('active', true).order('cost'),
  ]);

  zones = zoneRes.data || [];
  zonesEl.innerHTML = zones
    .map((z) => `<option value="${z.id}">${esc(z.name)} — ${money(z.cost)}${z.free_over ? ` (gratis desde ${money(z.free_over)})` : ''}</option>`)
    .join('');

  document.getElementById('cEmail').value = user.email || '';
  document.getElementById('cName').value = profile?.full_name || user.user_metadata?.full_name || '';
  document.getElementById('cPhone').value = profile?.phone || '';

  renderLines();
  renderTotals();
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'fulfillment') {
    shipFields.hidden = e.target.value === 'retiro';
    shipFields.querySelectorAll('input,select,textarea').forEach((el) => {
      el.required = e.target.value === 'envio' && el.id !== 'cNotes' && el.id !== 'cDept';
    });
  }
  renderTotals();
});

zonesEl.addEventListener('change', renderTotals);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;
  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creando pedido…';

  const isEnvio = fulfillment() === 'envio';
  const payload = {
    p_items: items.map((i) => ({ product_id: i.id, qty: i.qty })),
    p_fulfillment: isEnvio ? 'envio' : 'retiro',
    p_customer: {
      name: document.getElementById('cName').value.trim(),
      email: document.getElementById('cEmail').value.trim(),
      phone: document.getElementById('cPhone').value.trim(),
    },
    p_shipping: isEnvio
      ? {
          zone_id: zonesEl.value,
          line1: document.getElementById('cAddress').value.trim(),
          city: document.getElementById('cCity').value.trim(),
          department: document.getElementById('cDept').value.trim(),
          notes: document.getElementById('cNotes').value.trim(),
        }
      : {},
    p_channel: 'online',
  };

  if (!payload.p_customer.name || !payload.p_customer.phone) {
    toast('Falta tu nombre o teléfono', 'err');
    submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';
    return;
  }

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
