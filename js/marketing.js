/* marketing.js — módulo Marketing: redes, calendario editorial, contenido y métricas */
import { sb, money, esc, toast, errMessage, getUser, openDrawerUI, closeDrawerUI } from './core.js?v=828d81de';

/* ---------------- constantes ---------------- */
export const NETS = {
  instagram: { label: 'Instagram', icon: '📷', color: '#e1306c' },
  facebook: { label: 'Facebook', icon: '📘', color: '#1877f2' },
  tiktok: { label: 'TikTok', icon: '🎵', color: '#111827' },
  whatsapp: { label: 'WhatsApp', icon: '💬', color: '#25d366' },
};

export const KINDS = [
  ['producto', 'Producto'],
  ['promo', 'Promoción'],
  ['educativo', 'Educativo'],
  ['prueba', 'Prueba social'],
  ['detras', 'Detrás de cámara'],
  ['aviso', 'Aviso'],
];

export const STATUS = {
  idea: 'Idea', borrador: 'Borrador', aprobado: 'Aprobado',
  programado: 'Programado', publicado: 'Publicado', descartado: 'Descartado',
};

const TEMPLATES = [
  ['precio', 'Foto + precio'],
  ['nuevo', 'Foto + NUEVO'],
  ['oferta', 'Antes / ahora'],
  ['solo_foto', 'Solo foto'],
  ['texto', 'Texto sobre color'],
];

const HOOKS = [
  '¿Buscabas {nombre}? Ya está aquí',
  'Solo {stock} unidades de {nombre}',
  '{nombre} a {precio} — sin vueltas',
  'Así llega tu pedido: {nombre}',
  '{marca} que sí rinde: {nombre}',
];

const HASH_BASE = '#TechStoreSV #Tecnologia #ElSalvador #CompraLocalSV';

export const MKT = {
  content: [], campaigns: [], stats: {}, products: [],
  calDate: new Date(), loaded: false, editing: null,
};

/* ---------------- utilidades ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function stamp(ts) {
  if (!ts) return 'sin fecha';
  const d = new Date(ts);
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

function dayOf(p) {
  const base = p.scheduled_for || p.published_at || p.created_at;
  return base ? new Date(base) : null;
}

/* ---------------- carga ---------------- */
export async function loadMarketing(force = false) {
  if (MKT.loaded && !force) return MKT;
  const [content, camps, stats, prods, social] = await Promise.all([
    sb.from('ts_content').select('*').order('created_at', { ascending: false }),
    sb.from('ts_campaigns').select('*').order('created_at', { ascending: false }),
    sb.from('ts_social_stats').select('*'),
    sb.rpc('ts_marketing_products', { p_q: null }),
    sb.from('ts_settings').select('value').eq('key', 'social').maybeSingle(),
  ]);
  MKT.content = content.data || [];
  MKT.campaigns = camps.data || [];
  MKT.stats = Object.fromEntries((stats.data || []).map((s) => [s.network, s]));
  MKT.products = prods.data || [];
  MKT.social = social.data?.value || {};
  MKT.loaded = true;
  return MKT;
}

