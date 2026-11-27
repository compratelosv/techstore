/* fiscal.js — configuración fiscal y estado de facturación electrónica */
import { sb, esc, toast, errMessage } from './core.js?v=828d81de';

const $ = (s) => document.querySelector(s);
let cfg = null;

export function initFiscal() {
  const form = document.getElementById('fiscalForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
}

export async function loadFiscal() {
  const { data, error } = await sb.from('ts_fiscal_config').select('*').eq('id', 1).maybeSingle();
  if (error) return toast(errMessage(error), 'err');
  cfg = data || {};
  renderFiscal();
}

function val(id) {
  return (document.getElementById(id)?.value || '').trim();
}

function renderFiscal() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? '';
  };
  set('fLegalName', cfg.legal_name);
  set('fTradeName', cfg.trade_name);
  set('fNit', cfg.nit);
  set('fNrc', cfg.nrc);
  set('fActivity', cfg.economic_activity);
  set('fCaeb', cfg.caeb_code);
  set('fDept', cfg.address_department);
  set('fMuni', cfg.address_municipality);
  set('fLine', cfg.address_line);
  set('fPhone', cfg.phone);
  set('fEmail', cfg.email);
  set('fProvider', cfg.dte_provider || '');
  set('fEnv', cfg.dte_environment || 'pruebas');

  const on = document.getElementById('fEnabled');
  if (on) on.checked = !!cfg.enabled;

  const st = document.getElementById('fiscalState');
  const completo = !!(cfg.nit && cfg.nrc && cfg.legal_name && cfg.address_line);
  if (st) {
    st.innerHTML = cfg.is_demo
      ? '<span class="badge pendiente">Datos de prueba · no emitir</span>'
      : cfg.enabled
      ? '<span class="badge entregado">Facturación electrónica activa</span>'
      : completo
      ? '<span class="badge pendiente">Datos cargados · emisión desactivada</span>'
      : '<span class="badge cancelado">Faltan datos fiscales</span>';
  }

  const warn = document.getElementById('fiscalWarn');
  if (warn) {
    // el aviso permanece mientras los datos sean de prueba, aunque la emisión esté activa
    warn.hidden = !!cfg.enabled && !cfg.is_demo;
    if (cfg.is_demo) {
      warn.innerHTML = '<p class="small" style="margin:0;color:#fca5a5"><b>Datos fiscales de prueba.</b> ' +
        'Mientras no cargues tu NIT y NRC reales, ningún documento puede tomarse como válido ante Hacienda.</p>';
    }
  }
}

async function save() {
  const payload = {
    legal_name: val('fLegalName'),
    trade_name: val('fTradeName'),
    nit: val('fNit'),
    nrc: val('fNrc'),
    economic_activity: val('fActivity'),
    caeb_code: val('fCaeb'),
    address_department: val('fDept'),
    address_municipality: val('fMuni'),
    address_line: val('fLine'),
    phone: val('fPhone'),
    email: val('fEmail'),
    dte_provider: val('fProvider') || null,
    dte_environment: val('fEnv') || 'pruebas',
    enabled: !!document.getElementById('fEnabled')?.checked,
    updated_at: new Date().toISOString(),
  };

  if (!payload.nit) return toast('Falta el NIT del negocio', 'err');
  if (!/^\d{4}-\d{6}-\d{3}-\d{1}$/.test(payload.nit)) {
    return toast('El NIT debe verse así: 0614-123456-101-1', 'err');
  }
  if (!payload.legal_name) return toast('Falta la razón social', 'err');

  // activar la emisión exige proveedor y ambiente: sin eso el documento no se puede transmitir
  if (payload.enabled && !payload.dte_provider) {
    return toast('Para activar la emisión primero elegí el proveedor de facturación', 'err');
  }

  const btn = document.getElementById('fSave');
  if (btn) btn.disabled = true;
  const { error } = await sb.from('ts_fiscal_config').update(payload).eq('id', 1);
  if (btn) btn.disabled = false;
  if (error) return toast(errMessage(error), 'err');

  toast('Datos fiscales guardados');
  await loadFiscal();
}
