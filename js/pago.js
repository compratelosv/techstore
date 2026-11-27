/* pago.js — cobro simulado del pedido.
 * Sustituible por Wompi: el pedido se confirma con la misma RPC
 * ts_confirm_payment, que es la única que descuenta stock.
 */
import { sb, money, esc, toast, mountHeader, requireLogin, errMessage, STATUS_LABEL } from './core.js?v=828d81de';
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

async function renderPay() {
  const { data: transfer } = await sb.from('ts_payment_info').select('*').eq('id', 1).maybeSingle();
  const t = transfer || {};
  const hayTransf = !!(t.activo && t.cuenta);

  view.innerHTML = `
    <h1 style="margin-bottom:.3rem">Completar pago</h1>
    <p class="muted" style="margin-top:0">Pedido creado. Elegí cómo querés pagar.</p>
    ${summaryMarkup()}
    <div class="panel" style="margin-top:1rem">
      <h3>¿Cómo querés pagar?</h3>
      <div class="row wrap" style="gap:.4rem;margin:.7rem 0">
        <button class="btn sm ghost" data-method="tarjeta">💳 Tarjeta</button>
        <button class="btn sm ghost" data-method="efectivo">💵 Efectivo al recibir</button>
        <button class="btn sm ghost" data-method="transferencia" ${hayTransf ? '' : 'disabled title="Aún no hay datos de transferencia cargados"'}>🏦 Transferencia</button>
      </div>
      <div id="payPanel"></div>
    </div>`;

  const panel = document.getElementById('payPanel');
  const btns = Array.from(view.querySelectorAll('[data-method]'));
  const sel = (m) => btns.forEach((b) => b.classList.toggle('primary', b.dataset.method === m));

  const pintarTarjeta = () => {
    sel('tarjeta');
    panel.innerHTML = `
      <p class="small muted">${MODO_PAGO === 'simulado'
        ? 'Entorno de <b>pago simulado</b>: no se cobra dinero real ni se piden datos de tarjeta.'
        : 'Te llevamos a la pasarela segura de Wompi para pagar con tarjeta.'}</p>
      <button class="btn primary block" id="payBtn">Pagar ${money(order.total)}</button>`;
    document.getElementById('payBtn').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Confirmando…';
      const r = await cobrarPedido(sb, order);
      if (r.tipo === 'error') { toast(r.mensaje, 'err'); btn.disabled = false; btn.textContent = `Pagar ${money(order.total)}`; return; }
      if (r.tipo === 'redirigir') { location.href = r.url; return; }
      order = r.order; renderSuccess();
    };
  };

  const pintarEfectivo = () => {
    sel('efectivo');
    panel.innerHTML = `
      <p class="small muted">Pagás <b>en el momento de la entrega</b>. Tu pedido entra a preparación ahora y el
      repartidor o el punto de retiro cobra al entregarte.</p>
      <button class="btn primary block" id="cashBtn">Confirmar pedido · pago al recibir</button>`;
    document.getElementById('cashBtn').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Confirmando…';
      const { error } = await sb.rpc('ts_confirm_payment', {
        p_order_id: order.id, p_provider: 'efectivo', p_reference: `CONTRA-ENTREGA-${order.code}`,
      });
      if (error) { toast(errMessage(error), 'err'); btn.disabled = false; btn.textContent = 'Confirmar pedido · pago al recibir'; return; }
      toast('Pedido confirmado · se cobra al entregar');
      renderSuccess();
    };
  };

  const pintarTransferencia = () => {
    sel('transferencia');
    panel.innerHTML = `
      <p class="small muted">Hacé la transferencia y <b>tu pedido queda reservado</b>. Confirmamos el pago
      cuando lo vemos en la cuenta y ahí entra a preparación.</p>
      <div class="panel" style="margin:.6rem 0;background:var(--bg-2,#f6f8fb)">
        <p class="small" style="line-height:2;margin:0">
          Banco: <b>${esc(t.banco || '—')}</b><br>
          Titular: <b>${esc(t.titular || '—')}</b><br>
          ${t.tipo_cuenta ? `Tipo: <b>${esc(t.tipo_cuenta)}</b><br>` : ''}
          Cuenta: <b class="mono">${esc(t.cuenta || '—')}</b><br>
          Monto exacto: <b>${money(order.total)}</b>
        </p>
      </div>
      ${t.qr_url ? `<img src="${esc(t.qr_url)}" alt="QR para transferir" style="max-width:180px;display:block;margin:.4rem auto">` : ''}
      ${t.instrucciones ? `<p class="small muted">${esc(t.instrucciones)}</p>` : ''}
      <p class="small"><b>Importante:</b> poné el código <b class="mono">${esc(order.code)}</b> en el concepto
      de la transferencia para poder identificarla.</p>
      <a class="btn ghost block" href="cuenta.html">Ya transferí · ver mi pedido</a>`;
  };

  btns.forEach((b) => {
    b.onclick = () => {
      if (b.dataset.method === 'tarjeta') return pintarTarjeta();
      if (b.dataset.method === 'efectivo') return pintarEfectivo();
      if (b.dataset.method === 'transferencia') return pintarTransferencia();
    };
  });

  pintarTarjeta();
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