/* ---------------- panel de marketing ---------------- */
export function renderMarketing() {
  const now = new Date();
  const mes = now.getMonth(), anio = now.getFullYear();
  const delMes = MKT.content.filter((c) => {
    const d = dayOf(c);
    return d && d.getMonth() === mes && d.getFullYear() === anio;
  });
  const publicadas = delMes.filter((c) => c.status === 'publicado').length;
  const programadas = MKT.content.filter((c) => c.status === 'programado').length;
  const pendientes = MKT.content.filter((c) => ['idea', 'borrador', 'aprobado'].includes(c.status)).length;
  const seguidores = Object.values(MKT.stats).reduce((n, s) => n + (s.followers || 0), 0);

  $('#mktKpis').innerHTML = `
    <div class="kpi"><span>Publicadas este mes</span><b>${publicadas}</b></div>
    <div class="kpi"><span>Programadas</span><b>${programadas}</b></div>
    <div class="kpi"><span>En preparación</span><b>${pendientes}</b></div>
    <div class="kpi"><span>Seguidores (suma)</span><b>${seguidores.toLocaleString('es-SV')}</b></div>`;

  // tarjetas de red
  $('#mktNets').innerHTML = Object.entries(NETS).map(([key, meta]) => {
    const st = MKT.stats[key] || {};
    const sc = MKT.social?.[key] || {};
    const posts = MKT.content.filter((c) => (c.networks || []).includes(key) && c.status === 'publicado').length;
    const apiLabel = {
      sin_conectar: 'sin conectar', credencial_guardada: 'credencial guardada',
      conectada: 'conectada', token_vencido: 'token vencido',
    }[st.api_status] || 'sin conectar';
    return `<div class="net-card">
      <div class="net-head">
        <span class="net-icon" style="background:${meta.color}22;color:${meta.color}">${meta.icon}</span>
        <div style="min-width:0">
          <b>${esc(meta.label)}</b>
          <div class="small muted">${esc(sc.handle || 'sin usuario')}${st.followers ? ` · ${st.followers.toLocaleString('es-SV')} seguidores` : ''}</div>
        </div>
        <button class="btn sm ghost" data-net-edit="${key}" style="margin-left:auto">Editar</button>
      </div>
      <div class="net-meta">
        <span class="pill">${posts} publicada${posts === 1 ? '' : 's'}</span>
        <span class="pill ${st.api_status === 'conectada' ? 'ok' : st.api_status === 'token_vencido' ? 'bad' : ''}">API: ${apiLabel}</span>
        ${st.followers_at ? `<span class="pill">dato del ${fmtDia(st.followers_at)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // semana en curso
  const hoy = new Date();
  const lunes = addDays(hoy, -((hoy.getDay() + 6) % 7));
  const semana = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(lunes, i);
    const items = MKT.content.filter((c) => dayOf(c) && iso(dayOf(c)) === iso(d));
    semana.push({ d, items });
  }
  $('#mktWeek').innerHTML = semana.map(({ d, items }) => `
    <div class="wk-row ${iso(d) === iso(hoy) ? 'today' : ''}">
      <span class="wk-day">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][(d.getDay() + 6) % 7]} ${d.getDate()}</span>
      <span class="wk-items">${items.length
        ? items.map((c) => `<span class="cal-chip ${c.status === 'publicado' ? 'ok' : c.status === 'programado' ? 'warn' : 'free'}">${esc(c.title)}</span>`).join(' ')
        : '<span class="small muted">libre</span>'}</span>
    </div>`).join('');

  // alerta de hueco
  const publi = MKT.content.filter((c) => c.status === 'publicado' && c.published_at)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const dias = publi.length ? Math.floor((Date.now() - new Date(publi[0].published_at)) / 86400000) : null;
  const alerta = $('#mktAlert');
  if (dias !== null && dias >= 5) {
    alerta.style.display = '';
    alerta.textContent = `Llevas ${dias} días sin publicar. Toca crear una pieza para hoy.`;
  } else if (!MKT.content.length) {
    alerta.style.display = '';
    alerta.textContent = 'Todavía no hay piezas. Empieza con un producto que quieras mover.';
  } else {
    alerta.style.display = 'none';
  }
}

function fmtDia(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
}

/* ---------------- calendario editorial ---------------- */
export function renderEditorial() {
  const base = MKT.calDate;
  $('#edTitle').textContent = `${MESES[base.getMonth()]} ${base.getFullYear()}`;
  $('#edDow').innerHTML = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    .map((d) => `<div class="cal-dow">${d}</div>`).join('');

  const primero = new Date(base.getFullYear(), base.getMonth(), 1);
  const offset = (primero.getDay() + 6) % 7;
  const inicio = addDays(primero, -offset);
  const netF = $('#edNetFilter').value;

  const celdas = [];
  for (let i = 0; i < 42; i += 1) {
    const d = addDays(inicio, i);
    const fuera = d.getMonth() !== base.getMonth();
    const items = MKT.content.filter((c) => {
      const dd = dayOf(c);
      if (!dd || iso(dd) !== iso(d)) return false;
      if (netF !== 'all' && !(c.networks || []).includes(netF)) return false;
      return true;
    });
    celdas.push(`<div class="cal-cell ${fuera ? 'off' : ''} ${iso(d) === iso(new Date()) ? 'today' : ''}" data-day="${iso(d)}">
      <div class="cal-num">${d.getDate()}</div>
      ${items.slice(0, 3).map((c) => `<span class="cal-chip ${c.status === 'publicado' ? 'ok' : c.status === 'programado' ? 'warn' : 'free'}" data-piece="${c.id}">${esc(c.title.slice(0, 18))}</span>`).join('')}
      ${items.length > 3 ? `<span class="small muted">+${items.length - 3}</span>` : ''}
    </div>`);
  }
  $('#edGrid').innerHTML = celdas.join('');

  const mes = MKT.content.filter((c) => {
    const d = dayOf(c);
    return d && d.getMonth() === base.getMonth() && d.getFullYear() === base.getFullYear();
  });
  $('#edList').innerHTML = mes.length ? mes.map((c) => `
    <div class="evline" data-piece="${c.id}" style="cursor:pointer">
      <b>${esc(c.code)}</b> · ${esc(c.title)}
      <div>${STATUS[c.status]} · ${(c.networks || []).map((n) => NETS[n]?.label || n).join(', ')} · ${stamp(c.scheduled_for || c.published_at)}</div>
    </div>`).join('') : '<p class="small muted">Sin piezas este mes.</p>';
}

/* ---------------- biblioteca de contenido ---------------- */
export function renderContent() {
  const q = ($('#ctSearch').value || '').trim().toLowerCase();
  const st = $('#ctStatus').value;
  const items = MKT.content.filter((c) => {
    if (st !== 'all' && c.status !== st) return false;
    if (!q) return true;
    return c.title.toLowerCase().includes(q) || (c.body || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q);
  });

  $('#ctEmpty').hidden = items.length > 0;
  $('#ctGrid').innerHTML = items.map((c) => {
    const prod = MKT.products.find((p) => p.id === c.product_id);
    const img = c.media_url || prod?.image_url || 'assets/img/placeholder.svg';
    return `<article class="ct-card" data-piece="${c.id}">
      <div class="ct-thumb"><img src="${esc(img)}" alt=""></div>
      <div class="ct-body">
        <div class="row" style="justify-content:space-between;gap:.4rem">
          <span class="small muted mono">${esc(c.code)}</span>
          <span class="pill st-${c.status}">${STATUS[c.status]}</span>
        </div>
        <b class="ct-title">${esc(c.title)}</b>
        <div class="small muted">${(c.networks || []).map((n) => NETS[n]?.icon || '').join(' ')} · ${stamp(c.scheduled_for || c.published_at)}</div>
        <div class="row" style="gap:.3rem;margin-top:.4rem">
          <button class="btn sm" data-edit-piece="${c.id}">Editar</button>
          ${c.status === 'publicado'
            ? '<button class="btn sm ghost" data-metrics="' + c.id + '">Métricas</button>'
            : `<button class="btn sm ghost" data-publish="${c.id}">Marcar publicado</button>`}
        </div>
      </div>
    </article>`;
  }).join('');
}

/* ---------------- métricas ---------------- */
export function renderMetrics() {
  const publicadas = MKT.content.filter((c) => c.status === 'publicado');
  const ids = publicadas.map((c) => c.id);
  return sb.from('ts_content_metrics').select('*').in('content_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    .then(({ data }) => {
      const m = data || [];
      const sum = (k) => m.reduce((n, x) => n + (x[k] || 0), 0);
      $('#mtKpis').innerHTML = `
        <div class="kpi"><span>Publicaciones medidas</span><b>${new Set(m.map((x) => x.content_id)).size}</b></div>
        <div class="kpi"><span>Alcance</span><b>${sum('reach').toLocaleString('es-SV')}</b></div>
        <div class="kpi"><span>Interacciones</span><b>${(sum('likes') + sum('comments') + sum('saves') + sum('shares')).toLocaleString('es-SV')}</b></div>
        <div class="kpi"><span>Clics</span><b>${sum('clicks').toLocaleString('es-SV')}</b></div>`;

      const porTipo = {};
      const porRed = {};
      m.forEach((x) => {
        const pieza = MKT.content.find((c) => c.id === x.content_id);
        const k = pieza?.kind || 'otro';
        const inter = (x.likes || 0) + (x.comments || 0) + (x.saves || 0) + (x.shares || 0);
        porTipo[k] = (porTipo[k] || 0) + inter;
        porRed[x.network] = (porRed[x.network] || 0) + inter;
      });
      const barras = (obj, labeler) => {
        const max = Math.max(1, ...Object.values(obj));
        const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]);
        return ent.length ? ent.map(([k, v]) => `
          <div class="bar-row"><span>${esc(labeler(k))}</span>
            <div class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></div>
            <b>${v}</b></div>`).join('') : '<p class="small muted">Sin datos aún.</p>';
      };
      $('#mtByKind').innerHTML = barras(porTipo, (k) => (KINDS.find((x) => x[0] === k) || [, k])[1]);
      $('#mtByNet').innerHTML = barras(porRed, (k) => NETS[k]?.label || k);

      $('#mtTable').innerHTML = publicadas.length ? `
        <div style="overflow-x:auto"><table class="table stack-mobile">
          <thead><tr><th>Pieza</th><th>Red</th><th class="num">Alcance</th><th class="num">Inter.</th><th class="num">Clics</th><th>Medido</th><th></th></tr></thead>
          <tbody>${m.map((x) => {
            const p = MKT.content.find((c) => c.id === x.content_id);
            return `<tr>
              <td data-label="Pieza">${esc(p?.title || '—')}</td>
              <td data-label="Red">${NETS[x.network]?.label || x.network}</td>
              <td data-label="Alcance" class="num">${x.reach || 0}</td>
              <td data-label="Inter." class="num">${(x.likes || 0) + (x.comments || 0) + (x.saves || 0) + (x.shares || 0)}</td>
              <td data-label="Clics" class="num">${x.clicks || 0}</td>
              <td data-label="Medido" class="small muted">${fmtDia(x.measured_on)}</td>
              <td><button class="btn sm ghost" data-metrics="${x.content_id}">Editar</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<p class="small muted">Aún no hay publicaciones medidas. Marca una pieza como publicada y registra sus números.</p>';
    });
}

