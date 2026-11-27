/* support.js — atención al cliente: casos y base de conocimiento */
import { sb, money, esc, toast, errMessage, fmtDate, openDrawerUI, closeDrawerUI } from './core.js?v=828d81de';

export const CASE_STATUS = {
  nuevo: 'Nuevo',
  en_proceso: 'En proceso',
  esperando_cliente: 'Esperando cliente',
  escalado: 'Escalado',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
};
export const CHANNEL = { whatsapp: 'WhatsApp', telefono: 'Teléfono', correo: 'Correo', presencial: 'Presencial' };
export const CATEGORY = {
  cuenta: 'Cuenta',
  pago: 'Pago',
  pedido: 'Pedido',
  entrega: 'Entrega',
  devolucion: 'Devolución',
  garantia: 'Garantía',
  factura: 'Factura',
  otro: 'Otro',
};
export const PRIORITY = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export const RESOLUTION = {
  guia: 'Guía o instrucciones enviadas',
  reembolso: 'Reembolso aprobado',
  cambio: 'Cambio de producto',
  reenvio: 'Reenvío del pedido',
  correccion: 'Corrección de datos',
  escalado: 'Escalado al CEO',
  sin_respuesta: 'El cliente no respondió',
  duplicado: 'Caso duplicado',
};

const $ = (s) => document.querySelector(s);

function drawer({ title, subtitle = '', body = '', foot = '' }) {
  const d = $('#drawer');
  $('#dCode').textContent = title;
  $('#dMeta').innerHTML = subtitle;
  $('#dBody').innerHTML = body;
  $('#dFoot').innerHTML = foot;
  $('#dFoot').onclick = null;
  d.classList.remove('hidden');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  openDrawerUI();
  $('#dBody').scrollTop = 0;
}
function cerrar() {
  const d = $('#drawer');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  closeDrawerUI();
}

const ABIERTOS = ['nuevo', 'en_proceso', 'esperando_cliente', 'escalado'];
let cases = [];
let filtro = 'abiertos';
let api = null;

export function initSupport(a) {
  api = a;
  document.getElementById('btnNewCase')?.addEventListener('click', openNewCase);
  document.getElementById('supportChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cfilter]');
    if (!b) return;
    filtro = b.dataset.cfilter;
    renderCases();
  });
  document.getElementById('supportTable')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-case]');
    if (b) openCase(b.dataset.case);
  });
}

export async function loadCases() {
  const { data, error } = await sb.rpc('ts_case_list', { p_limit: 300 });
  if (error) return toast(errMessage(error), 'err');
  cases = data || [];
}

function slaDice(c) {
  if (!ABIERTOS.includes(c.status) || !c.due_resolve) return { txt: '—', cls: '' };
  const ms = new Date(c.due_resolve) - new Date();
  if (ms < 0) return { txt: 'vencido', cls: 'badge cancelado' };
  const h = Math.floor(ms / 3600000);
  if (h < 8) return { txt: `en ${h} h`, cls: 'badge pendiente' };
  return { txt: `en ${Math.floor(h / 24)} d`, cls: 'badge pagado' };
}

