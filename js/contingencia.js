/* contingencia.js — el cliente elige cómo resolvemos el daño */
import { sb, esc, money } from './core.js?v=3b15e8e6';

const app = document.getElementById('app');
const token = new URLSearchParams(location.search).get('t');

const SEV_TXT = {
  leve: 'un detalle estético leve',
  moderado: 'un golpe visible',
  grave: 'un daño visible importante',
  no_funcional: 'un problema que impide usarlo',
};

const ACTION_TXT = {
  aceptar_averia: 'recibir el producto con el detalle y el descuento',
  sustituir: 'recibir un producto nuevo',
  cancelar_item: 'cancelar solo ese producto y recibir el reembolso',
  cancelar_todo: 'cancelar todo el pedido',
};

/* sustitución primero: es la opción con mejor aceptación */
const ORDER = ['sustituir', 'aceptar_averia', 'cancelar_item', 'cancelar_todo'];

function shell(html) {
  app.innerHTML = html;
}

async function main() {
  if (!token) return shell('<div class="err">Falta el enlace completo. Pídenos que te lo enviemos otra vez.</div>');

  const { data, error } = await sb.rpc('ts_incident_public', { p_token: token });
  if (error) return shell(`<div class="err">${esc(error.message)}</div>`);

  document.title = `Pedido ${data.pedido} · TechStore SV`;

  if (data.respondido || data.estado === 'decidido') {
    return shell(`
      <div class="brand">TechStore SV</div>
      <h1>Ya tenemos tu respuesta</h1>
      <p>Registramos que elegiste <b>${esc(ACTION_TXT[data.decision] || data.decision || '')}</b> para
         <b>${esc(data.producto)}</b> de tu pedido <b>${esc(data.pedido)}</b>.</p>
      <p>Nos pondremos en contacto contigo por WhatsApp para coordinar. Gracias por tu paciencia.</p>
      <div class="note">Folio del aviso: ${esc(data.folio)}</div>`);
  }

  if (data.estado === 'resuelto') {
    return shell(`
      <div class="brand">TechStore SV</div>
      <h1>Todo resuelto</h1>
      <p>Este aviso ya fue atendido por nuestro equipo. Si tienes dudas, escríbenos por WhatsApp.</p>
      <div class="note">Folio: ${esc(data.folio)}</div>`);
  }

  if (data.estado === 'anulado') {
    return shell(`
      <div class="brand">TechStore SV</div>
      <h1>Este aviso fue anulado</h1>
      <p>No necesitas hacer nada. Tu pedido sigue su curso normal.</p>
      <div class="note">Folio: ${esc(data.folio)}</div>`);
  }

  const opciones = (data.opciones || [])
    .slice()
    .sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action));

  const nombres = String(data.cliente || '').split(' ')[0] || 'estimado cliente';

  shell(`
    <div class="brand">TechStore SV</div>
    <h1>Hola ${esc(nombres)}, tenemos que contarte algo de tu pedido</h1>
    <p>Antes de entregarte el pedido <b>${esc(data.pedido)}</b> notamos ${esc(SEV_TXT[data.severidad] || 'un detalle')}
       en uno de tus productos. Preferimos avisarte antes que entregártelo sin que lo sepas.</p>

    <div class="prod">
      <b>${esc(data.producto)}</b>
      <div style="color:#93a4c6;margin-top:.25rem">${esc(data.descripcion)}</div>
    </div>

    <p style="font-weight:600;color:#fff">¿Cómo quieres que lo resolvamos?</p>
    <div id="opts">
      ${opciones.map((o, idx) => `
        <button class="opt ${idx === 0 ? 'primary' : ''}" data-action="${esc(o.action)}">
          ${esc(o.label)}
          ${o.action === 'aceptar_averia' && o.discount_amount
            ? `<small>Equivale a ${money(o.discount_amount)} de descuento</small>` : ''}
          ${o.refund ? `<small>Te devolvemos ${money(o.refund)}</small>` : ''}
        </button>`).join('')}
    </div>
    <div class="note">
      Tienes hasta el <b>${new Date(data.expira).toLocaleString('es-SV', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}</b>
      para elegir. Si no respondes, te sustituimos el producto por uno nuevo (si hay disponible) o te devolvemos el dinero.
    </div>`);

  document.getElementById('opts').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    const label = b.innerText.split('\n')[0];
    if (!confirm(`¿Confirmas que quieres ${label.toLowerCase()}?`)) return;

    document.querySelectorAll('.opt').forEach((o) => { o.disabled = true; });
    b.innerHTML = 'Guardando…';

    const { error: err } = await sb.rpc('ts_incident_decide', { p_token: token, p_action: action });
    if (err) {
      b.innerHTML = 'No se pudo guardar';
      document.querySelectorAll('.opt').forEach((o) => { o.disabled = false; });
      return alert(err.message);
    }

    shell(`
      <div class="brand">TechStore SV</div>
      <h1>Gracias, ${esc(nombres)}</h1>
      <div class="cho ok">
        Elegiste <b>${esc(ACTION_TXT[action] || action)}</b>.<br>
        Ya lo registramos y te escribiremos por WhatsApp para coordinar.
      </div>
      <p style="margin-top:14px">Lamentamos el inconveniente. Gracias por darnos la oportunidad de resolverlo bien.</p>
      <div class="note">Folio del aviso: ${esc(data.folio)}</div>`);
  });
}

main().catch((e) => shell(`<div class="err">${esc(e.message)}</div>`));