/* ---------------- drawer propio ---------------- */
function openMktDrawer({ title, subtitle = '', body = '', foot = '' }) {
  const drawer = $('#drawer');
  $('#dCode').textContent = title;
  $('#dMeta').innerHTML = subtitle;
  $('#dBody').innerHTML = body;
  $('#dFoot').innerHTML = foot;
  drawer.classList.remove('hidden');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  openDrawerUI();
  $('#dBody').scrollTop = 0;
}
function closeMktDrawer() {
  const drawer = $('#drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  closeDrawerUI();
}

/* ---------------- editor de pieza ---------------- */
export function openContentEditor(id = null, presetDate = null) {
  MKT.pendingMedia = null;
  const c = id ? MKT.content.find((x) => x.id === id) : null;
  const redes = c?.networks || ['instagram'];
  const cuando = c?.scheduled_for ? new Date(c.scheduled_for) : (presetDate ? new Date(presetDate) : null);
  const fechaTxt = cuando ? `${cuando.getFullYear()}-${pad(cuando.getMonth() + 1)}-${pad(cuando.getDate())}` : '';
  const horaTxt = cuando ? `${pad(cuando.getHours())}:${pad(cuando.getMinutes())}` : '10:00';

  const prodOpts = MKT.products.map((p) =>
    `<option value="${p.id}" ${c?.product_id === p.id ? 'selected' : ''}>${esc(p.sku)} · ${esc(p.name)}</option>`).join('');

  openMktDrawer({
    title: c ? c.code : 'Nueva pieza',
    subtitle: c ? 'Editar contenido' : 'Crear contenido para redes',
    body: `
      <div class="panel">
        <div class="field"><label for="cTitle">Título interno *</label>
          <input id="cTitle" value="${esc(c?.title || '')}" placeholder="NovaBook Pro 15 — precio"></div>

        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="cKind">Tipo</label>
            <select id="cKind">${KINDS.map(([v, t]) => `<option value="${v}" ${c?.kind === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label for="cStatus">Estado</label>
            <select id="cStatus">${Object.entries(STATUS).map(([v, t]) => `<option value="${v}" ${c?.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>

        <div class="field"><label>Redes</label>
          <div class="row" style="gap:.8rem;flex-wrap:wrap">
            ${Object.entries(NETS).map(([k, m]) => `<label class="row" style="gap:.35rem;align-items:center;font-size:.85rem">
              <input type="checkbox" data-net-chk="${k}" ${redes.includes(k) ? 'checked' : ''} style="width:auto"> ${m.icon} ${m.label}</label>`).join('')}
          </div></div>

        <div class="field"><label for="cProduct">Producto (opcional)</label>
          <select id="cProduct"><option value="">— sin producto —</option>${prodOpts}</select></div>

        <div class="field"><label for="cHook">Gancho</label>
          <div class="row" style="gap:.4rem">
            <input id="cHook" value="${esc(c?.hook || '')}" placeholder="¿Buscabas NovaBook? Ya está aquí">
            <button class="btn sm" type="button" id="cHookIdea" title="Sugerir gancho">✨</button>
          </div></div>

        <div class="field"><label for="cBody">Texto</label>
          <textarea id="cBody" rows="4" placeholder="Detalles, beneficios, condiciones…">${esc(c?.body || '')}</textarea>
          <span class="small muted" id="cCount">0 caracteres</span></div>

        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="cCta">Llamada a la acción</label>
            <input id="cCta" value="${esc(c?.cta || 'Escríbenos por WhatsApp')}"></div>
          <div class="field" style="flex:1"><label for="cTpl">Plantilla de la imagen</label>
            <select id="cTpl">${TEMPLATES.map(([v, t]) => `<option value="${v}" ${c?.template === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>

        <div class="field"><label for="cTags">Hashtags</label>
          <input id="cTags" value="${esc(c?.hashtags || HASH_BASE)}"></div>

        <div class="row" style="gap:.6rem">
          <div class="field" style="flex:1"><label for="cDate">Fecha</label>
            <input type="date" id="cDate" value="${fechaTxt}"></div>
          <div class="field" style="flex:1"><label for="cTime">Hora</label>
            <input type="time" id="cTime" value="${horaTxt}"></div>
        </div>

        <div class="field" id="pubFields" style="${c?.status === 'publicado' ? '' : 'display:none'}">
          <label for="cPubUrl">Enlace de la publicación</label>
          <input id="cPubUrl" value="${esc(c?.published_url || '')}" placeholder="https://instagram.com/p/…">
        </div>
      </div>

      <div class="panel">
        <h3 style="margin-top:0">Vista previa</h3>
        <div class="row" style="justify-content:center;background:var(--bg-3);padding:.8rem;border-radius:12px">
          <canvas id="cCanvas" width="1080" height="1080" style="width:260px;height:260px;border-radius:10px"></canvas>
        </div>
        <div class="row" style="gap:.5rem;margin-top:.7rem;flex-wrap:wrap">
          <button class="btn sm" type="button" id="cDownload">⬇ Descargar PNG</button>
          <button class="btn sm ghost" type="button" id="cCopy">Copiar texto</button>
          <button class="btn sm ghost" type="button" id="cUpload">Subir imagen a la biblioteca</button>
        </div>
        <p class="small muted" id="cHint" style="margin:.5rem 0 0"></p>
      </div>`,
    foot: `<button class="btn primary" id="cSave">Guardar pieza</button>
           <button class="btn ghost" id="cCancel">Cancelar</button>`,
  });

  const read = () => ({
    title: $('#cTitle').value.trim(),
    kind: $('#cKind').value,
    status: $('#cStatus').value,
    networks: $$('[data-net-chk]').filter((x) => x.checked).map((x) => x.dataset.netChk),
    product_id: $('#cProduct').value || null,
    hook: $('#cHook').value.trim() || null,
    body: $('#cBody').value.trim() || null,
    cta: $('#cCta').value.trim() || null,
    hashtags: $('#cTags').value.trim() || null,
    template: $('#cTpl').value,
    scheduled_for: $('#cDate').value ? new Date(`${$('#cDate').value}T${$('#cTime').value || '10:00'}`).toISOString() : null,
    published_url: $('#cPubUrl')?.value.trim() || null,
  });

  const product = () => MKT.products.find((p) => p.id === $('#cProduct').value) || null;

  const count = () => {
    const n = $('#cBody').value.length;
    $('#cCount').textContent = `${n} caracteres`;
    $('#cCount').style.color = n > 2200 ? 'var(--bad)' : 'var(--muted)';
  };
  $('#cBody').addEventListener('input', count);
  count();

  $('#cStatus').addEventListener('change', (e) => {
    $('#pubFields').style.display = e.target.value === 'publicado' ? '' : 'none';
  });

  $('#cHookIdea').onclick = () => {
    const p = product();
    const tpl = p
      ? HOOKS[Math.floor(Math.random() * HOOKS.length)]
          .replace('{nombre}', p.name).replace('{precio}', money(p.price))
          .replace('{stock}', String(p.stock)).replace('{marca}', p.brand || '')
      : 'Nuevo en TechStore: mira lo último que llegó';
    $('#cHook').value = tpl;
    drawPiece();
  };

  $('#cProduct').addEventListener('change', () => {
    const p = product();
    if (p && !$('#cTitle').value.trim()) $('#cTitle').value = p.name;
    drawPiece();
  });

  /** Dibuja la pieza en el canvas 1080x1080. Tres layouts sin solapes. */
  let drawToken = 0;
  function drawPiece() {
    const cv = $('#cCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = 1080, H = 1080;
    const p = product();
    const data = read();
    const token = ++drawToken;

    const fit = (txt, maxW) => {
      let t = String(txt || '');
      if (ctx.measureText(t).width <= maxW) return t;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    };

    const drawCta = (yTop) => {
      ctx.font = '700 36px system-ui,sans-serif'; // fuente ANTES de medir
      const cta = fit(data.cta || 'Escríbenos por WhatsApp', W - 210);
      ctx.fillStyle = '#4f46e5';
      roundRect(ctx, 70, yTop, W - 140, 88, 18); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(cta, W / 2, yTop + 56);
      ctx.textAlign = 'left';
    };

    const drawBadge = (y) => {
      if (data.template !== 'nuevo') return;
      ctx.save();
      ctx.translate(W - 190, y);
      ctx.rotate(Math.PI / 20);
      ctx.fillStyle = '#4f46e5';
      roundRect(ctx, -120, -42, 240, 84, 16); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 42px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NUEVO', 0, 14);
      ctx.restore();
      ctx.textAlign = 'left';
    };

    const paint = (image) => {
      if (token !== drawToken) return; // llegó tarde una imagen de otra selección
      ctx.clearRect(0, 0, W, H);

      const name = (data.title || p?.name || 'Tu producto').trim();
      const price = p ? money(p.price) : '';
      const brand = (p?.brand || '').toUpperCase();

      /* --- A) imagen arriba + banda de datos --- */
      if (image && data.template !== 'texto') {
        const mediaH = 660;
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
        // cover alineado arriba: no recorta el centro del producto
        const r = Math.max(W / image.width, mediaH / image.height);
        const dw = image.width * r, dh = image.height * r;
        ctx.drawImage(image, (W - dw) / 2, 0, dw, dh);

        // banda
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, mediaH, W, H - mediaH);
        ctx.fillStyle = '#4f46e5'; ctx.fillRect(0, mediaH, W, 8);

        // el nombre y la marca ya vienen en la imagen del catálogo: no se repiten
        if (price) {
          ctx.fillStyle = data.template === 'oferta' ? '#fbbf24' : '#ffffff';
          ctx.font = '800 118px system-ui,sans-serif';
          ctx.fillText(price, 70, mediaH + 200);
          if (data.template === 'oferta') {
            ctx.fillStyle = '#94a3b8'; ctx.font = '600 40px system-ui,sans-serif';
            const antes = 'antes ' + money(Math.round(Number(p.price) * 1.2));
            ctx.fillText(antes, 70, mediaH + 258);
            const w = ctx.measureText(antes).width;
            ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(66, mediaH + 246); ctx.lineTo(74 + w, mediaH + 246); ctx.stroke();
          }
        }
        drawBadge(96);
        drawCta(H - 130);
        return;
      }

      /* --- B) solo foto: imagen completa con degradado --- */
      if (image && data.template === 'solo_foto') {
        const r = Math.max(W / image.width, H / image.height);
        const dw = image.width * r, dh = image.height * r;
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);

        const g = ctx.createLinearGradient(0, H - 620, 0, H);
        g.addColorStop(0, 'rgba(11,16,32,0)');
        g.addColorStop(1, 'rgba(11,16,32,.95)');
        ctx.fillStyle = g; ctx.fillRect(0, H - 620, W, 620);

        if (brand) {
          ctx.fillStyle = '#a8b3c9'; ctx.font = '700 30px system-ui,sans-serif';
          ctx.fillText(brand, 70, H - 250);
        }
        ctx.fillStyle = '#fff'; ctx.font = '800 56px system-ui,sans-serif';
        ctx.fillText(fit(name, W - 140), 70, H - 180);
        if (price) {
          ctx.fillStyle = '#fbbf24'; ctx.font = '800 96px system-ui,sans-serif';
          ctx.fillText(price, 70, H - 70);
        }
        drawBadge(96);
        return;
      }

      /* --- C) texto sobre color --- */
      const gr = ctx.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, '#1e1b4b'); gr.addColorStop(1, '#4f46e5');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);

      if (brand) {
        ctx.fillStyle = '#c7d2fe'; ctx.font = '700 32px system-ui,sans-serif';
        ctx.fillText(brand, 70, 170);
      }

      ctx.fillStyle = '#ffffff'; ctx.font = '800 88px system-ui,sans-serif';
      wrap(ctx, name, 70, 320, W - 140, 96, 3);

      if (data.hook) {
        ctx.fillStyle = '#c7d2fe'; ctx.font = '600 40px system-ui,sans-serif';
        wrap(ctx, data.hook, 70, 640, W - 140, 50, 2);
      }

      if (price) {
        ctx.fillStyle = '#fbbf24'; ctx.font = '800 128px system-ui,sans-serif';
        ctx.fillText(price, 70, 830);
      }

      drawBadge(96);
      drawCta(H - 130);
    };

    const img = p?.image_url ? new Image() : null;
    if (img) {
      img.crossOrigin = 'anonymous';
      img.onload = () => paint(img);
      img.onerror = () => paint(null);
      img.src = p.image_url;
    } else {
      paint(null);
    }
  }

  function wrap(ctx, text, x, y, maxW, lh, lines) {
    const words = String(text).split(' ');
    let line = '', n = 0;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y + n * lh);
        line = w; n += 1;
        if (n >= lines) return;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, y + n * lh);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  ['cTitle', 'cKind', 'cHook', 'cBody', 'cCta', 'cTags', 'cTpl'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', drawPiece);
  });
  $$('[data-net-chk]').forEach((x) => x.addEventListener('change', drawPiece));

  drawPiece();

  $('#cDownload').onclick = () => {
    const cv = $('#cCanvas');
    cv.toBlob((blob) => {
      if (!blob) return toast('No se pudo generar la imagen', 'err');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(read().title || 'pieza').replace(/[^\w\-]+/g, '-').slice(0, 40)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('PNG descargado');
    }, 'image/png');
  };

  $('#cCopy').onclick = async () => {
    const d = read();
    const texto = [d.hook, d.body, d.cta, d.hashtags].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(texto);
      toast('Texto copiado');
    } catch {
      toast('No se pudo copiar: selecciona el texto a mano', 'err');
    }
  };

  $('#cUpload').onclick = async () => {
    const cv = $('#cCanvas');
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return toast('No se pudo generar la imagen', 'err');
    const path = `marketing/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await sb.storage.from('ts-productos').upload(path, blob, { contentType: 'image/png' });
    if (error) return toast(errMessage(error), 'err');
    const { data } = sb.storage.from('ts-productos').getPublicUrl(path);
    MKT.pendingMedia = data.publicUrl;
    $('#cHint').textContent = 'Imagen subida. Se guardará con la pieza.';
    toast('Imagen en la biblioteca');
  };

  $('#cCancel').onclick = closeMktDrawer;

  $('#cSave').onclick = async (e) => {
    const btn = e.currentTarget;
    const d = read();
    if (!d.title) return toast('Escribe un título', 'err');
    if (!d.networks.length) return toast('Elige al menos una red', 'err');

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const payload = { ...d };
    if (MKT.pendingMedia) payload.media_url = MKT.pendingMedia;
    if (d.status === 'publicado' && !c?.published_at) payload.published_at = new Date().toISOString();

    const user = await getUser();
    if (!c) payload.created_by = user?.id || null;

    const { error } = c
      ? await sb.from('ts_content').update(payload).eq('id', c.id)
      : await sb.from('ts_content').insert(payload);

    btn.disabled = false;
    btn.textContent = 'Guardar pieza';
    if (error) return toast(errMessage(error), 'err');

    MKT.pendingMedia = null;
    toast(c ? 'Pieza actualizada' : 'Pieza creada');
    closeMktDrawer();
    await loadMarketing(true);
    renderCurrent();
  };
}

/* ---------------- métricas de una pieza ---------------- */
async function openMetricsEditor(contentId) {
  const c = MKT.content.find((x) => x.id === contentId);
  if (!c) return;
  const redes = c.networks?.length ? c.networks : ['instagram'];
  openMktDrawer({
    title: c.code,
    subtitle: esc(c.title),
    body: `<div class="panel">
      <div class="field"><label for="mNet">Red</label>
        <select id="mNet">${redes.map((n) => `<option value="${n}">${NETS[n]?.label || n}</option>`).join('')}</select></div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="mReach">Alcance</label><input id="mReach" type="number" min="0" value="0"></div>
        <div class="field" style="flex:1"><label for="mLikes">Me gusta</label><input id="mLikes" type="number" min="0" value="0"></div>
      </div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="mComments">Comentarios</label><input id="mComments" type="number" min="0" value="0"></div>
        <div class="field" style="flex:1"><label for="mSaves">Guardados</label><input id="mSaves" type="number" min="0" value="0"></div>
      </div>
      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="mShares">Compartidos</label><input id="mShares" type="number" min="0" value="0"></div>
        <div class="field" style="flex:1"><label for="mClicks">Clics</label><input id="mClicks" type="number" min="0" value="0"></div>
      </div>
      <p class="small muted">Se guarda un registro por día y red; si repites el día, se actualiza.</p>
    </div>`,
    foot: `<button class="btn primary" id="mSave">Guardar métricas</button><button class="btn ghost" id="mCancel">Cancelar</button>`,
  });

  $('#mCancel').onclick = closeMktDrawer;
  $('#mSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await sb.from('ts_content_metrics').upsert({
      content_id: contentId,
      network: $('#mNet').value,
      measured_on: iso(new Date()),
      reach: Number($('#mReach').value || 0),
      likes: Number($('#mLikes').value || 0),
      comments: Number($('#mComments').value || 0),
      saves: Number($('#mSaves').value || 0),
      shares: Number($('#mShares').value || 0),
      clicks: Number($('#mClicks').value || 0),
    }, { onConflict: 'content_id,network,measured_on' });
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast('Métricas guardadas');
    closeMktDrawer();
    renderMetrics();
  };
}

/* ---------------- editor de red ---------------- */
async function openNetEditor(network) {
  const meta = NETS[network];
  const st = MKT.stats[network] || {};
  const { data: cfg } = await sb.from('ts_settings').select('value').eq('key', 'social').maybeSingle();
  const social = cfg?.value?.[network] || {};

  openMktDrawer({
    title: meta.label,
    subtitle: 'Detalles de la cuenta y conexión',
    body: `<div class="panel">
      <div class="field"><label for="nHandle">Usuario (@)</label>
        <input id="nHandle" value="${esc(social.handle || '')}" placeholder="@tunegocio"></div>
      <div class="field"><label for="nUrl">Enlace del perfil</label>
        <input id="nUrl" value="${esc(social.url || '')}" placeholder="https://instagram.com/tunegocio"></div>
      <label class="row" style="gap:.5rem;align-items:center;font-size:.86rem;margin-bottom:.8rem">
        <input type="checkbox" id="nEnabled" ${social.enabled ? 'checked' : ''} style="width:auto"> Mostrar en la tienda</label>

      <div class="row" style="gap:.5rem">
        <div class="field" style="flex:1"><label for="nFollowers">Seguidores</label>
          <input id="nFollowers" type="number" min="0" value="${st.followers ?? ''}"></div>
        <div class="field" style="flex:1"><label for="nApi">Estado de la API</label>
          <select id="nApi">
            ${[['sin_conectar', 'Sin conectar'], ['credencial_guardada', 'Credencial guardada'], ['conectada', 'Conectada'], ['token_vencido', 'Token vencido']]
              .map(([v, t]) => `<option value="${v}" ${st.api_status === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
      </div>

      <div class="field"><label for="nNotes">Notas internas</label>
        <textarea id="nNotes" rows="2" placeholder="Qué funciona, a quién le hablamos…">${esc(st.notes || '')}</textarea></div>

      <p class="small muted" style="margin:0">Los seguidores se actualizan a mano hasta que la API esté conectada.</p>
    </div>`,
    foot: `<button class="btn primary" id="nSave">Guardar</button>
           ${social.url ? `<a class="btn ghost" href="${esc(social.url)}" target="_blank" rel="noopener noreferrer">Abrir perfil</a>` : ''}
           <button class="btn ghost" id="nCancel">Cancelar</button>`,
  });

  $('#nCancel').onclick = closeMktDrawer;
  $('#nSave').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;

    const nuevoSocial = { ...(cfg?.value || {}), [network]: {
      handle: $('#nHandle').value.trim(),
      url: $('#nUrl').value.trim(),
      enabled: $('#nEnabled').checked,
      api: { enabled: false, app_id: social.api?.app_id || '', secret_key: social.api?.secret_key || `${network}_secret`, status: 'no_configurado' },
    } };
    const s1 = await sb.rpc('ts_save_setting', { p_key: 'social', p_value: nuevoSocial });
    const s2 = await sb.from('ts_social_stats').update({
      followers: $('#nFollowers').value === '' ? null : Number($('#nFollowers').value),
      followers_at: $('#nFollowers').value === '' ? null : iso(new Date()),
      api_status: $('#nApi').value,
      notes: $('#nNotes').value.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('network', network);

    btn.disabled = false;
    if (s1.error) return toast(errMessage(s1.error), 'err');
    if (s2.error) return toast(errMessage(s2.error), 'err');
    toast('Red actualizada');
    closeMktDrawer();
    await loadMarketing(true);
    renderCurrent();
  };
}

/* ---------------- marcar publicado ---------------- */
async function markPublished(id) {
  const c = MKT.content.find((x) => x.id === id);
  if (!c) return;
  openMktDrawer({
    title: c.code,
    subtitle: esc(c.title),
    body: `<div class="panel">
      <p class="small muted" style="margin-top:0">Marca la pieza como publicada cuando ya la subiste a la red. Si pegas el enlace, queda guardado para consultarlo después.</p>
      <div class="field"><label for="pUrl">Enlace de la publicación (opcional)</label>
        <input id="pUrl" value="${esc(c.published_url || '')}" placeholder="https://instagram.com/p/…"></div>
      <div class="field"><label for="pDate">Fecha de publicación</label>
        <input type="date" id="pDate" value="${iso(new Date())}"></div>
    </div>`,
    foot: `<button class="btn primary" id="pOk">Marcar como publicada</button>
           <button class="btn ghost" id="pCancel">Cancelar</button>`,
  });

  $('#pCancel').onclick = closeMktDrawer;
  $('#pOk').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const fecha = $('#pDate').value ? new Date($('#pDate').value + 'T12:00').toISOString() : new Date().toISOString();
    const { error } = await sb.from('ts_content').update({
      status: 'publicado',
      published_at: fecha,
      published_url: $('#pUrl').value.trim() || null,
    }).eq('id', id);
    btn.disabled = false;
    if (error) return toast(errMessage(error), 'err');
    toast('Marcada como publicada');
    closeMktDrawer();
    await loadMarketing(true);
    renderCurrent();
  };
}

/* ---------------- render de la vista activa ---------------- */
function renderCurrent() {
  const visible = $$('#appShell section:not(.hidden)').map((s) => s.id);
  if (visible.includes('view-marketing')) renderMarketing();
  if (visible.includes('view-editorial')) renderEditorial();
  if (visible.includes('view-content')) renderContent();
  if (visible.includes('view-metrics')) renderMetrics();
}

/* ---------------- eventos ---------------- */
export function initMarketing() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on('btnNewContent', 'click', () => openContentEditor(null));
  on('btnQuickCreate', 'click', () => openContentEditor(null));
  on('edNew', 'click', () => openContentEditor(null, MKT.calDate));
  on('btnNetsSettings', 'click', () => {
    const nav = document.querySelector('[data-view="settings"]');
    if (nav) nav.click();
  });

  on('edPrev', 'click', () => { MKT.calDate = new Date(MKT.calDate.getFullYear(), MKT.calDate.getMonth() - 1, 1); renderEditorial(); });
  on('edNext', 'click', () => { MKT.calDate = new Date(MKT.calDate.getFullYear(), MKT.calDate.getMonth() + 1, 1); renderEditorial(); });
  on('edToday', 'click', () => { MKT.calDate = new Date(); renderEditorial(); });
  on('edNetFilter', 'change', renderEditorial);

  on('ctSearch', 'input', renderContent);
  on('ctStatus', 'change', renderContent);

  // tarjetas de red
  document.addEventListener('click', (e) => {
    const netBtn = e.target.closest('[data-net-edit]');
    if (netBtn) return openNetEditor(netBtn.dataset.netEdit);

    const editP = e.target.closest('[data-edit-piece]');
    if (editP) return openContentEditor(editP.dataset.editPiece);

    const card = e.target.closest('[data-piece]');
    if (card && !e.target.closest('button')) return openContentEditor(card.dataset.piece);

    const pub = e.target.closest('[data-publish]');
    if (pub) return markPublished(pub.dataset.publish);

    const met = e.target.closest('[data-metrics]');
    if (met) return openMetricsEditor(met.dataset.metrics);
  });

  // clic en un día del calendario editorial
  const grid = document.getElementById('edGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-piece]');
      if (chip) return openContentEditor(chip.dataset.piece);
      const day = e.target.closest('[data-day]');
      if (day) return openContentEditor(null, `${day.dataset.day}T10:00`);
    });
  }
}
