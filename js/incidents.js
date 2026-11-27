/* incidents.js — contingencias por daño antes de la entrega */
import { sb, money, esc, toast, errMessage, fmtDate, getUser, openDrawerUI, closeDrawerUI } from './core.js?v=828d81de';

export const SEV = {
  leve: 'Leve (solo estético)',
  moderado: 'Moderado',
  grave: 'Grave pero 100% funcional',
  no_funcional: 'No funcional (no sirve)',
};

export const INC_STATUS = {
  reportado: 'Reportado',
  autorizado: 'Autorizado',
  notificado: 'Aviso enviado',
  decidido: 'Cliente decidió',
  resuelto: 'Resuelto',
  anulado: 'Anulado',
};

const ACTION_LABEL = {
  aceptar_averia: 'Acepta el producto con descuento',
  sustituir: 'Pide sustitución por uno nuevo',
  cancelar_item: 'Cancela ese producto',
  cancelar_todo: 'Cancela todo el pedido',
};

export const INC = { list: [], loaded: false, me: null, isAdmin: false };

const $ = (s) => document.querySelector(s);

/* ---------------- carga ---------------- */
export async function loadIncidents(force = false) {
  if (INC.loaded && !force) return INC;
  const [rows, user] = await Promise.all([
    sb.from('ts_incidents').select('*').order('created_at', { ascending: false }),
    getUser(),
  ]);
  INC.list = rows.data || [];
  INC.me = user?.id || null;
  INC.loaded = true;
  return INC;
}

/* ---------------- drawer ---------------- */
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
function closeDrawer() {
  const d = $('#drawer');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  closeDrawerUI();
}

/* ---------------- lista ---------------- */
export function renderIncidents() {
  const abiertas = INC.list.filter((i) => ['reportado', 'autorizado'].includes(i.status));
  const esperando = INC.list.filter((i) => i.status === 'notificado');
  const deciden = INC.list.filter((i) => i.status === 'decidido');
  const resueltas = INC.list.filter((i) => i.status === 'resuelto');
  const descuentos = resueltas.reduce((n, i) => n + Number(i.discount_amount || 0), 0);
  const reembolsos = resueltas.reduce((n, i) => n + Number(i.refund_amount || 0), 0);

  $('#incKpis').innerHTML = `
    <div class="kpi"><span>Por autorizar</span><b>${abiertas.length}</b></div>
    <div class="kpi"><span>Esperando cliente</span><b>${esperando.length}</b></div>
    <div class="kpi"><span>Por resolver</span><b>${deciden.length}</b></div>
    <div class="kpi"><span>Descuentos otorgados</span><b>${money(descuentos)}</b></div>
    <div class="kpi"><span>Reembolsado</span><b>${money(reembolsos)}</b></div>`;

  const vacio = document.getElementById('incEmpty');
  if (vacio) vacio.hidden = INC.list.length > 0;

  $('#incTable').querySelector('tbody').innerHTML = INC.list.map((i) => `
    <tr data-inc="${i.id}" style="cursor:pointer">
      <td data-label="Folio"><b class="mono">${esc(i.code)}</b></td>
      <td data-label="Producto">${esc(i.product_name || '—')}<div class="small muted mono">${esc(i.sku || '')}</div></td>
      <td data-label="Gravedad"><span class="badge inc-${i.severity}">${esc(SEV[i.severity] || i.severity)}</span></td>
      <td data-label="Descuento" class="num">${Number(i.discount_pct)}%${i.discount_amount > 0 ? `<div class="small muted">${money(i.discount_amount)}</div>` : ''}</td>
      <td data-label="Estado"><span class="badge incs-${i.status}">${esc(INC_STATUS[i.status] || i.status)}</span></td>
      <td data-label="Fecha" class="small muted">${fmtDate(i.created_at)}</td>
      <td><button class="btn sm ghost" data-open-inc="${i.id}">Ver</button></td>
    </tr>`).join('');
}