export function renderCases() {
  const lista =
    filtro === 'abiertos'
      ? cases.filter((c) => ABIERTOS.includes(c.status))
      : filtro === 'todos'
      ? cases
      : cases.filter((c) => c.status === filtro);

  const k = {
    nuevos: cases.filter((c) => c.status === 'nuevo').length,
    proceso: cases.filter((c) => c.status === 'en_proceso').length,
    espera: cases.filter((c) => c.status === 'esperando_cliente').length,
    vencidos: cases.filter((c) => ABIERTOS.includes(c.status) && c.due_resolve && new Date(c.due_resolve) < new Date()).length,
    cerrados: cases.filter((c) => c.status === 'cerrado').length,
  };

  const kpis = document.getElementById('supportKpis');
  if (kpis) {
    kpis.innerHTML = [
      ['NUEVOS', k.nuevos],
      ['EN PROCESO', k.proceso],
      ['ESPERANDO CLIENTE', k.espera],
      ['FUERA DE PLAZO', k.vencidos],
      ['CERRADOS', k.cerrados],
    ]
      .map(([l, v]) => `<div class="kpi"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span></div>`)
      .join('');
  }

  const chips = document.getElementById('supportChips');
  if (chips) {
    const opciones = [['abiertos', 'Abiertos'], ['nuevo', 'Nuevos'], ['en_proceso', 'En proceso'], ['esperando_cliente', 'Esperando cliente'], ['escalado', 'Escalados'], ['cerrado', 'Cerrados'], ['todos', 'Todos']];
    chips.innerHTML = opciones
      .map(
        ([v, l]) =>
          `<button class="chip ${filtro === v ? 'on' : ''}" data-cfilter="${v}">${l}${
            v === 'todos' ? ` · ${cases.length}` : ''
          }</button>`
      )
      .join('');
  }

  const tb = document.querySelector('#supportTable tbody');
  const vacio = document.getElementById('supportEmpty');
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = '';
    if (vacio) vacio.hidden = false;
    return;
  }
  if (vacio) vacio.hidden = true;
  tb.innerHTML = lista
    .map((c) => {
      const s = slaDice(c);
      return `<tr class="clickable" data-case="${c.id}">
      <td class="mono small">${esc(c.code)}</td>
      <td><b>${esc(c.subject)}</b>
        <div class="small muted">${esc(CATEGORY[c.category] || c.category)} · ${esc(CHANNEL[c.channel] || c.channel)}</div></td>
      <td class="small">${esc(c.contact_name)}<div class="muted">${esc(c.contact_phone || c.contact_email || '')}</div></td>
      <td><span class="badge ${c.priority === 'urgente' ? 'cancelado' : 'pagado'}">${esc(PRIORITY[c.priority] || c.priority)}</span></td>
      <td><span class="badge inc-${c.status === 'cerrado' ? 'resuelto' : 'reportado'}">${esc(CASE_STATUS[c.status] || c.status)}</span></td>
      <td class="small"><span class="${s.cls}">${s.txt}</span></td>
      <td class="small muted">${fmtDate(c.created_at)}</td>
    </tr>`;
    })
    .join('');
}

