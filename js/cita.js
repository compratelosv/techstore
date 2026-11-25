/* cita.js — confirmar o reagendar la entrega desde el enlace de WhatsApp */
import { sb, esc, toast, mountHeader, errMessage, fmtDate, STATUS_LABEL } from './core.js?v=64144037';

const token = new URLSearchParams(location.search).get('t');
let order = null;
let slots = [];

const $ = (s) => document.querySelector(s);

function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const txt = dt.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function renderSlots() {
  const day = $('#rDate').value;
  const list = slots.filter((s) => s.date === day);
  $('#rSlot').innerHTML = list.map((s) => `<option value="${s.id}">${s.start} – ${s.end}</option>`).join('');
}

async function loadSlots() {
  const { data, error } = await sb.rpc('ts_slots_available', { p_point: null, p_days: 28 });
  if (error) return toast(errMessage(error), 'err');
  slots = (data || []).filter((s) => s.left > 0);
  if (!slots.length) return toast('No hay franjas libres', 'err');
  const dates = [...new Set(slots.map((s) => s.date))];
  $('#rDate').innerHTML = dates.map((d) => `<option value="${d}">${formatDay(d)}</option>`).join('');
  renderSlots();
}

function paint() {
  $('#citaCode').textContent = order.code;
  $('#citaWho').textContent = order.customer_name || '';
  $('#citaBadge').textContent = STATUS_LABEL[order.status] || order.status;
  $('#citaPoint').textContent = order.point_name || '—';
  $('#citaWhen').textContent = order.date
    ? `${formatDay(String(order.date))} · ${order.start}`
    : 'Sin cita asignada';

  const conf = $('#citaConfirmed');
  if (order.confirmed) {
    conf.innerHTML = '<span style="color:var(--ok,#4ec9a5)">✓ Confirmaste que llegarás</span>';
  } else {
    conf.innerHTML = '<span class="muted">Aún no has confirmado</span>';
  }

  const cerrada = ['entregado', 'cancelado', 'reembolsado'].includes(order.status);
  $('#citaActions').hidden = cerrada || order.confirmed;
  $('#citaReschedule').hidden = true;
}

async function boot() {
  await mountHeader({});
  if (!token) {
    $('#citaLoading').innerHTML = '<p class="small" style="color:var(--bad)">Falta el enlace de la cita.</p>';
    return;
  }
  const { data, error } = await sb.rpc('ts_order_by_token', { p_token: token });
  if (error) {
    $('#citaLoading').innerHTML = `<p class="small" style="color:var(--bad)">${esc(errMessage(error))}</p>`;
    return;
  }
  order = data;
  $('#citaLoading').hidden = true;
  $('#citaView').hidden = false;
  paint();
  await loadSlots();

  $('#citaYes').onclick = async () => {
    const { error: err } = await sb.rpc('ts_order_confirm_pickup', {
      p_order_id: order.id, p_token: token, p_yes: true,
    });
    if (err) return toast(errMessage(err), 'err');
    order.confirmed = true;
    toast('¡Listo! Te esperamos.');
    paint();
  };

  $('#citaNo').onclick = () => {
    $('#citaReschedule').hidden = false;
    if (order.reschedules >= 1) {
      toast('Ya reagendaste una vez. Si no llegas, el pedido se cancela.', 'err');
    }
    $('#citaReschedule').scrollIntoView({ behavior: 'smooth' });
  };

  $('#rDate').onchange = renderSlots;

  $('#rSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const slotId = $('#rSlot').value;
    const { data: ord, error: err } = await sb.rpc('ts_book_slot', {
      p_order_id: order.id, p_slot_id: slotId, p_point_id: null, p_token: token,
    });
    btn.disabled = false;
    if (err) return toast(errMessage(err), 'err');
    order.date = null;
    toast('Cita reagendada. Te esperamos.');
    const { data: fresh } = await sb.rpc('ts_order_by_token', { p_token: token });
    order = fresh || order;
    paint();
    await loadSlots();
  };
}

boot().catch((err) => toast(errMessage(err), 'err'));