/* ---------------- reportar daño ---------------- */
export async function openDamageForm(itemId, meta = {}) {
  let sev = 'leve';

  drawer({
    title: 'Reportar daño',
    subtitle: `${esc(meta.sku || '')} · ${esc(meta.name || '')}`,
    body: `
      <div class="panel">
        <p class="small muted" style="margin-top:0">
          El producto se dañó antes de la entrega. Elige la gravedad; el descuento lo autoriza el CEO.
        </p>
        <div class="field">
          <label for="incSev">Gravedad del daño</label>
          <select id="incSev">
            <option value="leve">Leve (solo estético) — 5%</option>
            <option value="moderado">Moderado — 10%</option>
            <option value="grave">Grave pero 100% funcional — 20%</option>
            <option value="no_funcional">No funcional (no sirve) — no se ofrece</option>
          </select>
        </div>
        <div class="field">
          <label for="incDesc">¿Qué le pasó? *</label>
          <textarea id="incDesc" rows="3" placeholder="Ej: la caja viene abollada en la esquina, el equipo funciona bien"></textarea>
        </div>
        <div class="field">
          <label for="incFile">Foto del daño *</label>
          <input type="file" id="incFile" accept="image/jpeg,image/png,image/webp,application/pdf">
          <span class="small muted">Sin foto no se puede autorizar.</span>
        </div>
        <p class="small muted" id="incHint" style="margin-bottom:0"></p>
      </div>`,
    foot: `<button class="btn primary" id="incSave">Reportar</button>
           <button class="btn ghost" id="incCancel">Cancelar</button>`,
  });

  const sel = document.getElementById('incSev');
  const hint = document.getElementById('incHint');
  const syncHint = () => {
    const map = {
      leve: 'Se podrá ofrecer 5% de descuento o sustitución o cancelación.',
      moderado: 'Se podrá ofrecer 10% de descuento o sustitución o cancelación.',
      grave: 'Se podrá ofrecer 20% de descuento (autoriza el CEO) o sustitución o cancelación.',
      no_funcional: 'No se ofrecerá descuento: solo sustitución o devolución del dinero.',
    };
    hint.textContent = map[sel.value] || '';
  };
  sel.onchange = syncHint;
  syncHint();

  document.getElementById('incCancel').onclick = () => closeDrawer();
  document.getElementById('incSave').onclick = async (e) => {
    const btn = e.currentTarget;
    const desc = document.getElementById('incDesc').value.trim();
    const file = document.getElementById('incFile').files[0];
    if (!desc) return toast('Describe el daño', 'err');
    if (!file) return toast('Sube la foto del daño', 'err');

    btn.disabled = true;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `incidentes/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const up = await sb.storage.from('ts-documentos').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { btn.disabled = false; return toast(errMessage(up.error), 'err'); }

    const { data, error } = await sb.rpc('ts_incident_create', {
      p_item: itemId, p_severity: sel.value, p_description: desc, p_photo_path: path,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');

    toast(`Contingencia ${data.code} reportada`);
    await loadIncidents(true);
    closeDrawer();
    openIncident(data.id);
  };
}

/* ---------------- detalle ---------------- */
export async function openIncident(id) {
  const inc = INC.list.find((x) => x.id === id) || (await sb.from('ts_incidents').select('*').eq('id', id).single()).data;
  if (!inc) return;

  const [docs, events, ord, offers] = await Promise.all([
    sb.from('ts_incident_docs').select('*').eq('incident_id', id).order('created_at'),
    sb.from('ts_incident_events').select('*').eq('incident_id', id).order('created_at', { ascending: false }),
    sb.from('ts_orders').select('code, total, status, customer_name, customer_phone, user_id').eq('id', inc.order_id).maybeSingle(),
    sb.from('ts_incident_offers').select('token, options, answered_at').eq('incident_id', id).order('created_at', { ascending: false }).limit(1),
  ]);

  const fotos = docs.data || [];
  const ev = events.data || [];
  const order = ord.data || {};
  const offer = (offers.data || [])[0] || null;
  const clientUrl = offer ? `${location.origin}${location.pathname.replace(/admin\.html$/, '')}contingencia.html?t=${offer.token}` : null;

  const botones = [];
  const esAdmin = INC.isAdmin;
  if (inc.status === 'reportado' && esAdmin) botones.push('<button class="btn primary" data-act="authorize">Autorizar</button>');
  if (inc.status === 'autorizado' && esAdmin) botones.push('<button class="btn primary" data-act="offer">Enviar aviso al cliente</button>');
  if (inc.status === 'decidido' && esAdmin) botones.push('<button class="btn primary" data-act="resolve">Aplicar decisión</button>');
  if (!['resuelto', 'anulado'].includes(inc.status) && esAdmin) botones.push('<button class="btn ghost" data-act="void">Anular</button>');
  botones.push('<button class="btn ghost" data-act="close">Cerrar</button>');

  drawer({
    title: inc.code,
    subtitle: `<span class="badge incs-${inc.status}">${esc(INC_STATUS[inc.status])}</span>
      <span class="small muted" style="margin-left:.5rem">Pedido ${esc(order.code || '')}</span>`,
    body: `
      <div class="panel">
        <div class="inc-grid">
          <div><span>Producto</span><b>${esc(inc.product_name || '—')}</b></div>
          <div><span>SKU</span><b class="mono">${esc(inc.sku || '—')}</b></div>
          <div><span>Gravedad</span><b>${esc(SEV[inc.severity])}</b></div>
          <div><span>Funcional</span><b>${inc.functional ? 'Sí' : 'No'}</b></div>
          <div><span>Valor</span><b>${money(inc.unit_price)} × ${inc.qty}</b></div>
          <div><span>Descuento</span><b>${Number(inc.discount_pct)}% · ${money(inc.discount_amount)}</b></div>
        </div>
        <p class="small" style="margin:.7rem 0 0"><b>Daño:</b> ${esc(inc.description)}</p>
        ${inc.expires_at ? `<p class="small muted" style="margin:.3rem 0 0">Responde antes de ${fmtDate(inc.expires_at)}</p>` : ''}
        ${inc.customer_action ? `<p class="small" style="margin:.3rem 0 0"><b>El cliente eligió:</b> ${esc(ACTION_LABEL[inc.customer_action] || inc.customer_action)}</p>` : ''}
        ${inc.coupon_code ? `<p class="small" style="margin:.3rem 0 0">Cupón emitido: <b class="mono">${esc(inc.coupon_code)}</b></p>` : ''}
        ${Number(inc.refund_amount) > 0 ? `<p class="small" style="margin:.3rem 0 0">Reembolso: <b>${money(inc.refund_amount)}</b></p>` : ''}
      </div>

      <div class="panel">
        <h3 style="margin-top:0">Pruebas del daño</h3>
        <div id="incDocs">${fotos.length ? fotos.map((d) => `
          <div class="rq-doc"><span>${esc(d.kind)}</span><b>${esc(d.file_name || d.file_path.split('/').pop())}</b>
          <button class="btn sm ghost" data-doc="${d.id}">Abrir</button></div>`).join('') : '<p class="small muted">Sin archivos.</p>'}</div>
      </div>

      ${clientUrl ? `<div class="panel">
        <h3 style="margin-top:0">Enlace para el cliente</h3>
        <p class="small muted" style="margin-top:0">Mándaselo por WhatsApp. Desde ahí elige una opción y queda registrado.</p>
        <div class="row" style="gap:.4rem">
          <input id="incLink" readonly value="${esc(clientUrl)}" style="flex:1;min-width:0;font-size:.74rem">
          <button class="btn sm" data-copy="${esc(clientUrl)}">Copiar</button>
          <a class="btn sm ghost" href="${esc(clientUrl)}" target="_blank" rel="noopener">Abrir</a>
        </div>
        ${offer?.answered_at ? '<p class="small" style="margin:.5rem 0 0">El cliente ya respondió.</p>' : ''}
      </div>` : ''}

      <div class="panel">
        <h3 style="margin-top:0">Historial</h3>
        ${ev.length ? ev.map((e) => `<div class="evline"><b>${esc(INC_STATUS[e.to_status] || e.to_status)}</b>
          <div>${esc(e.note || '')} · ${fmtDate(e.created_at)}</div></div>`).join('') : '<p class="small muted">Sin eventos.</p>'}
      </div>`,
    foot: botones.join(' '),
  });

  // abrir documento con enlace firmado
  $('#incDocs').onclick = async (e) => {
    const b = e.target.closest('[data-doc]');
    if (!b) return;
    const doc = fotos.find((d) => d.id === b.dataset.doc);
    if (!doc) return;
    const { data, error } = await sb.storage.from('ts-documentos').createSignedUrl(doc.file_path, 300);
    if (error) return toast(errMessage(error), 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // copiar el enlace del cliente
  const copyBtn = document.querySelector('[data-copy]');
  if (copyBtn) copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(copyBtn.dataset.copy); toast('Enlace copiado'); }
    catch { document.getElementById('incLink')?.select(); toast('Copia el enlace seleccionado', 'err'); }
  };

  $('#dFoot').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') return closeDrawer();

    if (act === 'authorize') {
      const { error } = await sb.rpc('ts_incident_authorize', { p_id: inc.id });
      if (error) return toast(errMessage(error), 'err');
      toast('Contingencia autorizada');
    }
    if (act === 'offer') {
      b.disabled = true;
      const { data, error } = await sb.rpc('ts_incident_offer', { p_id: inc.id });
      b.disabled = false;
      if (error) return toast(errMessage(error), 'err');
      const url = `${location.origin}${location.pathname.replace(/admin\.html$/, '')}contingencia.html?t=${data.token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast('Enlace del cliente copiado al portapapeles');
      await loadIncidents(true);
      renderIncidents();
      return openIncident(inc.id);
    }
    if (act === 'resolve') {
      if (!confirm('Se aplicará la decisión del cliente: cupón, sustitución o reembolso. ¿Continuar?')) return;
      b.disabled = true;
      const { error } = await sb.rpc('ts_incident_resolve', { p_id: inc.id });
      b.disabled = false;
      if (error) return toast(errMessage(error), 'err');
      toast('Contingencia resuelta');
    }
    if (act === 'void') {
      const motivo = prompt('Motivo de la anulación:');
      if (!motivo) return;
      const { error } = await sb.rpc('ts_incident_anular', { p_id: inc.id, p_reason: motivo });
      if (error) return toast(errMessage(error), 'err');
      toast('Contingencia anulada');
    }

    await loadIncidents(true);
    renderIncidents();
    openIncident(inc.id);
  };
}

/* ---------------- eventos de la vista ---------------- */
export function initIncidents(isAdmin) {
  INC.isAdmin = !!isAdmin;
  const table = document.getElementById('incTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const row = e.target.closest('[data-inc]');
      if (!row) return;
      openIncident(row.dataset.inc);
    });
  }
}
