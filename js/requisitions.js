/* requisitions.js — requisiciones de compra y servicios con aprobación del CEO */
import { sb, money, esc, toast, errMessage, getUser, openDrawerUI, closeDrawerUI } from './core.js?v=828d81de';

export const RQ_STATUS = {
  borrador: 'Borrador',
  solicitada: 'Por aprobar',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  orden_emitida: 'Orden emitida',
  recibida: 'Recibida',
  facturada: 'Facturada',
  pagada: 'Pagada',
  cerrada: 'Cerrada',
  anulada: 'Anulada',
};

const DOC_KINDS = [
  ['cotizacion', 'Cotización'], ['factura', 'Factura'], ['remision', 'Nota de remisión'],
  ['entrega', 'Nota de entrega'], ['comprobante', 'Comprobante de pago'], ['otro', 'Otro'],
];

const PAY_METHODS = [
  ['efectivo', 'Efectivo (sale de caja)'], ['transferencia', 'Transferencia bancaria'],
  ['tarjeta', 'Tarjeta'], ['cheque', 'Cheque'], ['otro', 'Otro'],
];

export const RQ = {
  list: [], departments: [], suppliers: [], products: [], taxes: null, biz: {},
  filters: { status: 'all', dept: 'all', q: '' },
  loaded: false,
  draft: null,
};

/* Solicitudes de cotización (correo al proveedor) */
export const RFQ_STATUS = {
  programada: 'Preparada',
  enviada: 'Enviada',
  fallida: 'Falló el envío',
  respondida: 'Respondida',
  anulada: 'Anulada',
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- carga ---------------- */
export async function loadRequisitions(force = false) {
  if (RQ.loaded && !force) return RQ;
  const [reqs, depts, sups, prods, tax, biz, user] = await Promise.all([
    sb.from('ts_requisitions').select('*').order('created_at', { ascending: false }),
    sb.from('ts_departments').select('*').eq('active', true).order('name'),
    sb.from('ts_suppliers').select('id,name,email,active').order('name'),
    sb.from('ts_products').select('id,sku,name,price').eq('active', true).order('name'),
    sb.from('ts_settings').select('value').eq('key', 'taxes').maybeSingle(),
    sb.from('ts_settings').select('value').eq('key', 'business').maybeSingle(),
    getUser(),
  ]);
  RQ.list = reqs.data || [];
  RQ.departments = depts.data || [];
  RQ.suppliers = sups.data || [];
  RQ.products = prods.data || [];
  RQ.taxes = tax.data?.value || { iva: 13, retention_services: 10, apply_retention: true };
  RQ.biz = biz.data?.value || {};
  RQ.me = user?.id || null;
  RQ.loaded = true;

  const sel = document.getElementById('rqDept');
  if (sel && sel.options.length <= 1) {
    RQ.departments.forEach((d) => {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.name;
      sel.appendChild(o);
    });
  }
  return RQ;
}

const deptName = (id) => RQ.departments.find((d) => d.id === id)?.name || '—';
const supName = (id) => RQ.suppliers.find((s) => s.id === id)?.name || '—';

/* ---------------- listado ---------------- */
export function renderRequisitions(isAdmin) {
  const pend = RQ.list.filter((r) => ['solicitada', 'borrador'].includes(r.status));
  const curso = RQ.list.filter((r) => ['aprobada', 'orden_emitida', 'recibida'].includes(r.status));
  const porPagar = RQ.list.filter((r) => r.status === 'facturada');
  const mes = new Date().getMonth();
  const pagadoMes = RQ.list
    .filter((r) => r.paid_at && new Date(r.paid_at).getMonth() === mes)
    .reduce((n, r) => n + Number(r.total || 0), 0);

  $('#rqKpis').innerHTML = `
    <div class="kpi"><span>Por aprobar</span><b>${pend.filter((r) => r.status === 'solicitada').length}</b></div>
    <div class="kpi"><span>En curso</span><b>${curso.length}</b></div>
    <div class="kpi"><span>Facturas por pagar</span><b>${porPagar.length}</b></div>
    <div class="kpi"><span>Pagado este mes</span><b>${money(pagadoMes)}</b></div>`;

  const q = RQ.filters.q.toLowerCase();
  const rows = RQ.list.filter((r) => {
    if (RQ.filters.status !== 'all' && r.status !== RQ.filters.status) return false;
    if (RQ.filters.dept !== 'all' && r.department_id !== RQ.filters.dept) return false;
    if (!q) return true;
    return (r.code || '').toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q)
      || (r.oc_code || '').toLowerCase().includes(q) || supName(r.supplier_id).toLowerCase().includes(q);
  });

  $('#rqCount').textContent = `${rows.length} de ${RQ.list.length}`;
  $('#rqEmpty').hidden = rows.length > 0;
  $('#rqTable').querySelector('tbody').innerHTML = rows.map((r) => `
    <tr data-req="${r.id}" style="cursor:pointer">
      <td data-label="Folio"><b class="mono">${esc(r.code)}</b>${r.oc_code ? `<div class="small muted mono">${esc(r.oc_code)}</div>` : ''}</td>
      <td data-label="Título">${esc(r.title)}<div class="small muted">${r.kind === 'servicio' ? 'Servicio' : 'Producto'} · ${esc(r.invoice_number || '')}</div></td>
      <td data-label="Departamento">${esc(deptName(r.department_id))}</td>
      <td data-label="Proveedor">${esc(supName(r.supplier_id))}</td>
      <td data-label="Total" class="num">${money(r.total)}</td>
      <td data-label="Estado"><span class="badge rq-${r.status}">${RQ_STATUS[r.status] || r.status}</span></td>
      <td><button class="btn sm ghost" data-open-req="${r.id}">Ver</button></td>
    </tr>`).join('');
}

