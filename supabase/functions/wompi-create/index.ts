// supabase/functions/wompi-create/index.ts
// Crea un enlace de pago de Wompi SV para un pedido, recalculando el monto en el servidor.
// Secrets requeridos: WOMPI_APP_ID, WOMPI_API_SECRET, SITE_URL (opcional), WOMPI_NOTIFY_EMAIL (opcional)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function wompiToken(): Promise<string> {
  const r = await fetch("https://id.wompi.sv/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      audience: "wompi_api",
      client_id: Deno.env.get("WOMPI_APP_ID")!,
      client_secret: Deno.env.get("WOMPI_API_SECRET")!,
    }),
  });
  if (!r.ok) throw new Error("No se pudo autenticar con Wompi");
  const j = await r.json();
  return j.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!user) return json({ error: "no autenticado" }, 401);

    const { order_id } = await req.json();
    if (!order_id) return json({ error: "falta order_id" }, 400);

    const { data: order } = await sb.from("ts_orders").select("*").eq("id", order_id).maybeSingle();
    if (!order) return json({ error: "pedido no encontrado" }, 404);
    if (order.user_id !== user.id) return json({ error: "no autorizado" }, 403);
    if (order.status !== "pendiente_pago") return json({ error: "el pedido ya no está pendiente de pago" }, 409);

    // El monto se recalcula aquí: nunca se confía en lo que manda el navegador.
    const { data: items } = await sb.from("ts_order_items").select("line_total").eq("order_id", order.id);
    const suma = (items ?? []).reduce((a, i) => a + Number(i.line_total ?? 0), 0);
    const envio = order.fulfillment === "retiro" ? 0 : Number(order.shipping_cost ?? 0);
    const descuento = Number(order.discount ?? 0);
    const total = Math.round((suma + envio - descuento) * 100) / 100;

    if (Math.abs(total - Number(order.total)) > 0.01) {
      return json({ error: "el total del pedido no coincide con sus líneas" }, 409);
    }
    if (total < 0.01) return json({ error: "monto inválido" }, 400);

    const token = await wompiToken();
    const site = Deno.env.get("SITE_URL") ?? "https://compratelosv.github.io/techstore";
    const notify = Deno.env.get("WOMPI_NOTIFY_EMAIL");

    const cuerpo = {
      identificadorEnlaceComercio: order.code,
      monto: total,
      nombreProducto: `Pedido ${order.code} · TechStore SV`,
      infoProducto: { descripcionProducto: `Pedido ${order.code}` },
      formaPago: {
        permitirTarjetaCreditoDebido: true,
        permitirPagoConPuntoAgricola: true,
        permitirPagoEnCuotasAgricola: true,
      },
      cantidadMaximaCuotas: "Tres",
      configuracion: {
        urlRedirect: `${site}/pago.html?order=${order.id}`,
        urlWebhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/wompi-webhook`,
        ...(notify ? { emailsNotificacion: notify } : {}),
      },
    };

    const r = await fetch("https://api.wompi.sv/EnlacePago", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const txt = await r.text();
    if (!r.ok) return json({ error: "Wompi rechazó el enlace", detalle: txt.slice(0, 400) }, 502);
    const link = JSON.parse(txt);

    await sb.from("ts_payments").insert({
      order_id: order.id,
      provider: "wompi",
      status: "pendiente",
      amount: total,
      reference: String(link.idEnlace ?? order.code),
      raw: { ...link, esProductivo: link.estaProductivo },
    });

    return json({
      url: link.urlEnlace,
      qr: link.urlQrCodeEnlace,
      productivo: link.estaProductivo === true,
      monto: total,
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? "error inesperado" }, 500);
  }
});
