# TechStore SV — tienda, punto de venta y preparación de pedidos

Sistema completo de comercio electrónico con **catálogo público**, **carrito y checkout**, **panel de preparación con etiquetas imprimibles** y **punto de venta presencial**. Base de datos en Supabase (PostgreSQL + Auth + RLS), frontend estático sin build.

Catálogo de demostración: **24 productos de tecnología inventados**.

- **Tienda:** https://compratelosv.github.io/techstore/
- **Panel:** https://compratelosv.github.io/techstore/admin.html
- Repo: `compratelosv/techstore` · Supabase: `hnpjkaiylibjnrqgfiku`

## Cuentas de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@techstore.test` | entregada aparte |
| Agente de ventas | `agente@techstore.test` | entregada aparte |
| Vendedor de mostrador | `vendedor@techstore.test` | entregada aparte |
| Cliente | `cliente@techstore.test` | entregada aparte |

Son cuentas de sandbox con correo ya confirmado. **Las contraseñas no se guardan en el repositorio** (es público): se gestionan desde el panel, en *Usuarios → Contraseña*, que genera una nueva y la muestra una sola vez. Antes de abrir la tienda al público hay que cambiar todas.

## Funcionalidad

### Tienda
- Home con hero, buscador y filtros por categoría.
- Ficha de producto con stock real, selector de cantidad y especificaciones.
- Carrito persistente en el dispositivo, con validación de stock en vivo.
- Checkout con dos modalidades: **envío por zona** (costo por zona, gratis desde un monto) o **retiro en tienda** (sin costo).
- Cuenta del cliente: registro, ingreso, datos de contacto e historial de pedidos con acceso a pagar los pendientes.
- Pago **simulado** (ver más abajo).