/* ---------------- drawer base ---------------- */
function openRqDrawer({ title, subtitle = '', body = '', foot = '' }) {
  const drawer = $('#drawer');
  $('#dCode').textContent = title;
  $('#dMeta').innerHTML = subtitle;
  $('#dBody').innerHTML = body;
  $('#dFoot').innerHTML = foot;
  $('#dFoot').onclick = null; // sin acciones heredadas de la pantalla anterior
  drawer.classList.remove('hidden');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  openDrawerUI();
  $('#dBody').scrollTop = 0;
}
function closeRqDrawer() {
  const drawer = $('#drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  closeDrawerUI();
}

/* ---------------- editor (crear / editar) ---------------- */
export function openReqEditor(id = null) {
  const r = id ? RQ.list.find((x) => x.id === id) : null;
  const editable = !r || ['borrador', 'solicitada'].includes(r.status);
  const esAdmin = !!RQ.isAdmin;

  const deptOpts = RQ.departments.map((d) =>
    `<option value="${d.id}" ${r?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const supOpts = RQ.suppliers.filter((s) => s.active !== false || s.id === r?.supplier_id)
    .map((s) => `<option value="${s.id}" ${r?.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const prodOpts = RQ.products.map((p) =>
    `<option value="${p.id}">${esc(p.sku)} · ${esc(p.name)}</option>`).join('');

  openRqDrawer({
    title: r ? r.code : 'Nueva requisición',
    subtitle: r ? `${RQ_STATUS[r.status]} · ${deptName(r.department_id)}` : 'Solicitud de compra o de servicio',
    body: `
      <div class="panel">
        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="rqKind">Tipo</label>
            <select id="rqKind" ${editable ? '' : 'disabled'}>
              <option value="producto" ${r?.kind !== 'servicio' ? 'selected' : ''}>Compra de productos</option>
              <option value="servicio" ${r?.kind === 'servicio' ? 'selected' : ''}>Contratación de servicio</option>
            </select></div>
          <div class="field" style="flex:1"><label for="rqDeptSel">Departamento que solicita</label>
            <select id="rqDeptSel" ${editable ? '' : 'disabled'}><option value="">—</option>${deptOpts}</select></div>
        </div>

        <div class="field"><label for="rqTitle">Título / concepto *</label>
          <input id="rqTitle" value="${esc(r?.title || '')}" ${editable ? '' : 'disabled'}
                 placeholder="10 discos duros 2TB · o · Mantenimiento de computadoras"></div>

        <div class="field"><label for="rqSupplier">Proveedor</label>
          <select id="rqSupplier" ${editable ? '' : 'disabled'}><option value="">— por definir —</option>${supOpts}</select>
          <span class="small muted">¿No está en la lista? Créalo en Proveedores.</span></div>

        <div class="field"><label for="rqJust">Justificación</label>
          <textarea id="rqJust" rows="2" ${editable ? '' : 'disabled'}
            placeholder="Por qué se necesita y qué pasa si no se compra">${esc(r?.justification || '')}</textarea></div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">Partidas</h3>
          ${editable ? '<button class="btn sm" type="button" id="rqAddItem">+ Agregar</button>' : ''}
        </div>
        <div id="rqItems" style="margin-top:.6rem"></div>
        <div class="rq-totals" id="rqTotals"></div>
        ${editable ? '' : '<p class="small muted">Requieren autorización para editar su contenido.</p>'}
      </div>

      <div class="panel" id="rqQuotesPanel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">Cotizaciones</h3>
          ${editable ? '<button class="btn sm" type="button" id="rqAddQuote">+ Agregar</button>' : ''}
        </div>
        <p class="small muted" style="margin:.3rem 0 .6rem">Opcional, pero recomendable: con dos o tres puedes comparar.</p>
        <div id="rqQuotes"></div>
      </div>

      <div class="panel">
        <div class="field"><label for="rqNotes">Notas internas</label>
          <textarea id="rqNotes" rows="2" ${editable ? '' : 'disabled'}>${esc(r?.notes || '')}</textarea></div>
      </div>

      <input type="file" id="rqFileInput" multiple hidden
             accept="application/pdf,image/jpeg,image/png,image/webp">`,
    foot: r
      ? `<button class="btn primary" id="rqSave">Guardar cambios</button><button class="btn ghost" id="rqClose">Cerrar</button>`
      : `<button class="btn primary" id="rqSaveDraft">Guardar borrador</button>
         <button class="btn" id="rqSaveSubmit">Enviar a aprobación</button>
         <button class="btn ghost" id="rqClose">Cancelar</button>`,
  });

  // partidas en memoria
  let items = r ? [] : [{ description: '', qty: 1, unit_price: 0, product_id: null }];
  let quotes = [];

  const prodSelect = (sel) => `<select class="rq-item-prod" style="width:100%">
      <option value="">— texto libre —</option>${prodOpts}</select>`;
  const prodSelectWithVal = (sel2) => prodSelect(sel2);

  function renderItems() {
    const box = document.getElementById('rqItems');
    if (!box) return;
    if (!editable) {
      box.innerHTML = `<table class="table"><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
        <tbody>${(r?.items || []).map((i) => `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td>
          <td class="num">${money(i.unit_price)}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</tbody></table>`;
      return;
    }
    box.innerHTML = items.map((it, idx) => `
      <div class="rq-item" data-idx="${idx}">
        <div class="row" style="gap:.4rem;align-items:flex-end">
          <div class="field" style="flex:2"><label>Descripción</label>
            <input class="rq-item-desc" value="${esc(it.description)}" placeholder="Disco duro 2TB"></div>
          <div class="field" style="flex:0 0 84px"><label>Cant.</label>
            <input class="rq-item-qty" type="number" min="0.01" step="1" value="${it.qty}"></div>
          <div class="field" style="flex:0 0 110px"><label>Precio</label>
            <input class="rq-item-price" type="number" min="0" step="0.01" value="${it.unit_price}"></div>
          <button class="btn sm ghost" type="button" data-del-item="${idx}" title="Quitar">✕</button>
        </div>
        <div class="row" style="gap:.4rem;align-items:center;margin-bottom:.6rem">
          <span class="small muted">Producto del inventario (opcional):</span>
          ${prodSelectWithVal()}
        </div>
      </div>`).join('');
    box.querySelectorAll('.rq-item').forEach((row) => {
      const idx = Number(row.dataset.idx);
      row.querySelector('.rq-item-desc').addEventListener('input', (e) => { items[idx].description = e.target.value; });
      row.querySelector('.rq-item-qty').addEventListener('input', (e) => {
        items[idx].qty = Number(e.target.value) || 0; renderTotals();
      });
      row.querySelector('.rq-item-price').addEventListener('input', (e) => {
        items[idx].unit_price = Number(e.target.value) || 0; renderTotals();
      });
      const sel = row.querySelector('.rq-item-prod');
      if (sel) {
        sel.value = items[idx].product_id || '';
        sel.addEventListener('change', (e) => {
          const p = RQ.products.find((x) => x.id === e.target.value);
          items[idx].product_id = p?.id || null;
          if (p) {
            if (!items[idx].description) items[idx].description = p.name;
            if (!items[idx].unit_price) items[idx].unit_price = Number(p.price);
            renderItems();
            renderTotals();
          }
        });
      }
    });
    renderTotals();
  }

  function totals() {
    const sub = items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
    const iva = Number(RQ.taxes?.iva ?? 13);
    const retPct = Number(RQ.taxes?.retention_services ?? 10);
    const kind = document.getElementById('rqKind')?.value || 'producto';
    const tax = Math.round(sub * iva) / 100;
    const ret = (kind === 'servicio' && RQ.taxes?.apply_retention) ? Math.round(sub * retPct) / 100 : 0;
    return { sub, tax, ret, total: sub + tax - ret, iva, retPct };
  }

  function renderTotals() {
    const t = totals();
    const box = document.getElementById('rqTotals');
    if (!box) return;
    box.innerHTML = `
      <div><span>Subtotal</span><b>${money(t.sub)}</b></div>
      <div><span>IVA ${t.iva}%</span><b>${money(t.tax)}</b></div>
      ${t.ret ? `<div><span>Retención ${t.retPct}%</span><b>− ${money(t.ret)}</b></div>` : ''}
      <div class="rq-grand"><span>Total a pagar</span><b>${money(t.total)}</b></div>`;
  }

  function renderQuotes() {
    const box = document.getElementById('rqQuotes');
    if (!box) return;
    if (!editable) {
      const qs = r?.quotes || [];
      box.innerHTML = qs.length
        ? `<table class="table"><tbody>${qs.map((qq) => `<tr>
            <td>${esc(qq.supplier_name || supName(qq.supplier_id))}${qq.chosen ? ' ✓' : ''}</td>
            <td class="num">${money(qq.amount)}</td><td class="small muted">${qq.lead_days || '—'} días</td>
          </tr>`).join('')}</tbody></table>`
        : '<p class="small muted">Sin cotizaciones registradas.</p>';
      return;
    }
    box.innerHTML = quotes.map((qq, idx) => `
      <div class="row" style="gap:.4rem;align-items:flex-end;margin-bottom:.4rem">
        <div class="field" style="flex:2"><label>Proveedor</label>
          <input class="rq-q-sup" value="${esc(qq.supplier_name || '')}" placeholder="Intcomex"></div>
        <div class="field" style="flex:0 0 110px"><label>Monto</label>
          <input class="rq-q-amt" type="number" min="0" step="0.01" value="${qq.amount || 0}"></div>
        <div class="field" style="flex:0 0 90px"><label>Días</label>
          <input class="rq-q-lead" type="number" min="0" value="${qq.lead_days || ''}"></div>
        <button class="btn sm ghost" type="button" data-del-quote="${idx}">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-del-quote]').forEach((b) => {
      b.onclick = () => { quotes.splice(Number(b.dataset.delQuote), 1); renderQuotes(); };
    });
    box.querySelectorAll('.rq-q-sup').forEach((el, i) => { el.oninput = (e) => { quotes[i].supplier_name = e.target.value; }; });
    box.querySelectorAll('.rq-q-amt').forEach((el, i) => { el.oninput = (e) => { quotes[i].amount = Number(e.target.value) || 0; }; });
    box.querySelectorAll('.rq-q-lead').forEach((el, i) => { el.oninput = (e) => { quotes[i].lead_days = Number(e.target.value) || null; }; });
  }

  if (editable) {
    const addItem = document.getElementById('rqAddItem');
    if (addItem) addItem.onclick = () => { items.push({ description: '', qty: 1, unit_price: 0, product_id: null }); renderItems(); };
    const addQ = document.getElementById('rqAddQuote');
    if (addQ) addQ.onclick = () => { quotes.push({ supplier_name: '', amount: 0, lead_days: null }); renderQuotes(); };
    document.getElementById('rqItems').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del-item]');
      if (!d) return;
      items.splice(Number(d.dataset.delItem), 1);
      if (!items.length) items.push({ description: '', qty: 1, unit_price: 0, product_id: null });
      renderItems();
    });
    const kindSel = document.getElementById('rqKind');
    if (kindSel) kindSel.addEventListener('change', renderTotals);
  }

  renderItems();
  renderQuotes();
  document.getElementById('rqClose').onclick = closeRqDrawer;

  // si es una requisición existente, cargar partidas y cotizaciones
  if (r) {
    Promise.all([
      sb.from('ts_requisition_items').select('*').eq('requisition_id', r.id),
      sb.from('ts_requisition_quotes').select('*').eq('requisition_id', r.id),
    ]).then(([its, qs]) => {
      r.items = its.data || [];
      r.quotes = qs.data || [];
      if (editable) {
        items = r.items.map((i) => ({ description: i.description, qty: Number(i.qty), unit_price: Number(i.unit_price), product_id: i.product_id }));
        if (!items.length) items = [{ description: '', qty: 1, unit_price: 0, product_id: null }];
        quotes = r.quotes.map((q) => ({ supplier_name: q.supplier_name, amount: Number(q.amount), lead_days: q.lead_days }));
        renderItems();
        renderQuotes();
      } else {
        renderItems();
        renderQuotes();
      }
    });
  }

  const save = async (submit) => {
    const kind = document.getElementById('rqKind').value;
    const title = document.getElementById('rqTitle').value.trim();
    if (!title) return toast('Escribe el título de la requisición', 'err');
    const clean = items.filter((i) => i.description && Number(i.qty) > 0);
    if (!clean.length) return toast('Agrega al menos una partida con descripción y cantidad', 'err');

    const { data, error } = await sb.rpc('ts_req_save', {
      p_id: r?.id || null,
      p_kind: kind,
      p_title: title,
      p_department: document.getElementById('rqDeptSel').value || null,
      p_supplier: document.getElementById('rqSupplier').value || null,
      p_items: clean.map((i) => ({
        description: i.description, product_id: i.product_id, qty: Number(i.qty), unit_price: Number(i.unit_price) || 0,
      })),
      p_justification: document.getElementById('rqJust').value.trim() || null,
      p_notes: document.getElementById('rqNotes').value.trim() || null,
      p_submit: submit,
    });
    if (error) return toast(errMessage(error), 'err');

    // cotizaciones (solo las que tienen proveedor y monto)
    const qs = quotes.filter((q) => q.supplier_name && Number(q.amount) > 0);
    if (qs.length) {
      await sb.from('ts_requisition_quotes').delete().eq('requisition_id', data.id);
      await sb.from('ts_requisition_quotes').insert(qs.map((q) => ({
        requisition_id: data.id, supplier_name: q.supplier_name, amount: Number(q.amount), lead_days: q.lead_days,
      })));
    }

    toast(submit ? 'Requisición enviada a aprobación' : 'Requisición guardada');
    await loadRequisitions(true);
    renderRequisitions(RQ.isAdmin);
    closeRqDrawer();
    if (submit || r) openRequisition(data.id);
  };

  if (r) {
    document.getElementById('rqSave').onclick = (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      save(r.status === 'solicitada').finally(() => { btn.disabled = false; });
    };
  } else {
    document.getElementById('rqSaveDraft').onclick = () => save(false);
    document.getElementById('rqSaveSubmit').onclick = () => save(true);
  }
}

