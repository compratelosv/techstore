-- TechStore · funciones de negocio y seguridad (RLS)

-- ============ utilidades de rol ============
create or replace function ts_is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from ts_profiles p
    where p.id = auth.uid() and p.role in ('admin','operador')
  );
$$;

create or replace function ts_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from ts_profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ============ crear pedido ============
-- No descuenta stock: lo hace la confirmación del pago, para no congelar
-- inventario de carritos abandonados. Sí valida disponibilidad.
create or replace function ts_place_order(
  p_items jsonb,
  p_fulfillment ts_fulfillment,
  p_customer jsonb,
  p_shipping jsonb default '{}'::jsonb,
  p_channel ts_channel default 'online'
) returns ts_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_order ts_orders;
  v_subtotal numeric(10,2) := 0;
  v_ship numeric(10,2) := 0;
  v_zone uuid := null;
  v_item record;
  v_prod ts_products;
  v_code text;
  v_total numeric(10,2);
begin
  if p_channel = 'online' and v_uid is null then
    raise exception 'Debes iniciar sesión para comprar' using errcode = '28000';
  end if;
  if p_channel = 'pos' and not ts_is_staff() then
    raise exception 'Solo el personal puede vender en el punto de venta' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty int)
  loop
    if v_item.qty is null or v_item.qty < 1 then
      raise exception 'Cantidad inválida';
    end if;
    select * into v_prod from ts_products
      where id = v_item.product_id and active for share;
    if not found then
      raise exception 'Hay un producto que ya no está disponible';
    end if;
    if v_prod.stock < v_item.qty then
      raise exception 'Stock insuficiente de % (quedan %)', v_prod.name, v_prod.stock;
    end if;
    v_subtotal := v_subtotal + (v_prod.price * v_item.qty);
  end loop;

  if p_fulfillment = 'envio' then
    if coalesce(p_shipping->>'city', '') = '' then
      raise exception 'Falta la ciudad de entrega';
    end if;
    if coalesce(p_shipping->>'zone_id', '') <> '' then
      v_zone := (p_shipping->>'zone_id')::uuid;
      select cost into v_ship from ts_shipping_zones where id = v_zone and active;
      if not found then
        raise exception 'Zona de envío inválida';
      end if;
      -- envío gratis por monto
      if exists (
        select 1 from ts_shipping_zones
        where id = v_zone and free_over is not null and v_subtotal >= free_over
      ) then
        v_ship := 0;
      end if;
    else
      raise exception 'Falta la zona de envío';
    end if;
  else
    v_ship := 0; -- retiro en tienda
  end if;

  v_total := v_subtotal + v_ship;
  v_code := 'TEC-' || lpad(nextval('ts_order_seq')::text, 6, '0');

  insert into ts_orders (
    code, user_id, channel, status, fulfillment,
    subtotal, shipping_cost, total,
    customer_name, customer_email, customer_phone,
    ship_line1, ship_line2, ship_city, ship_department, ship_notes, zone_id, created_by
  ) values (
    v_code, v_uid, p_channel, 'pendiente_pago', p_fulfillment,
    v_subtotal, v_ship, v_total,
    coalesce(p_customer->>'name', 'Cliente'),
    p_customer->>'email',
    p_customer->>'phone',
    p_shipping->>'line1', p_shipping->>'line2', p_shipping->>'city',
    p_shipping->>'department', p_shipping->>'notes', v_zone, v_uid
  ) returning * into v_order;

  insert into ts_order_items (order_id, product_id, sku, name, unit_price, qty, line_total)
  select v_order.id, p.id, p.sku, p.name, p.price, i.qty, p.price * i.qty
  from jsonb_to_recordset(p_items) as i(product_id uuid, qty int)
  join ts_products p on p.id = i.product_id;

  insert into ts_order_events (order_id, from_status, to_status, note, user_id)
  values (v_order.id, null, 'pendiente_pago', 'Pedido creado', v_uid);

  return v_order;
end $$;

-- ============ confirmar pago (idempotente) ============
create or replace function ts_confirm_payment(
  p_order_id uuid,
  p_provider text default 'simulado',
  p_reference text default null
) returns ts_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order ts_orders;
  v_item record;
  v_prod ts_products;
  v_uid uuid := auth.uid();
begin
  select * into v_order from ts_orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  -- Idempotencia: un segundo clic no duplica cobros ni movimientos.
  if v_order.status <> 'pendiente_pago' then
    return v_order;
  end if;

  -- Permisos: el dueño (pago simulado) o personal de la tienda.
  if not (ts_is_staff() or (v_order.user_id = v_uid and p_provider = 'simulado')) then
    raise exception 'No autorizado para confirmar este pago' using errcode = '42501';
  end if;

  for v_item in select * from ts_order_items where order_id = v_order.id loop
    update ts_products set stock = stock - v_item.qty
      where id = v_item.product_id and stock >= v_item.qty
      returning * into v_prod;
    if not found then
      raise exception 'Stock insuficiente de % al confirmar el pago', v_item.name;
    end if;
    insert into ts_inventory_movements (product_id, delta, reason, order_id, note, user_id)
    values (v_item.product_id, -v_item.qty, 'venta', v_order.id, 'Venta ' || v_order.code, v_uid);
  end loop;

  insert into ts_payments (order_id, provider, status, amount, reference, raw)
  values (v_order.id, p_provider, 'aprobado', v_order.total, p_reference,
          jsonb_build_object('simulado', p_provider = 'simulado'));

  update ts_orders set status = 'pagado', paid_at = now()
    where id = v_order.id returning * into v_order;

  insert into ts_order_events (order_id, from_status, to_status, note, user_id)
  values (v_order.id, 'pendiente_pago', 'pagado', 'Pago confirmado (' || p_provider || ')', v_uid);

  return v_order;
