/* pago.js — cobro simulado del pedido.
 * Sustituible por Wompi: el pedido se confirma con la misma RPC
 * ts_confirm_payment, que es la única que descuenta stock.
 */
import { sb, money, esc, toast, mountHeader, requireLogin, errMessage, STATUS_LABEL } from './core.js?v=3b15e8e6';
import { cobrarPedido, MODO_PAGO } from './pagos-provider.js?v=bd1b1326';

const view = document.getElementById('pagoView');
const orderId = new URLSearchParams(location.search).get('order');
let order = null;
let items = [];

async function loadOrder() {
  const { data, error } = await sb
    .from('ts_orders')
    .select('*, ts_order_items(*)')
    .eq('id', orderId)
    .maybeSingle();
  if (error || !data) throw new Error(error ? errMessage(error) : 'Pedido no encontrado');
  order = data;
  items = data.ts_order_items || [];
}

function summaryMarkup() {
  return `
    <div class="panel">
      <div class="order-head">
        <div>
          <div class="order-code">${esc(order.code)}</div>
          <div class="small muted">${new Date(order.created_at).toLocaleString('es-SV')}</div>
        </div>
        <span class="badge ${order.status}">${STATUS_LABEL[order.status] || order.status}</span>
      </div>
      <div style="margin:1rem 0;border-top:1px solid var(--line);padding-top:.8rem">
        ${items
          .map(
            (i) => `<div class="summary-row">
              <span>${esc(i.name)} <span class="muted small">×${i.qty}</span></span>
              <span>${money(i.line_total)}</span>
            </div>`
          )
          .join('')}
        <div class="summary-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
        <div class="summary-row">
          <span>Envío</span>
          <span>${order.fulfillment === 'retiro' ? 'Retiro en tienda' : money(order.shipping_cost)}</span>
        </div>
        <div class="summary-row total"><span>Total a pagar</span><span>${money(order.total)}</span></div>
      </div>
      <p class="small muted">
        ${order.fulfillment === 'envio'
          ? `Entrega en ${esc(order.ship_city || '')} · ${esc(order.ship_line1 || '')}`
          : 'Retiro en tienda'}
      </p>
    </div>`;
}

function renderPay() {
  view.innerHTML = `
    <h1 style="margin-bottom:.3rem">Completar pago</h1>
    <p class="muted" style="margin-top:0">Pedido creado. Falta confirmar el pago para que entre a preparación.</p>
    ${summaryMarkup()}
    <div class="panel" style="margin-top:1rem">
      <h3>Pago con tarjeta</h3>
      <p class="small muted">
        ${MODO_PAGO === 'simulado'
          ? 'Este entorno usa <b>pago simulado</b>: no se cobra dinero real y no se piden datos de tarjeta. La confirmación siempre pasa por la misma función del servidor.'
          : 'Te llevaremos a la pasarela de pago segura para completar la compra.'}
      </p>
      <button class="btn primary block" id="payBtn">Pagar ${money(order.total)}${MODO_PAGO === 'simulado' ? ' (simulado)' : ''}</button>
      <a class="btn ghost block" href="cuenta.html" style="margin-top:.5rem">Pagar más tarde</a>
    </div>`;

  document.getElementById('payBtn').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Confirmando…';
    const r = await cobrarPedido(sb, order);
    if (r.tipo === 'error') {
      toast(r.mensaje, 'err');
      btn.disabled = false;
      btn.textContent = `Pagar ${money(order.total)}`;
      return;
    }
    if (r.tipo === 'redirigir') { location.href = r.url; return; }
    order = r.order;
    renderSuccess();
  };
}

function renderSuccess() {
  view.innerHTML = `
    <div class="panel center" style="padding:2rem">
      <div style="font-size:2.6rem">✅</div>
      <h1 style="margin:.4rem 0">Pago confirmado</h1>
      <p class="muted">Tu pedido <b class="order-code">${esc(order.code)}</b> ya está en preparación.</p>
      <p class="small muted">Te avisaremos cuando esté listo para ${order.fulfillment === 'envio' ? 'enviarse' : 'retirarlo'}.</p>
      <a class="btn primary" href="cuenta.html" style="margin-top:1rem">Ver mis pedidos</a>
      <a class="btn ghost" href="index.html">Seguir comprando</a>
    </div>`;
}

async function boot() {
  await mountHeader({ active: 'cart' });
  const user = await requireLogin('cuenta.html');
  if (!user) return;
  if (!orderId) {
    view.innerHTML = '<div class="empty">Falta el pedido.</div>';
    return;
  }
  await loadOrder();
  if (order.status === 'pendiente_pago') renderPay();
  else renderSuccess();
}

boot().catch((err) => {
  view.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
});
