# Estado del proyecto — TechStore SV

> Documento de traspaso. Si abrís una sesión nueva con el agente, **leé esto primero**.
> Última actualización: 2026-11-27

## Qué es

Tienda de tecnología en El Salvador (San Salvador / La Libertad) con panel de administración,
punto de venta, entregas propias y facturación. Entorno **de prueba**: los datos que hay
(productos, pedidos, clientes) son fixtures, **no** operación real.

## Infraestructura

| Servicio | Detalle |
|---|---|
| Supabase | proyecto **`techstore`**, ref `hnpjkaiylibjnrqgfiku`, región us-east-1 |
| Cuenta dueña | `compratelo.sv@gmail.com` (Owner). Queda `fractalconstructora` como Owner de respaldo |
| GitHub | org `compratelosv`, repo `techstore`, sitio en `https://compratelosv.github.io/techstore/` |
| Pagos | Wompi SV, **modo prueba** (comercio sin activar) |
| Base | 69 tablas: `ts_*` (TechStore) y `shop_*` (tienda vieja) |

### Credenciales (NUNCA en el repo)

Viven en `C:\Users\Diseño\AppData\Local\hermes\profiles\mysoftware\.env`:

- `SUPABASE_SERVICE_ROLE` (salta RLS; solo backend)
- `SUPABASE_ACCESS_TOKEN` (despliegue de Edge Functions)
- `WOMPI_APP_ID` / `WOMPI_API_SECRET` (OAuth de Wompi)
- `SUPABASE_DB_PASSWORD` — **incorrecta**, no usar; la vía válida es la service_role

## Pagos (Wompi SV) — implementado y probado

Autenticación: OAuth 2.0 client credentials en `https://id.wompi.sv/connect/token`
(`client_id` = App ID, `client_secret` = API Secret, `audience=wompi_api`).

### Edge Functions desplegadas

| Función | JWT | Qué hace |
|---|---|---|
| `wompi-create` | sí | Verifica dueño y estado del pedido, **recalcula el total** desde `ts_order_items`, crea el enlace (`POST /EnlacePago`) y lo registra en `ts_payments` |
| `wompi-webhook` | **no** | Valida header `wompi_hash` (HMAC-SHA256 del body crudo con el API Secret), ignora eventos que no sean `ExitosaAprobada`, evita duplicados y llama `ts_confirm_payment` |

### Frontend

`js/pagos-provider.js` centraliza el cobro. `MODO_PAGO = 'wompi' | 'simulado'`.
Ningún proveedor escribe el estado: la única puerta es `ts_confirm_payment`.

### `ts_confirm_payment`

Acepta tres casos (el resto se rechaza con 42501):
1. staff (`ts_is_staff()`)
2. dueño del pedido cuando `p_provider = 'simulado'`
3. `auth.role() = 'service_role'` cuando `p_provider = 'wompi'` ← agregado para el webhook

### Pruebas ejecutadas (2026-11-27)

- Payload falsificado al webhook → `401 hash inválido`
- Enlace real creado para pedido de $35 → `s.wompi.sv/2533051sDN`
- Webhook firmado → `200 pedido confirmado`; pedido → `pagado`, **stock descontado**, evento auditado
- Reintento idéntico → `200 duplicado` (idempotencia correcta)

### LÍMITES CONFIRMADOS DE WOMPI

- **Máximo $1,000 por enlace de pago.** Un pedido de $1,499 fue rechazado:
  *"El monto máximo por cada enlace o botón de pago es de $1000.00"*.
  Pendiente decidir: Transacción Compra directa / dividir pago / transferencia para montos altos.
- Si `permitirPagoEnCuotasAgricola = true`, hay que enviar `cantidadMaximaCuotas` (usamos `"Tres"`).
- Para cobrar de verdad falta: registrar cuenta de **Banco Agrícola** en Wompi ("Mis Cuentas Bancarias")
  y activar el comercio. Es el único requisito. Persona natural, no exige representante legal.

## Reglas de negocio implementadas

- **Cupones**: el servidor calcula el descuento desde `ts_products.price` (el navegador no puede inflarlo).
  Tope **20% por compra**. Bienvenida 10%, vence a los **30 días** (trigger `trg_promo_welcome_30d`).
  Un WhatsApp verificado = una cuenta.
- **Entregas**: miércoles y sábado, franjas 9:00–11:30 y 14:00–17:30, ruta Metrocentro → Plaza Merliot.
  Inasistencia: aviso 7:00 a.m., reagenda única, segunda falta = cancelación con cargo 20%.
- **Acta de entrega**: nombre de quien recibe, DUI, foto, **firma en canvas**, conformidad.
  Se guarda en `ts_delivery_proofs` + bucket privado `ts_entregas`. Si el pedido no pasa a
  entregado, el acta se revierte.
- **Escaneo de bultos**: el botón "Entregado" se bloquea hasta completar el escaneo.
  El escaneo se habilita **por usuario** con `ts_profiles.scan_delivery`.
- **Roles**: `admin`, `community_manager`, `cajero`, `transportista`, `cliente`.
  Cajero solo ve POS, Caja y Clientes. Transportista solo "Mis entregas".
- **Borrado de cuentas**: exige correo exacto, motivo (≥5) y contraseña del admin;
  queda en `ts_admin_audit`.

## Acceso del personal

`staff.html` — página aparte, sin enlaces públicos, `noindex`, sin registro.
Redirige según rol: transportista → `#entregas`, cajero → `#pos`, admin → panel.
Una cuenta de cliente recibe *"Esta cuenta no tiene acceso al panel"* y se le cierra la sesión.

## Cómo desplegar

```bash
# frontend (GitHub Pages)
python tools/stamp_assets.py          # versiona los assets
git add -A && git commit -m "..." && git push

# Edge Functions
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' "$ENVF" | cut -d= -f2-)
supabase functions deploy wompi-create wompi-webhook --remote=hnpjkaiylibjnrqgfiku --yes
# el webhook SIEMPRE con --no-verify-jwt
supabase functions deploy wompi-webhook --remote=hnpjkaiylibjnrqgfiku --no-verify-jwt --yes

# secretos
supabase secrets set --env-file <archivo> --remote=hnpjkaiylibjnrqgfiku --yes
```

Notas del entorno: el CLI no necesita Docker para desplegar; en modo agente exige `--yes`.
Los archivos temporales para `node` deben ir en ruta nativa (`C:/...`), no en `/tmp`.

## Respaldo

- Datos: `C:\mysoftware\backups\techstore_2026-11-25\` — 69 tablas, 740 filas, exportadas por PostgREST
  con la service_role.
- **Falta el esquema** (DDL de tablas, funciones, triggers y políticas). Sin él, restaurar es incompleto.

## Pendientes

1. Registrar cuenta bancaria en Wompi y activar el comercio (bloquea cobrar de verdad).
2. Decidir cómo cobrar montos > $1,000.
3. Backup del **esquema** en `.sql`.
4. Purga reproducible de los datos de prueba antes de abrir.
5. Visor + PDF del acta de entrega.
6. Módulo de Finanzas (margen por producto) y conciliación de pagos.
7. Plantilla de correo de confirmación en español.
8. Dominio propio (hoy `compratelosv.github.io/techstore`).
9. Decidir identidad: "TechStore · tecnología" vs catálogo multirubro.
10. `🐴` en el `<title>` de todas las páginas (lo inyecta `js/core.js`).