end $$;

-- ============ cambiar estado con reglas ============
create or replace function ts_set_order_status(
  p_order_id uuid,
  p_status ts_order_status,
  p_note text default null
) returns ts_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order ts_orders;
  v_allowed ts_order_status[];
  v_item record;
  v_uid uuid := auth.uid();
  v_from ts_order_status;
begin
  if not ts_is_staff() then
    raise exception 'Solo el personal puede cambiar el estado' using errcode = '42501';
  end if;

  select * into v_order from ts_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_order.status = p_status then return v_order; end if;
  v_from := v_order.status;

  v_allowed := case v_order.status
    when 'pendiente_pago' then array['pagado','cancelado']::ts_order_status[]
    when 'pagado'         then array['en_preparacion','cancelado','reembolsado']::ts_order_status[]
    when 'en_preparacion' then array['listo','cancelado']::ts_order_status[]
    when 'listo'          then array['entregado','cancelado']::ts_order_status[]
    when 'entregado'      then array['reembolsado']::ts_order_status[]
    else array[]::ts_order_status[]
  end;

  if not (p_status = any(v_allowed)) then
    raise exception 'Transición no permitida: % → %', v_order.status, p_status;
  end if;

  -- Devolver inventario si el pedido ya había descontado stock.
  if p_status in ('cancelado','reembolsado')
     and v_order.status in ('pagado','en_preparacion','listo','entregado') then
    for v_item in select * from ts_order_items where order_id = v_order.id loop
      update ts_products set stock = stock + v_item.qty where id = v_item.product_id;
      insert into ts_inventory_movements (product_id, delta, reason, order_id, note, user_id)
      values (v_item.product_id, v_item.qty, 'cancelacion', v_order.id,
              'Reingreso por ' || p_status || ' de ' || v_order.code, v_uid);
    end loop;
  end if;

  update ts_orders set
    status = p_status,
    preparing_at = case when p_status = 'en_preparacion' then now() else preparing_at end,
    ready_at     = case when p_status = 'listo' then now() else ready_at end,
    delivered_at = case when p_status = 'entregado' then now() else delivered_at end,
    cancelled_at = case when p_status in ('cancelado','reembolsado') then now() else cancelled_at end
  where id = v_order.id returning * into v_order;

  insert into ts_order_events (order_id, from_status, to_status, note, user_id)
  values (v_order.id, v_from, p_status, p_note, v_uid);

  return v_order;
end $$;

-- ============ ajuste manual de inventario ============
create or replace function ts_adjust_stock(
  p_product_id uuid,
  p_delta int,
  p_note text default null
) returns ts_products
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prod ts_products;
begin
  if not ts_is_staff() then
    raise exception 'Solo el personal puede ajustar inventario' using errcode = '42501';
  end if;
  update ts_products set stock = greatest(0, stock + p_delta)
    where id = p_product_id returning * into v_prod;
  if not found then raise exception 'Producto no encontrado'; end if;

  insert into ts_inventory_movements (product_id, delta, reason, note, user_id)
  values (p_product_id, p_delta,
          case when p_delta >= 0 then 'entrada' else 'ajuste' end::ts_movement_reason,
          p_note, auth.uid());
  return v_prod;
end $$;

-- ============ RLS ============
alter table ts_profiles            enable row level security;
alter table ts_categories          enable row level security;
alter table ts_products            enable row level security;
alter table ts_shipping_zones      enable row level security;
alter table ts_addresses           enable row level security;
alter table ts_orders              enable row level security;
alter table ts_order_items         enable row level security;
alter table ts_payments            enable row level security;
alter table ts_inventory_movements enable row level security;
alter table ts_order_events        enable row level security;

-- perfiles: cada quien ve el suyo; el personal ve todos
create policy ts_profiles_read on ts_profiles for select
  using (id = auth.uid() or ts_is_staff());
create policy ts_profiles_update_own on ts_profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- el rol no se puede cambiar desde el cliente (solo por columnas permitidas)
revoke insert, update, delete on ts_profiles from anon, authenticated;
grant select on ts_profiles to authenticated;
grant update (full_name, phone) on ts_profiles to authenticated;

-- catálogo público
create policy ts_categories_read on ts_categories for select using (true);
create policy ts_categories_write on ts_categories for all
  using (ts_is_staff()) with check (ts_is_staff());

create policy ts_products_read on ts_products for select
  using (active or ts_is_staff());
create policy ts_products_write on ts_products for all
  using (ts_is_staff()) with check (ts_is_staff());

create policy ts_zones_read on ts_shipping_zones for select using (active or ts_is_staff());
create policy ts_zones_write on ts_shipping_zones for all
  using (ts_is_staff()) with check (ts_is_staff());

-- direcciones: solo el dueño
create policy ts_addresses_own on ts_addresses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- pedidos: el cliente ve los suyos, el personal todos
create policy ts_orders_read on ts_orders for select
  using (user_id = auth.uid() or ts_is_staff());
create policy ts_orders_update on ts_orders for update
  using (ts_is_staff()) with check (ts_is_staff());

create policy ts_items_read on ts_order_items for select
  using (exists (
    select 1 from ts_orders o
    where o.id = order_id and (o.user_id = auth.uid() or ts_is_staff())
  ));

create policy ts_payments_read on ts_payments for select
  using (exists (
    select 1 from ts_orders o
    where o.id = order_id and (o.user_id = auth.uid() or ts_is_staff())
  ));

create policy ts_movements_read on ts_inventory_movements for select
  using (ts_is_staff());

create policy ts_events_read on ts_order_events for select
  using (exists (
    select 1 from ts_orders o
    where o.id = order_id and (o.user_id = auth.uid() or ts_is_staff())
  ));
