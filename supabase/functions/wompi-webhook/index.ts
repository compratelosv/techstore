// supabase/functions/wompi-webhook/index.ts
// Recibe el aviso de pago de Wompi SV, lo valida y confirma el pedido.
//
// Validación: header `wompi_hash` = HMAC-SHA256 del body CRUDO con el API Secret.
// Idempotencia: el propio estado del pedido (si ya no está pendiente_pago, se ignora).
// La única puerta que descuenta stock sigue siendo ts_confirm_payment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*" };
const txt = (s: string, code = 200) => new Response(s, { status: code, headers: CORS });

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return txt("método no permitido", 405);

  // 1 · Se lee el body tal cual llega: cualquier re-serialización rompe el hash.
  const raw = await req.text();
  const recibido = (req.headers.get("wompi_hash") ?? "").trim().toLowerCase();
  const secret = Deno.env.get("WOMPI_API_SECRET");
  if (!secret) return txt("configuración incompleta", 500);

  const esperado = await hmacHex(raw, secret);
  if (!recibido || recibido !== esperado) return txt("hash inválido", 401);

  // 2 · Evento válido: solo interesa el pago aprobado.
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return txt("json inválido", 400);
  }

  if (evt?.ResultadoTransaccion !== "ExitosaAprobada") {
    return txt("evento ignorado: " + (evt?.ResultadoTransaccion ?? "sin resultado"));
  }

  const codigo = evt?.EnlacePago?.IdentificadorEnlaceComercio;
  const idTx = evt?.IdTransaccion;
  if (!codigo || !idTx) return txt("evento sin identificadores", 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 3 · Idempotencia: si Wompi reintenta, no se confirma dos veces.
  const { data: pago } = await sb
    .from("ts_payments")
    .select("id")
    .eq("reference", String(idTx))
    .maybeSingle();
  if (pago) return txt("duplicado: ya registrado");

  const { data: order } = await sb
    .from("ts_orders")
    .select("id, code, status, total")
    .eq("code", codigo)
    .maybeSingle();
  if (!order) return txt("pedido no encontrado: " + codigo, 404);
  if (order.status !== "pendiente_pago") return txt("pedido ya procesado: " + order.status);

  // 4 · Monto del evento vs monto del pedido (defensa extra).
  const montoEvento = Number(evt?.Monto ?? 0);
  if (montoEvento > 0 && Math.abs(montoEvento - Number(order.total)) > 0.01) {
    return txt(`monto no coincide: evento ${montoEvento} vs pedido ${order.total}`, 409);
  }

  const { error } = await sb.rpc("ts_confirm_payment", {
    p_order_id: order.id,
    p_provider: "wompi",
    p_reference: String(idTx),
  });
  if (error) return txt("error al confirmar: " + error.message, 500);

  return txt("ok: pedido " + order.code + " confirmado");
});