### Panel del personal
- **Pedidos:** KPIs (cobrado, activos, por preparar, listos), filtros por estado, búsqueda y detalle con historial de eventos.
- **Preparación:** tablero de tres columnas — por embalar, en preparación y listos — con los SKU y cantidades a empacar.
- **Etiqueta imprimible:** botón por pedido que abre una etiqueta de 100 × 70 mm con **QR del código de pedido**, cliente, destino y SKUs. Imprime en hoja normal o térmica.
- **Punto de venta tipo caja de supermercado:** se escanea el código de barras con la **cámara del teléfono** y cada lectura suma una unidad al ticket. Muestra cantidades y subtotales en vivo, permite ajustar con ±, y cobra con `ts_place_order` + `ts_confirm_payment` (canal `pos`). También acepta código escrito a mano, lector USB y lectura desde una foto.
- **Etiquetas de anaquel:** cada producto tiene un **EAN-13 válido** (prefijo 200, uso interno) imprimible desde Inventario → *Etiqueta*, listo para escanear en el POS.
- **Alta escaneando:** en el formulario de producto se escanea el código real con la cámara (o desde una foto); el campo se llena solo, se valida el dígito verificador, se detecta si ya existe (abre ese producto en lugar de duplicarlo) y se consultan bases públicas para sugerir nombre y marca.
- **SKU automático:** al escanear se arma como `CAT-MARCA-NNN` — abreviatura de categoría, 3 letras de la marca y un número derivado de los dígitos del código de barras, corrido hasta encontrar uno libre. Determinista (mismo producto y código ⇒ mismo SKU) y editable a mano; el botón ⟳ lo regenera.
- **Inventario:** stock por SKU, alertas de stock bajo y agotados, ajuste manual con motivo y bitácora de movimientos.
- **Panel de ventas:** ingresos, pedidos, ticket promedio, unidades y **margen bruto** del periodo, con comparación contra el periodo anterior; gráfico de ventas por día; productos más vendidos; desglose por canal (tienda vs POS) y por forma de pago; exportación a CSV. Todo se calcula **en la base** (`ts_sales_summary`), no sumando en el navegador, y solo lo puede pedir el personal.
- **Usuarios y roles** (solo administrador): alta de miembros del equipo con contraseña temporal generada, cambio de rol, activación/desactivación de la cuenta (banea el login en Auth) y restablecimiento de contraseña. Roles: `admin` (todo), `operador` (pedidos, preparación, POS, cotizaciones, clientes, ventas, inventario), `transportista` (solo sus entregas) y `cliente` (solo compra).
- **Cotizaciones** (admin y operador): folio automático `COT-000001`, cliente, validez, descuento %, impuesto, notas; vista imprimible para enviar al cliente y conversión a pedido pendiente de pago con los precios cotizados.
- **Configuración** (solo administrador): moneda (código, símbolo, decimales, formato regional), datos del negocio para documentos (razón social, NIT, teléfono, WhatsApp, dirección), impuesto y validez de cotizaciones, y **cuentas bancarias** donde se recibe el dinero.
- **Clientes** (admin y operador): consolidado por cuenta con pedidos, gasto acumulado, ticket promedio, última compra y búsqueda por nombre/correo/teléfono. Ficha con historial completo, direcciones y **notas internas** del equipo.
- **Proveedores y compras** (solo administrador, porque muestra costos): catálogo de proveedores con contacto y NIT; registro de compras **pendientes** que, al recibirlas, suman stock, dejan movimiento de inventario `entrada` y actualizan el costo del producto (base del margen).
- **Reparto a domicilio** (transportista): se le asigna un pedido desde Preparación; en su panel ve solo **sus** entregas **del día** (más pestañas de pendientes de días anteriores e historial) con dirección, teléfono, bultos e importe, avisa "salir a ruta" y confirma la entrega. Su cuenta no tiene acceso a pedidos ajenos, inventario, costos, ventas, clientes ni configuración.
- **Escaneo de bultos en la entrega**: el transportista escanea con la cámara del teléfono la etiqueta de cada producto (SKU o código de barras) o la etiqueta del pedido, y el sistema lleva la cuenta `1/2`. **No puede marcar "Entregado" hasta escanear todos los bultos**, y cada lectura queda registrada con fecha y usuario. El permiso se puede apagar por usuario desde Usuarios → columna "Escaneo".
- **Caja por turno** (admin y operador): apertura con fondo inicial, ventas en efectivo del turno, ingresos/egresos/retiros, **arqueo por denominación** al cerrar y diferencia (sobrante o faltante). Sin caja abierta el POS no puede cobrar.
- **Promociones y cupones** (admin): cupones por código con porcentaje o monto fijo, compra mínima, vigencia, tope de usos, alcance (todo el catálogo o **productos elegidos**) y restricción a clientes nuevos. **Todo cliente nuevo recibe automáticamente un cupón de bienvenida del 10%** (90 días, primera compra). El cupón se valida en el servidor y se quema solo al confirmarse el pago.
- **WhatsApp verificado (obligatorio para comprar)**: el cliente pide un código de 6 dígitos, lo confirma y queda marcado como verificado. Si cambia el teléfono, vuelve a quedar sin verificar. **Modo demo**: el código se muestra en pantalla; en producción se envía por WhatsApp Business.
- **Entregas en puntos fijos con cita**: Metrocentro 8ª etapa y Plaza Merliot (food court), **miércoles y sábado**, franjas de 30 minutos (9:00–11:30 y 14:00–17:00) con **un cliente por franja**. El checkout reserva la franja en la misma transacción del pedido.
- **Confirmación, inasistencia y reagenda**: aviso por WhatsApp a las 7:00 a.m. del día de entrega con enlace para confirmar (`cita.html?t=token`). Si no llega, el staff marca **"No se presentó"** y el cliente puede **reagendar una vez**; a la segunda inasistencia el pedido se cancela con **retención del 20%**.
- **Términos y privacidad**: `terminos.html` y `privacidad.html`. La compra **exige aceptar** los términos (se guarda `terms_accepted_at` en el pedido) y el servidor rechaza pedidos sin aceptación.
- **Redes sociales y APIs** (admin → Configuración → **Redes y APIs**): Instagram, Facebook, TikTok y WhatsApp Business con usuario, enlace, interruptor **"Mostrar en la tienda"** y campos de App ID / Client Secret. Los que estén visibles y tengan enlace **aparecen en el pie de la tienda** (`mountSocial()` en `core.js`, solo URLs `http(s)`). Los secretos se guardan en `ts_secrets` vía `ts_save_secret` y no se leen nunca de vuelta al navegador.
- **Calendario de entregas** (admin): vista de **mes y semana** estilo Google con los miércoles y sábados resaltados, chips por entrega y franjas libres. Incluye **Plan del día** (veredicto "ve / no vayas" por jornada según confirmaciones), enlace **"Añadir a Google Calendar"** por entrega y **exportación `.ics`** de todo el rango.
- **Regla del primero que agenda**: el primer cliente que reserva una jornada (miércoles/sábado, mañana o tarde) **fija el punto** de esa jornada; a los demás solo se les ofrece ese punto, para no hacer dos desplazamientos.
- **Ruta ordenada**: la agenda ordena las paradas con **Metrocentro primero** y **Plaza Merliot después** (por `ts_pickup_points.sort`), y avisa si hay que desplazarse a dos puntos.
- **Tema claro / oscuro**: Configuración → **Apariencia** permite poner la **tienda** y el **panel** en claro u oscuro por separado, con vista previa y botón de restablecer. Se guarda en `ts_settings` (clave `theme`, lectura pública) y se aplica a todo el sitio vía `data-theme` en `<html>`. Ambos CSS exponen variables (`--bg`, `--card`, `--bg-2`, `--ink`/`--txt`, `--accent`, `--line`, `--on-accent`), así que cambiar la paleta no exige tocar componentes.
- **Fotos de producto**: en Inventario → **Editar** hay sección **Fotos**: botón *Agregar fotos* (JPG/PNG/WebP/AVIF, máx. 5 MB, hasta 6 por producto), miniaturas con **Portada** (la primera) y borrado individual. Se suben al bucket público **`ts-productos`** de Supabase Storage (`<sku>/<timestamp>-<rand>.<ext>`) y se guardan en `ts_products.images` (array); `image_url` replica la portada, de modo que catálogo y ficha la toman sin cambios. En la ficha del cliente las fotos extra aparecen como **miniaturas** que cambian la imagen principal. Subida/borrado permitidos solo a `ts_is_staff()` (admin y operador); lectura pública.
- **Pedidos**: tabla con **orden por columna** (clic en Código, Cliente, Entrega, Total, Estado o Creado; segundo clic invierte, ▲▼ en el encabezado) y **filtros combinados**: pestañas por estado, búsqueda, canal (en línea/mostrador), tipo de entrega y rango de fechas, con contador "X de Y" y botón Limpiar.
- **Panel deslizante (fichas)**: se abre sobre una cortina oscura, **se cierra al tocar fuera** o con `Esc`, ocupa el **alto real del dispositivo** (`100dvh`) por encima de la barra del panel y su contenido **hace scroll interno**, así no se pierde bajo el menú. Aplica a fichas de pedido, producto y piezas de marketing (`openDrawerUI`/`closeDrawerUI` en `core.js`).
- **Marketing** (rol `community_manager` o admin): módulo **Crecimiento** con cuatro vistas: **Marketing** (redes del negocio con audiencia, estado de API y publicaciones por red; semana en curso y alerta de inactividad), **Calendario editorial** (mes con chips por pieza y estado), **Contenido** (biblioteca con filtros, editor con ganchos, hashtags y **generador de piezas 1080×1080** en canvas con plantillas *precio / nuevo / oferta / solo foto / texto*, descarga PNG y subida a Storage) y **Métricas** (registro manual de alcance, interacciones y clics, con comparativa por tipo y por red). La publicación es **asistida**: se copia el texto, se abre la app y se marca como publicada con su enlace. Los campos de API quedan preparados para conectar Meta/TikTok cuando existan credenciales. Tablas: `ts_content`, `ts_content_metrics`, `ts_social_stats`, `ts_campaigns`, `ts_content_ideas`.
- **Portada con producto destacado**: el hero muestra una tarjeta con el producto de **mayor precio con stock** (imagen, marca, nombre, precio y enlace), más contador real de catálogo y datos de entrega. Se rellena en `renderHero()` desde `storefront.js`; si no hay productos, la tarjeta queda oculta.

