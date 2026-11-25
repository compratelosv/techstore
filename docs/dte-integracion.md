# Integración de Facturación Electrónica (DTE) — El Salvador

## Decisión de arquitectura

**No se implementa la firma ni la transmisión desde cero.** Se contrata un
**emisor autorizado** (proveedor de facturación electrónica) y el sistema solo
le envía la venta por API. El proveedor firma con el certificado, transmite al
Ministerio de Hacienda y devuelve el **sello de recepción** y la representación
gráfica.

```
POS / Tienda  ──►  Edge Function (dte-send)  ──►  Proveedor DTE  ──►  Ministerio de Hacienda
                        │                              │
                        └── ts_dte_log ◄───────────────┴── sello + PDF
                        └── ts_pos_docs.dte_status / dte_sello
```

Por qué así:

- La firma exige **certificado de firma electrónica** de un proveedor autorizado.
- El JSON debe cumplir el esquema del MH v2 con validaciones estrictas.
- Los cambios normativos los absorbe el proveedor, no nosotros.
- La `api_key` **nunca** vive en el frontend: va en la Edge Function.

## Flujo por venta

1. Se cobra y se crea el pedido (`ts_place_order`) y el documento (`ts_pos_issue_doc`).
2. Si `ts_fiscal_config.enabled` está activo, el documento nace con
   `dte_status = 'pendiente'`.
3. La Edge Function arma el JSON, lo envía al proveedor y espera respuesta.
4. Éxito: guarda `dte_sello`, `dte_status = 'transmitido'`, `dte_sent_at`.
5. Error del proveedor: `dte_status = 'rechazado'` + `dte_error`, y **el cobro no se revierte**:
   el dinero ya entró, el documento queda en cola para reintento.
6. Si el MH no responde: `contingencia`, con plazo máximo de **72 horas** para transmitir.

## Plazos que la norma impone

- Modalidad **normal**: transmitir **antes de entregar** al cliente.
- Modalidad **contingencia**: hasta **72 h** desde el sello del evento.
- El CCF debe referenciar la nota de remisión cuando exista.

## Datos que el sistema ya tiene

| Dato | Dónde |
|---|---|
| Serie y correlativo por tipo y año | `ts_doc_series` |
| Número de control `DTE-03-CCF1-000000000000001` | `ts_pos_docs.control_code` |
| Código de generación (UUID) | `ts_pos_docs.control_code` (se separa al integrar) |
| Receptor: NIT, NRC, nombre, dirección | `ts_pos_docs.receiver` |
| Desglose gravada / IVA / total | `ts_pos_docs.gravada/iva/total` |
| Forma de pago, voucher de tarjeta | `ts_pos_docs.payment_method/card_last4/card_auth` |
| Total en letras | `ts_pos_docs.total_letters` |

## Datos que faltan (los aporta el negocio)

1. **NIT** del negocio y **NRC**.
2. **Nombre legal** y nombre comercial.
3. **Actividad económica** y código **CAEB**.
4. **Dirección** del establecimiento (departamento, municipio, línea).
5. Teléfono y correo de facturación.
6. Si ya es **emisor electrónico** y con qué proveedor.
7. Certificado de firma electrónica vigente (o el trámite para obtenerlo).

Todo eso se guarda en `ts_fiscal_config`, que está creada y vacía a propósito:
**no se inventan datos fiscales**.

## Lo que falta construir

| Pieza | Estado |
|---|---|
| `ts_fiscal_config` (datos del emisor, proveedor, ambiente) | creada |
| Campos `dte_*` en `ts_pos_docs` y `ts_dte_log` | creados |
| Edge Function `dte-send` (adaptador del proveedor) | pendiente |
| Pantalla **Configuración → Facturación** | pendiente |
| Reintento y cola de contingencia | pendiente |
| Envío del PDF/sello al cliente por correo | pendiente (Gmail ya autorizado) |

## Aviso vigente en los documentos

Mientras `enabled = false`, todo comprobante sale marcado
**"DOCUMENTO DE CONTROL INTERNO — NO VÁLIDO FISCALMENTE"** y `fiscal_valid = false`.
Eso evita que un ticket se confunda con un DTE.
