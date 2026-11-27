/* pagos-provider.js — capa de cobro intercambiable.
 *
 * Todo el sitio cobra a través de `cobrarPedido`. Cambiar de pago simulado a
 * Wompi (o a efectivo, o a otro proveedor) es cambiar MODO_PAGO y completar
 * la rama correspondiente: ni pago.js, ni checkout.js, ni la base se tocan.
 *
 * Regla que no se rompe: la ÚNICA puerta que descuenta stock y marca el pedido
 * como pagado es la RPC ts_confirm_payment(p_order_id, p_provider, p_reference).
 * Ningún proveedor escribe el estado por su cuenta.
 */

export const MODO_PAGO = 'simulado'; // 'simulado' | 'wompi'

/* ---------- contrato público ---------- */

/**
 * Inicia el cobro de un pedido.
 * @returns {{tipo:'redirigir', url:string} | {tipo:'confirmado', order:any} | {tipo:'error', mensaje:string}}
 */
export async function cobrarPedido(sb, order) {
  if (MODO_PAGO === 'wompi') return cobrarConWompi(sb, order);
  return cobrarSimulado(sb, order);
}

/** ¿Este modo necesita volver de una pasarela externa? */
export function requiereRedireccion() {
  return MODO_PAGO === 'wompi';
}

/* ---------- modo simulado (actual) ---------- */

async function cobrarSimulado(sb, order) {
  const { data, error } = await sb.rpc('ts_confirm_payment', {
    p_order_id: order.id,
    p_provider: 'simulado',
    p_reference: `SIM-${Date.now()}`,
  });
  if (error) return { tipo: 'error', mensaje: error.message };
  return { tipo: 'confirmado', order: data };
}

/* ---------- modo Wompi (pendiente de activar) ----------
 *
 * Para encenderlo hace falta:
 *   1. Edge Function `wompi-create`:
 *        - recibe order_id, verifica la sesión del cliente
 *        - RECALCULA el total leyendo ts_orders (nunca confía en el navegador)
 *        - firma con el secreto de integridad (guardado en Supabase Secrets,
 *          jamás en este repositorio público)
 *        - devuelve la URL del enlace de pago
 *   2. Edge Function `wompi-webhook`:
 *        - valida la firma del evento que envía Wompi
 *        - exige idempotencia por id de transacción (evita doble confirmación)
 *        - llama ts_confirm_payment(..., 'wompi', referencia)
 *   3. Registrar la cuenta de Banco Agrícola en Wompi y activar el comercio.
 *
 * Nada de lo anterior requiere cambiar este contrato ni el resto del sitio.
 */
async function cobrarConWompi(sb, order) {
  try {
    const base = window.TS_CONFIG?.SUPABASE_URL;
    const { data: ses } = await sb.auth.getSession();
    const token = ses?.session?.access_token;
    if (!base || !token) return { tipo: 'error', mensaje: 'Sesión no disponible' };

    const res = await fetch(`${base}/functions/v1/wompi-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ order_id: order.id }),
    });
    if (!res.ok) return { tipo: 'error', mensaje: 'No se pudo iniciar el pago' };
    const { url } = await res.json();
    if (!url) return { tipo: 'error', mensaje: 'Respuesta de pago inválida' };
    return { tipo: 'redirigir', url };
  } catch (e) {
    return { tipo: 'error', mensaje: e.message || 'Error de conexión' };
  }
}