## Seguridad de las credenciales de integración

Los secretos **no** se guardan en `ts_settings` ni en tablas legibles por el navegador:

- Viven en `ts_secrets`, una tabla con RLS activo y **sin políticas** (0 filas por API, ni siquiera con sesión).
- Solo se escriben y consultan por funciones `security definer` que exigen rol admin, y **nunca devuelven el valor**, solo si está configurado.
- La UI muestra `••••••••` y un aviso "guardado ✓"; no hay forma de leer el secreto desde el frontend.
- Recomendación para producción: mover esos valores a **Supabase Vault** o a variables de entorno de una **Edge Function**, y llamar a las APIs externas desde el servidor (nunca desde el navegador), con tokens de corta duración.

## Cómo funciona la cita

```
checkout → elige punto + franja (se reserva al crear el pedido)
   ↓
7:00 a.m. del día → mensaje con enlace de confirmación
   ↓
confirma → llega → entregado      no llega → no_show
                                        ↓
                              reagendar (1 vez) → nueva franja
                                        ↓
                              segunda inasistencia → cancelado, retención 20%
```

## Cómo funciona la caja

```
abrir (fondo) → vender en POS → ingresos / egresos / retiros → cerrar (arqueo) → diferencia
```

- Cada venta del POS queda atada a la **caja abierta de quien cobra** (`ts_orders.cash_session_id`).
- Solo hay **una caja abierta por usuario** (índice único parcial).
- Lo esperado en el cajón = `fondo + ventas en efectivo + ingresos − egresos − retiros`. Los pagos con tarjeta o transferencia **no** suman al efectivo.
- El cierre guarda el **conteo por denominación** (de $100 a 1¢) y la diferencia; queda en el historial con el nombre de quién abrió el turno.
- El cobro exige caja abierta **en el servidor**, no solo en la pantalla: una llamada directa a `ts_confirm_payment` para un pedido POS sin turno devuelve error y el pedido sigue pendiente.