function openNewCase() {
  drawer({
    title: 'Nuevo caso de soporte',
    subtitle: 'Se genera un folio automático y un plazo de respuesta',
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="ncName">Nombre *</label><input id="ncName" placeholder="Cómo se llama"></div>
          <div class="field" style="flex:1"><label for="ncPhone">Teléfono / WhatsApp</label><input id="ncPhone" placeholder="7000-0000"></div>
        </div>
        <div class="field"><label for="ncEmail">Correo</label><input id="ncEmail" type="email" placeholder="opcional"></div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="ncChannel">Canal *</label>
            <select id="ncChannel">${Object.entries(CHANNEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label for="ncCategory">Categoría *</label>
            <select id="ncCategory">${Object.entries(CATEGORY).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        </div>
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="ncPriority">Prioridad</label>
            <select id="ncPriority">${Object.entries(PRIORITY).map(([v, l]) => `<option value="${v}" ${v === 'normal' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label for="ncOrder">N.º de pedido</label><input id="ncOrder" placeholder="TEC-001019"></div>
        </div>
        <div class="field"><label for="ncSubject">Asunto *</label><input id="ncSubject" placeholder="Resumen en una línea"></div>
        <div class="field"><label for="ncMessage">Lo que dijo el cliente *</label>
          <textarea id="ncMessage" rows="3" placeholder="Detalle del problema"></textarea></div>
      </div>`,
    foot: `<button class="btn primary" id="ncGo">Abrir caso</button>
           <button class="btn ghost" id="ncCancel">Cancelar</button>`,
  });
  document.getElementById('ncCancel').onclick = cerrar;
  document.getElementById('ncGo').onclick = async () => {
    const subject = (document.getElementById('ncSubject').value || '').trim();
    const name = (document.getElementById('ncName').value || '').trim();
    const phone = (document.getElementById('ncPhone').value || '').trim();
    const email = (document.getElementById('ncEmail').value || '').trim();
    if (!name) return toast('Falta el nombre', 'err');
    if (!subject) return toast('Falta el asunto', 'err');
    if (!phone && !email) return toast('Deja un teléfono o un correo', 'err');
    const btn = document.getElementById('ncGo');
    btn.disabled = true;
    const { error } = await sb.rpc('ts_case_open', {
      p: {
        contact_name: name,
        contact_phone: phone,
        contact_email: email,
        channel: document.getElementById('ncChannel').value,
        category: document.getElementById('ncCategory').value,
        priority: document.getElementById('ncPriority').value,
        subject,
        message: (document.getElementById('ncMessage').value || '').trim(),
        order_id: (document.getElementById('ncOrder').value || '').trim(),
      },
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    cerrar();
    toast('Caso abierto');
    await loadCases();
    renderCases();
  };
}

async function openCase(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) return;
  const { data: msgs } = await sb.from('ts_case_messages').select('*').eq('case_id', id).order('created_at');
  const abierto = ABIERTOS.includes(c.status);

  drawer({
    title: `${c.code} · ${c.subject}`,
    subtitle: `${CASE_STATUS[c.status]} · ${CATEGORY[c.category]} · ${CHANNEL[c.channel]}`,
    body: `
      <div class="panel" style="margin-bottom:.8rem">
        <div class="row" style="justify-content:space-between;gap:.6rem;flex-wrap:wrap">
          <div><b>${esc(c.contact_name)}</b><div class="small muted">${esc(c.contact_phone || '')} ${esc(c.contact_email || '')}</div></div>
          <div class="small muted">Abierto ${fmtDate(c.created_at)}</div>
        </div>
        ${c.due_resolve && abierto ? `<p class="small muted" style="margin:.5rem 0 0">Resolución comprometida: ${fmtDate(c.due_resolve)}</p>` : ''}
        ${c.resolution_code ? `<p class="small" style="margin:.5rem 0 0"><b>Cierre:</b> ${esc(RESOLUTION[c.resolution_code] || c.resolution_code)} — ${esc(c.resolution_notes || '')}</p>` : ''}
      </div>

      <div class="panel" style="margin-bottom:.8rem">
        <h3 style="margin-top:0">Conversación</h3>
        ${(msgs || [])
          .map(
            (m) => `<div class="csg-msg ${m.direction}">
            <div class="small muted">${m.direction === 'agente' ? 'Nosotros' : esc(m.author_name || 'Cliente')} · ${fmtDate(m.created_at)}</div>
            <div>${esc(m.body)}</div>
          </div>`
          )
          .join('') || '<p class="small muted">Sin mensajes.</p>'}
      </div>

      ${abierto
        ? `<div class="panel">
            <h3 style="margin-top:0">Responder</h3>
            <textarea id="csReply" rows="3" placeholder="Escribe la respuesta al cliente"></textarea>
            <div class="row" style="gap:.4rem;margin-top:.6rem;flex-wrap:wrap">
              <button class="btn primary sm" id="csSend">Enviar respuesta</button>
              <button class="btn sm ghost" id="csWait">Esperando cliente</button>
              <button class="btn sm ghost" id="csEsc">Escalar al CEO</button>
            </div>
            <h3 style="margin-top:1rem">Cerrar el caso</h3>
            <div class="field"><label for="csCode">Tipo de solución *</label>
              <select id="csCode"><option value="">— Elige —</option>${Object.entries(RESOLUTION)
                .map(([v, l]) => `<option value="${v}">${l}</option>`)
                .join('')}</select></div>
            <div class="field"><label for="csNotes">Qué se hizo *</label>
              <textarea id="csNotes" rows="2" placeholder="Mínimo 10 caracteres"></textarea></div>
            <button class="btn sm" id="csClose" style="background:#1f7a4d;color:#fff">Cerrar con resolución</button>
          </div>`
        : `<p class="small muted">Este caso está cerrado y no admite más respuestas.</p>`}
    `,
    foot: `<button class="btn ghost" id="csBack">Cerrar ventana</button>`,
  });

  document.getElementById('csBack').onclick = cerrar;
  if (!abierto) return;

  const reload = async () => {
    await loadCases();
    renderCases();
    cerrar();
  };

  document.getElementById('csSend').onclick = async () => {
    const body = (document.getElementById('csReply').value || '').trim();
    if (!body) return toast('Escribe la respuesta', 'err');
    const { error } = await sb.rpc('ts_case_reply', { p_case_id: id, p_body: body, p_direction: 'agente' });
    if (error) return toast(errMessage(error), 'err');
    toast('Respuesta registrada');
    await reload();
  };
  document.getElementById('csWait').onclick = async () => {
    const { error } = await sb.rpc('ts_case_set_status', { p_case_id: id, p_status: 'esperando_cliente', p_note: 'A la espera de respuesta' });
    if (error) return toast(errMessage(error), 'err');
    toast('Marcado como esperando cliente');
    await reload();
  };
  document.getElementById('csEsc').onclick = async () => {
    const { error } = await sb.rpc('ts_case_set_status', { p_case_id: id, p_status: 'escalado', p_note: 'Requiere decisión del CEO' });
    if (error) return toast(errMessage(error), 'err');
    toast('Escalado al CEO');
    await reload();
  };
  document.getElementById('csClose').onclick = async () => {
    const code = document.getElementById('csCode').value;
    const notes = (document.getElementById('csNotes').value || '').trim();
    if (!code) return toast('Elige el tipo de solución', 'err');
    if (notes.length < 10) return toast('Escribe qué se hizo (mínimo 10 caracteres)', 'err');
    const { error } = await sb.rpc('ts_case_close', { p_case_id: id, p_code: code, p_notes: notes });
    if (error) return toast(errMessage(error), 'err');
    toast('Caso cerrado');
    await reload();
  };
}