/* ---------------- detalle y flujo ---------------- */
export async function openRequisition(id) {
  const r = RQ.list.find((x) => x.id === id);
  if (!r) return;
  RQ.openId = id;
  const esAdmin = !!RQ.isAdmin;

  const [its, quotes, docs, events, rfqs] = await Promise.all([
    sb.from('ts_requisition_items').select('*').eq('requisition_id', id),
    sb.from('ts_requisition_quotes').select('*').eq('requisition_id', id),
    sb.from('ts_requisition_docs').select('*').eq('requisition_id', id).order('created_at'),
    sb.from('ts_requisition_events').select('*').eq('requisition_id', id).order('created_at', { ascending: false }),
    sb.from('ts_quote_requests').select('*').eq('requisition_id', id).order('created_at', { ascending: false }),
  ]);

  const items = its.data || [];
  const qs = quotes.data || [];
  const ds = docs.data || [];
  const ev = events.data || [];
  const rqs = rfqs.data || [];

  const acciones = [];
  if (r.status === 'borrador' && (esAdmin || r.requested_by === RQ.me)) {
    acciones.push('<button class="btn primary" data-rq-act="submit">Enviar a aprobación</button>');
  }
  if (['borrador', 'solicitada'].includes(r.status) && esAdmin) {
    acciones.push('<button class="btn primary" data-rq-act="approve">Aprobar requisición</button>');
  }
  if (r.status === 'aprobada' && esAdmin) {
    acciones.push('<button class="btn primary" data-rq-act="oc">Emitir orden de compra</button>');
  }
  if (['orden_emitida', 'aprobada'].includes(r.status)) {
    acciones.push('<button class="btn primary" data-rq-act="receive">Registrar recepción</button>');
  }
  if (r.status === 'recibida' && esAdmin) {
    acciones.push('<button class="btn primary" data-rq-act="invoice">Registrar factura</button>');
  }
  if (r.status === 'facturada' && esAdmin) {
    acciones.push('<button class="btn primary" data-rq-act="pay">Registrar pago</button>');
  }
  if (r.status === 'pagada' && esAdmin) {
    acciones.push('<button class="btn primary" data-rq-act="close">Cerrar requisición</button>');
  }
  if (['borrador', 'solicitada', 'aprobada', 'orden_emitida'].includes(r.status) && esAdmin) {
    acciones.push('<button class="btn ghost" data-rq-act="void">Anular</button>');
  }
  if (['borrador', 'solicitada', 'aprobada'].includes(r.status)) {
    acciones.push('<button class="btn" data-rq-act="rfq">Solicitar cotización</button>');
  }
  acciones.push(`<a class="btn ghost" href="requisicion.html?t=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">Imprimir</a>`);

  openRqDrawer({
    title: r.code,
    subtitle: `${RQ_STATUS[r.status]} · ${esc(r.title)}`,
    body: `
      <div class="panel">
        <div class="rq-grid">
          <div><span>Departamento</span><b>${esc(deptName(r.department_id))}</b></div>
          <div><span>Proveedor</span><b>${esc(supName(r.supplier_id))}</b></div>
          <div><span>Tipo</span><b>${r.kind === 'servicio' ? 'Servicio' : 'Producto'}</b></div>
          <div><span>Solicitó</span><b>${esc(r.requested_by === RQ.me ? 'Yo' : 'Personal')}</b></div>
          <div><span>Creada</span><b>${fmtShort(r.created_at)}</b></div>
          <div><span>Estado</span><b>${RQ_STATUS[r.status]}</b></div>
        </div>
        ${r.justification ? `<p class="small" style="margin:.6rem 0 0"><b>Justificación:</b> ${esc(r.justification)}</p>` : ''}
        ${r.approval_hash ? `<p class="small muted" style="margin:.4rem 0 0">Sello de aprobación: <span class="mono">${esc(r.approval_hash.slice(0, 16))}…</span> · ${fmtShort(r.approved_at)}</p>` : ''}
        ${r.oc_code ? `<p class="small muted" style="margin:.2rem 0 0">Orden de compra: <b class="mono">${esc(r.oc_code)}</b></p>` : ''}
      </div>

      <div class="panel">
        <h3 style="margin-top:0">Partidas y montos</h3>
        <table class="table">
          <thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td>${esc(i.description)}</td><td class="num">${Number(i.qty)}</td>
            <td class="num">${money(i.unit_price)}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="rq-totals">
          <div><span>Subtotal</span><b>${money(r.subtotal)}</b></div>
          <div><span>IVA</span><b>${money(r.tax)}</b></div>
          ${Number(r.retention) > 0 ? `<div><span>Retención</span><b>− ${money(r.retention)}</b></div>` : ''}
          <div class="rq-grand"><span>Total</span><b>${money(r.total)}</b></div>
        </div>
      </div>

      ${qs.length ? `<div class="panel"><h3 style="margin-top:0">Cotizaciones</h3>
        <table class="table"><tbody>${qs.map((q) => `<tr>
          <td>${esc(q.supplier_name || supName(q.supplier_id))}${q.chosen ? ' ✓' : ''}</td>
          <td class="num">${money(q.amount)}</td>
          <td class="small muted">${q.lead_days ? q.lead_days + ' días' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}

      <div class="panel">
        <h3 style="margin-top:0">Solicitudes enviadas al proveedor</h3>
        <p class="small muted" style="margin:.2rem 0 .6rem">Cada solicitud tiene su folio <b class="mono">SC-AÑO-00000</b> y queda registrada con fecha, destinatario y copia.</p>
        <div id="rqRfqList">${rqs.length ? rqs.map((q) => `
          <div class="rq-doc">
            <span class="mono" style="font-weight:700">${esc(q.code)}</span>
            <div style="flex:1;min-width:0">
              <b>${esc(q.supplier_name || supName(q.supplier_id))}</b>
              <div class="small muted" style="overflow-wrap:anywhere">${esc(q.to_email)}${q.cc_email ? ` · copia a ${esc(q.cc_email)}` : ' · sin copia'} · ${fmtShort(q.sent_at || q.created_at)}</div>
              ${q.last_error ? `<div class="small" style="color:#ff3300;overflow-wrap:anywhere">${esc(q.last_error)}</div>` : ''}
            </div>
            <div class="row" style="gap:.3rem;align-items:center">
              <span class="small" style="color:${q.status === 'fallida' ? '#ff3300' : 'inherit'}">${esc(RFQ_STATUS[q.status] || q.status)}</span>
              ${['programada', 'fallida'].includes(q.status) ? `<button class="btn sm" type="button" data-rfq-send="${q.id}">${q.status === 'fallida' ? 'Reintentar' : 'Enviar'}</button>` : ''}
            </div>
          </div>`).join('') : '<p class="small muted">Todavía no se ha enviado ninguna solicitud de cotización.</p>'}</div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">Documentos</h3>
          <button class="btn sm" type="button" id="rqDocAdd">+ Subir</button>
        </div>
        <div class="row" style="gap:.4rem;align-items:center;margin:.5rem 0">
          <select id="rqDocKind" style="width:auto">${DOC_KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          <span class="small muted" id="rqDocHint">PDF o imagen, hasta 10 MB</span>
        </div>
        <div id="rqDocList">${ds.length ? ds.map((d) => `
          <div class="rq-doc">
            <span>${esc(DOC_KINDS.find((k) => k[0] === d.kind)?.[1] || d.kind)}</span>
            <b>${esc(d.file_name || 'documento')}</b>
            <button class="btn sm ghost" type="button" data-doc="${d.id}">Abrir</button>
          </div>`).join('') : '<p class="small muted">Sin documentos. Sube la cotización o la factura.</p>'}</div>
      </div>

      <div class="panel">
        <h3 style="margin-top:0">Historial</h3>
        ${ev.length ? ev.map((e) => `<div class="evline"><b>${RQ_STATUS[e.to_status] || e.to_status}</b>
          <div>${esc(e.note || '')} · ${fmtShort(e.created_at)}</div></div>`).join('') : '<p class="small muted">Sin eventos.</p>'}
      </div>`,
    foot: acciones.join(' '),
  });

  // documentos: abrir con enlace firmado (bucket privado)
  $('#rqDocList').onclick = async (e) => {
    const b = e.target.closest('[data-doc]');
    if (!b) return;
    const doc = ds.find((d) => d.id === b.dataset.doc);
    if (!doc) return;
    const { data, error } = await sb.storage.from('ts-documentos').createSignedUrl(doc.file_path, 300);
    if (error) return toast(errMessage(error), 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // enviar o reintentar una solicitud de cotización
  const rfqBox = $('#rqRfqList');
  if (rfqBox) {
    rfqBox.onclick = (e) => {
      const b = e.target.closest('[data-rfq-send]');
      if (b) sendRfq(b.dataset.rfqSend, b, r);
    };
  }

  // subir documento
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'rqDocFile';
  input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);
  $('#rqDocAdd').onclick = () => input.click();
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const kind = $('#rqDocKind').value;
    let ok = 0;
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast(`"${f.name}" pasa de 10 MB`, 'err'); continue; }
      const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `req/${r.code}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const up = await sb.storage.from('ts-documentos').upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) { toast(errMessage(up.error), 'err'); continue; }
      const ins = await sb.from('ts_requisition_docs').insert({
        requisition_id: r.id, kind, file_path: path, file_name: f.name, uploaded_by: RQ.me,
      });
      if (ins.error) { toast(errMessage(ins.error), 'err'); continue; }
      ok += 1;
    }
    if (ok) { toast(`${ok} documento(s) subido(s)`); openRequisition(r.id); }
  };

  // acciones del flujo (asignación única: no se acumulan listeners)
  const act = async (e) => {
    if (RQ.openId !== r.id) return;
    const b = e.target.closest('[data-rq-act]');
    if (!b) return;
    const a = b.dataset.rqAct;
    b.disabled = true;

    if (a === 'submit') {
      const { error } = await sb.rpc('ts_req_set_status', { p_id: r.id, p_status: 'solicitada', p_note: 'Enviada a aprobación' });
      if (error) return toast(errMessage(error), 'err');
      toast('Enviada a aprobación');
    }
    if (a === 'approve') {
      if (!ds.some((d) => d.kind === 'cotizacion')) {
        if (!confirm('No hay ninguna cotización adjunta. ¿Aprobar de todas formas?')) { b.disabled = false; return; }
      }
      const { error } = await sb.rpc('ts_req_approve', { p_id: r.id, p_note: 'Aprobada por el CEO' });
      if (error) return toast(errMessage(error), 'err');
      toast('Requisición aprobada');
    }
    if (a === 'oc') {
      const { error } = await sb.rpc('ts_req_issue_oc', { p_id: r.id });
      if (error) return toast(errMessage(error), 'err');
      toast('Orden de compra emitida');
    }
    if (a === 'receive') {
      if (!confirm('¿Registrar la recepción? Si es mercancía, entra al inventario y se actualiza el costo.')) {
        b.disabled = false; return;
      }
      const { error } = await sb.rpc('ts_req_receive', { p_id: r.id, p_note: 'Recepción registrada' });
      if (error) return toast(errMessage(error), 'err');
      toast('Recepción registrada');
    }
    if (a === 'rfq') { b.disabled = false; return openRfqForm(r); }
    if (a === 'invoice') return openInvoiceForm(r, b);
    if (a === 'pay') return openPayForm(r, b);
    if (a === 'close') {
      const { error } = await sb.rpc('ts_req_close', { p_id: r.id });
      if (error) return toast(errMessage(error), 'err');
      toast('Requisición cerrada');
    }
    if (a === 'void') {
      const motivo = prompt('Motivo de la anulación:');
      if (!motivo) { b.disabled = false; return; }
      const { error } = await sb.rpc('ts_req_anular', { p_id: r.id, p_reason: motivo });
      if (error) return toast(errMessage(error), 'err');
      toast('Requisición anulada');
    }

    await loadRequisitions(true);
    renderRequisitions(RQ.isAdmin);
    openRequisition(r.id);
  };
  $('#dFoot').onclick = act;
}

function fmtShort(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' });
}

/* ---------------- factura y pago ---------------- */
function openInvoiceForm(r, btn) {
  btn.disabled = false;
  openRqDrawer({
    title: r.code,
    subtitle: 'Registrar factura del proveedor',
    body: `<div class="panel">
      <div class="field"><label for="invNum">Número de factura *</label>
        <input id="invNum" placeholder="FC-2026-00123" value="${esc(r.invoice_number || '')}"></div>
      <div class="field"><label for="invNumCCF">Documento</label>
        <select id="invNumType"><option value="ccf">Comprobante de crédito fiscal</option>
        <option value="factura">Factura consumidor final</option></select>
        <span class="small muted">El CCF es el que permite acreditar el IVA.</span></div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="invSub">Subtotal</label>
          <input id="invSub" type="number" step="0.01" value="${Number(r.subtotal)}"></div>
        <div class="field" style="flex:0 0 110px"><label for="invIvaPct">IVA %</label>
          <input id="invIvaPct" type="number" step="0.5" value="${Number(RQ.taxes?.iva ?? 13)}"></div>
      </div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="invRetPct">Retención % (null si no aplica)</label>
          <input id="invRetPct" type="number" step="0.5" value="${r.kind === 'servicio' ? Number(RQ.taxes?.retention_services ?? 10) : 0}"></div>
        <div class="field" style="flex:1"><label>Total a pagar</label>
          <input id="invTotal" readonly></div>
      </div>
      <p class="small muted">Ajusta los montos a lo que dice la factura física; no tienen por qué coincidir con la cotización.</p>
    </div>`,
    foot: `<button class="btn primary" id="invSave">Guardar factura</button><button class="btn ghost" id="invCancel">Cancelar</button>`,
  });

  const recalcular = () => {
    const sub = Number($('#invSub').value) || 0;
    const iva = Number($('#invIvaPct').value) || 0;
    const ret = Number($('#invRetPct').value) || 0;
    const total = sub + sub * iva / 100 - sub * ret / 100;
    $('#invTotal').value = total.toFixed(2);
  };
  ['invSub', 'invIvaPct', 'invRetPct'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = recalcular;
  });
  recalcular();

  $('#invCancel').onclick = () => openRequisition(r.id);
  $('#invSave').onclick = async (e) => {
    const btn = e.currentTarget;
    const num = $('#invNum').value.trim();
    if (!num) return toast('Escribe el número de factura', 'err');
    const sub = Number($('#invSub').value) || 0;
    const iva = Number($('#invIvaPct').value) || 0;
    const ret = Number($('#invRetPct').value) || 0;
    btn.disabled = true;
    const { error } = await sb.rpc('ts_req_invoice', {
      p_id: r.id, p_invoice: num, p_subtotal: sub,
      p_tax: Math.round(sub * iva) / 100, p_retention: Math.round(sub * ret) / 100,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast('Factura registrada');
    await loadRequisitions(true);
    renderRequisitions(RQ.isAdmin);
    openRequisition(r.id);
  };
}

function openPayForm(r, btn) {
  btn.disabled = false;
  openRqDrawer({
    title: r.code,
    subtitle: `Registrar pago de ${money(r.total)}`,
    body: `<div class="panel">
      <div class="field"><label for="payMethod">Método</label>
        <select id="payMethod">${PAY_METHODS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <div class="field"><label for="payRef">Referencia</label>
        <input id="payRef" placeholder="N° de transferencia, cheque o recibo"></div>
      <label class="row" style="gap:.5rem;align-items:center;font-size:.86rem;margin:.4rem 0">
        <input type="checkbox" id="payCash" style="width:auto"> Descontar de la caja abierta</label>
      <p class="small muted" style="margin:0">Si marcas esta casilla y es efectivo, se registra el egreso en la caja para que el arqueo cuadre.</p>
    </div>`,
    foot: `<button class="btn primary" id="payOk">Confirmar pago</button><button class="btn ghost" id="payCancel">Cancelar</button>`,
  });

  const method = $('#payMethod');
  const cash = $('#payCash');
  const sync = () => { cash.checked = method.value === 'efectivo' ? cash.checked : false; };
  method.onchange = sync;

  $('#payCancel').onclick = () => openRequisition(r.id);
  $('#payOk').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await sb.rpc('ts_req_pay', {
      p_id: r.id, p_method: method.value, p_ref: $('#payRef').value.trim() || null,
      p_from_cash: cash.checked,
    });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast('Pago registrado');
    await loadRequisitions(true);
    renderRequisitions(RQ.isAdmin);
    openRequisition(r.id);
  };
}

/* ---------------- solicitud de cotización por correo ---------------- */
function openRfqForm(r) {
  const activos = RQ.suppliers.filter((s) => s.active !== false);
  const supOpts = activos.map((s) =>
    `<option value="${s.id}" ${r.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}${s.email ? ' · ' + esc(s.email) : ' · SIN CORREO'}</option>`).join('');
  const defSup = activos.find((s) => s.id === r.supplier_id) || null;

  openRqDrawer({
    title: r.code,
    subtitle: 'Solicitud de cotización por correo',
    body: `<div class="panel">
      <div class="field"><label for="rfqSup">Proveedor *</label>
        <select id="rfqSup"><option value="">— seleccionar —</option>${supOpts}</select></div>
      <div class="field"><label for="rfqTo">Correo del proveedor *</label>
        <input id="rfqTo" type="email" value="${esc(defSup?.email || '')}" placeholder="compras@proveedor.com">
        <span class="small muted">Sale del correo registrado en Proveedores. Puedes corregirlo para este envío.</span></div>
      <div class="field"><label for="rfqCc">Copia para el negocio</label>
        <input id="rfqCc" type="email" value="${esc(RQ.biz?.email || '')}" placeholder="correo@negocio.com">
        <span class="small muted">Ahí queda el registro de lo solicitado. Se configura en Ajustes → Datos del negocio.</span></div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="rfqNote">Nota para el proveedor</label>
          <textarea id="rfqNote" rows="2" placeholder="Condiciones, forma de pago, entrega..."></textarea></div>
        <div class="field" style="flex:0 0 110px"><label for="rfqDays">Responder en (días)</label>
          <input id="rfqDays" type="number" min="1" max="60" value="5"></div>
      </div>
      <p class="small muted" style="margin:.3rem 0 0">El folio se asigna al enviar: <b class="mono">SC-${new Date().getFullYear()}-00000</b>. El correo lleva las partidas <b>sin precios</b>, tu nota y el plazo para responder.</p>
    </div>`,
    foot: `<button class="btn primary" id="rfqSend">Enviar solicitud</button><button class="btn ghost" id="rfqBack">Cancelar</button>`,
  });

  const selSup = $('#rfqSup');
  const toI = $('#rfqTo');
  if (defSup) selSup.value = defSup.id;
  selSup.onchange = () => {
    const s = RQ.suppliers.find((x) => x.id === selSup.value);
    toI.value = s?.email || '';
  };
  $('#rfqBack').onclick = () => openRequisition(r.id);
  $('#rfqSend').onclick = async (e) => {
    const btn = e.currentTarget;
    const to = toI.value.trim();
    if (!selSup.value) return toast('Selecciona el proveedor', 'err');
    if (!to) return toast('Falta el correo del proveedor', 'err');
    btn.disabled = true;
    const { data, error } = await sb.rpc('ts_rfq_create', {
      p_req: r.id,
      p_supplier: selSup.value,
      p_to: to,
      p_cc: $('#rfqCc').value.trim() || null,
      p_note: $('#rfqNote').value.trim() || null,
      p_days: Number($('#rfqDays').value) || 5,
    });
    if (error) { btn.disabled = false; return toast(errMessage(error), 'err'); }
    toast(`${data.code} preparada, enviando…`);
    await sendRfq(data.id, btn, r);
    await loadRequisitions(true);
    renderRequisitions(RQ.isAdmin);
    openRequisition(r.id);
  };
}

/** Envía (o reintenta) una solicitud ya registrada. El registro lo cierra la Edge Function. */
async function sendRfq(rfqId, btn, r) {
  if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke('rfq-send', { body: { id: rfqId } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast(`Solicitud ${data?.code || ''} enviada a ${data?.to || 'proveedor'}`);
    return true;
  } catch (err) {
    toast(`No se pudo enviar: ${errMessage(err)}`, 'err');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- eventos ---------------- */
export function initRequisitions(isAdmin) {
  RQ.isAdmin = isAdmin;
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on('btnNewReq', 'click', () => openReqEditor(null));
  on('rqSearch', 'input', (e) => { RQ.filters.q = e.target.value; renderRequisitions(RQ.isAdmin); });
  on('rqStatus', 'change', (e) => { RQ.filters.status = e.target.value; renderRequisitions(RQ.isAdmin); });
  on('rqDept', 'change', (e) => { RQ.filters.dept = e.target.value; renderRequisitions(RQ.isAdmin); });

  const table = document.getElementById('rqTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const row = e.target.closest('[data-req]');
      if (!row) return;
      openRequisition(row.dataset.req);
    });
  }
}