## Flujo de reparto

```
listo --(staff asigna)--> [transportista] --> en_ruta --> entregado
```

Cada paso deja registro en `ts_order_events` con el usuario que lo hizo. El transportista usa funciones propias (`ts_courier_orders`, `ts_courier_set_status`) que validan que el pedido sea suyo; no puede usar el cambio de estado del personal.

## Clientes y pedidos de mostrador

Un pedido del POS **no pertenece a ninguna cuenta**: el cajero queda en `created_by`, no en `user_id`. Así el vendedor no aparece como cliente en su propio historial ni en el listado de clientes. El panel de Clientes solo muestra pedidos del canal `online` hechos por cuentas con rol `cliente`.

## Límite conocido de la moneda

Cambiar la moneda ajusta **símbolo, decimales y formato**, no convierte los importes: los precios guardados son los mismos números. Para operar en dos monedas reales hace falta una tabla de tipos de cambio y decidir en qué moneda se registra cada pedido.

## Flujo del pedido

```
pendiente_pago → pagado → en_preparacion → listo → entregado
        ↓            ↓            ↓            ↓
     cancelado   cancelado    cancelado    cancelado
                     ↓            ↓            ↓
                reembolsado  reembolsado  reembolsado
```

Reglas garantizadas **en la base de datos**, no en la interfaz:

- El pedido nace `pendiente_pago`. Solo `ts_confirm_payment` lo pasa a `pagado`, y es la única función que descuenta stock (con `stock >= qty` en el propio `UPDATE`).
- La confirmación es **idempotente**: un segundo clic devuelve el pedido sin duplicar cobros ni movimientos.
- Las transiciones inválidas se rechazan en el servidor (`Transicion no permitida: entregado -> en_preparacion`).
- Cancelar o reembolsar un pedido ya cobrado **devuelve el inventario** con un movimiento de tipo `cancelacion`.
- POS y tienda usan las mismas funciones: un solo camino para descontar stock.

## Arquitectura

```
index.html / producto.html / carrito.html / checkout.html / pago.html / cuenta.html
admin.html / sticker.html
css/tienda.css   css/admin.css
js/config.js     URL y clave pública (anon) de Supabase
js/core.js       cliente, utilidades, cabecera, sesión
js/cart.js       carrito local (solo product_id + qty)
js/storefront.js catálogo · js/product.js ficha · js/cart-page.js carrito
js/checkout.js   creación del pedido · js/pago.js cobro simulado
js/account.js    registro e historial · js/admin.js panel · js/pos.js punto de venta
js/sticker.js    etiqueta imprimible
db/001..006      esquema, funciones, RLS y seed (migraciones aplicadas)
tools/make_images.py  genera las imágenes SVG del catálogo
serve.mjs        servidor estático para pruebas locales
```

Sin bundler ni framework: módulos ES nativos y Supabase JS vendorizado en `vendor/`.

### Base de datos

Tablas con prefijo `ts_` para convivir con las tablas `shop_*` de la otra tienda del mismo proyecto:

| Tabla | Contenido |
|---|---|
| `ts_profiles` | Perfil por usuario (rol `cliente` / `operador` / `admin`) |
| `ts_categories`, `ts_products` | Catálogo, stock y precios |
| `ts_shipping_zones` | Zonas con costo y umbral de envío gratis |
| `ts_addresses` | Direcciones del cliente |
| `ts_orders`, `ts_order_items` | Pedidos y su detalle con precios congelados al vender |
| `ts_payments` | Cobros (proveedor, estado, referencia) |
| `ts_inventory_movements` | Bitácora de entradas, ventas, ajustes y devoluciones |
| `ts_order_events` | Auditoría de cambios de estado |

**RLS activo en todas.** Reglas principales:

- Catálogo: lectura pública solo de productos activos.
- Pedidos: el cliente ve los suyos; el personal ve todos. Nadie edita pedidos desde el cliente.
- `ts_profiles`: cada quien ve el suyo; el rol **no** se puede cambiar desde el cliente (permiso por columna).
- Movimientos de inventario: solo personal.

## Pagos

Hoy **simulado**. El pedido se confirma con `ts_confirm_payment(order_id, 'simulado', ref)`, que es exactamente el punto donde debe entrar el webhook de una pasarela real.

Para conectar Wompi:
1. Guardar las llaves de prueba en el `.env` del perfil (nunca en el repositorio ni en el chat).
2. Crear una Edge Function que valide la firma del webhook.
3. Llamar `ts_confirm_payment(order_id, 'wompi', transaction_id)` desde esa función con la clave de servicio.
4. La pantalla `pago.html` se sustituye por el checkout del proveedor; nada más cambia.

## Ejecutar en local

```bash
node serve.mjs 5180     # http://localhost:5180
python tools/make_images.py   # regenerar las imágenes del catálogo
```

## Verificación ejecutada (2026-11-24)

Todo comprobado sobre el proyecto real de Supabase y en el navegador:

| Prueba | Resultado |
|---|---|
| Catálogo público sin sesión | 24 productos, 6 categorías, imágenes cargando ✅ |
| Login de cliente | sesión activa, historial visible ✅ |
| Carrito | 3 unidades, $367.00, sin saldo negativo ✅ |
| Checkout con envío (subtotal > umbral) | envío $0 automático, total $367.00 ✅ |
| Creación de pedido | `TEC-001000` en `pendiente_pago`, 2 líneas, 3 unidades ✅ |
| Pago simulado | pasa a `pagado`, `paid_at` marcado, 1 pago registrado ✅ |
| Descuento de stock | STO-603 9→8, STO-604 15→13 ✅ |
| Idempotencia del pago | segunda llamada: stock igual, 1 solo pago ✅ |
| Cliente intentando entrar al panel | rechazado, sesión cerrada, aviso explícito ✅ |
| RLS entre usuarios | el cliente ve solo su pedido; movimientos de inventario bloqueados ✅ |
| Transiciones inválidas | `entregado → en_preparacion` y `pagado → entregado` rechazadas por el servidor ✅ |
| Flujo completo de preparación | pagado → en_preparacion → listo → entregado, con 5 eventos de auditoría ✅ |
| Etiqueta imprimible | QR generado y **decodificado con ZXing como `TEC-001000`** ✅ |
| Punto de venta | venta `TEC-001001`, canal `pos`, pagada, $223.00 ✅ |
| Cancelación de venta cobrada | stock devuelto: AUD-303 54→55, STO-604 11→13, movimientos `cancelacion` ✅ |
| **Producción** (`compratelosv.github.io/techstore`) | catálogo con 24 productos e imágenes ✅ · login de cliente con historial ✅ · ficha + carrito ✅ |
| Envío con costo en producción | subtotal $45 + zona Santa Ana $5 = **$50.00**, pedido `TEC-001002` pagado ✅ |
| Stock en producción | AUD-303 55→54 tras el cobro ✅ |
| Panel en producción | ventas $417, 1 activo, 1 por preparar, ticket visible en el tablero ✅ |
| **Escáner del POS** | tres lecturas del mismo código → cantidad 3; otra lectura → línea nueva; código inexistente rechazado con aviso ✅ |
| EAN-13 de anaquel | generado en canvas y **decodificado con ZXing: `2000000000114` / EAN_13** ✅ |
| Lectura desde foto en el POS | la misma foto subida dos veces sumó 2 unidades y $90.00 al ticket ✅ |
| Ajuste de cantidades | +1 → $135, −1 → $90; cobro de $90 creó `TEC-001005` y descontó stock ✅ |
| Integridad | 0 productos con stock negativo ✅ |

**No verificado / pendiente de decidir:**

- Confirmación de correo al registrarse: el sandbox no tiene SMTP, así que un registro nuevo queda sin sesión hasta confirmar. Hay que desactivar "Confirm email" en Auth o configurar un proveedor.
- Impresión física real en impresora térmica (probado en vista de impresión del navegador).
- Pasarela de pago real.
- Fotos reales de producto (hoy son SVG generados por script).

## Despliegue

**Antes de cada push:**

```bash
python tools/stamp_assets.py   # añade ?v=<hash> a js/css
```

Ese paso es obligatorio: GitHub Pages sirve los assets con `max-age=600`, y sin versionar puede
entregar el HTML nuevo con el JS viejo (un botón recién añadido “no hace nada”, sin errores).

```bash
GIT_TERMINAL_PROMPT=0 git \
  -c credential.helper= \
  -c credential.helper='!gh auth git-credential' \
  -c http.version=HTTP/1.1 push origin main

gh api repos/compratelosv/techstore/pages/builds/latest --jq .status   # hasta "built"
```

`-c credential.helper=` **vacío primero** es obligatorio en este equipo: hay un helper `store` global con un token viejo que devuelve 401 y hace fallar el push.

GitHub Pages sirve desde `main`. Esta app no tiene service worker, así que un deploy se ve al instante (sin caché de aplicación), aunque el CDN puede tardar unos minutos.
