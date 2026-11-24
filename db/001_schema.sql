-- TechStore · esquema base
-- Prefijo ts_ para convivir con las tablas de la tienda Compratelosv sin colisiones.

create extension if not exists pgcrypto;

-- ---------- tipos ----------
create type ts_order_status as enum (
  'pendiente_pago','pagado','en_preparacion','listo','entregado','cancelado','reembolsado'
);
create type ts_fulfillment as enum ('envio','retiro');
create type ts_payment_status as enum ('pendiente','aprobado','rechazado','reembolsado');
create type ts_channel as enum ('online','pos');
create type ts_movement_reason as enum ('entrada','venta','ajuste','devolucion','cancelacion');
create type ts_staff_role as enum ('cliente','operador','admin');

-- ---------- perfiles ----------
create table ts_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  role ts_staff_role not null default 'cliente',
  created_at timestamptz not null default now()
);

-- ---------- catálogo ----------
create table ts_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  sort_order int not null default 0
);

create table ts_products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null,
  description text,
  brand text,
  category_id uuid references ts_categories(id) on delete set null,
  price numeric(10,2) not null check (price >= 0),
  cost numeric(10,2) check (cost >= 0),
  stock int not null default 0 check (stock >= 0),
  low_stock int not null default 3 check (low_stock >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ts_products_category_idx on ts_products (category_id);
create index ts_products_active_idx on ts_products (active);

-- ---------- envío ----------
create table ts_shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cost numeric(10,2) not null default 0 check (cost >= 0),
  free_over numeric(10,2) check (free_over >= 0),
  active boolean not null default true
);

create table ts_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  line1 text not null,
  line2 text,
  city text not null,
  department text,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index ts_addresses_user_idx on ts_addresses (user_id);

-- ---------- pedidos ----------
create sequence ts_order_seq start 1000;

create table ts_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  user_id uuid references auth.users(id) on delete set null,
  channel ts_channel not null default 'online',
  status ts_order_status not null default 'pendiente_pago',
  fulfillment ts_fulfillment not null default 'envio',
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  shipping_cost numeric(10,2) not null default 0 check (shipping_cost >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  customer_name text not null,
  customer_email text,
  customer_phone text,
  ship_line1 text,
  ship_line2 text,
  ship_city text,
  ship_department text,
  ship_notes text,
  zone_id uuid references ts_shipping_zones(id) on delete set null,
  paid_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ts_orders_user_idx on ts_orders (user_id, created_at desc);
create index ts_orders_status_idx on ts_orders (status, created_at desc);

create table ts_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references ts_orders(id) on delete cascade,
  product_id uuid references ts_products(id) on delete set null,
  sku text not null,
  name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  qty int not null check (qty > 0),
  line_total numeric(10,2) not null check (line_total >= 0)
);
create index ts_order_items_order_idx on ts_order_items (order_id);

create table ts_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references ts_orders(id) on delete cascade,
  provider text not null default 'simulado',
  status ts_payment_status not null default 'pendiente',
  amount numeric(10,2) not null check (amount >= 0),
  reference text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index ts_payments_order_idx on ts_payments (order_id);

create table ts_inventory_movements (
  id bigserial primary key,
  product_id uuid not null references ts_products(id) on delete cascade,
  delta int not null,
  reason ts_movement_reason not null,
  order_id uuid references ts_orders(id) on delete set null,
  note text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ts_movements_product_idx on ts_inventory_movements (product_id, created_at desc);

create table ts_order_events (
  id bigserial primary key,
  order_id uuid not null references ts_orders(id) on delete cascade,
  from_status ts_order_status,
  to_status ts_order_status,
  note text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ts_order_events_order_idx on ts_order_events (order_id, created_at);

-- ---------- updated_at ----------
create or replace function ts_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger ts_products_touch before update on ts_products
  for each row execute function ts_touch_updated_at();
create trigger ts_orders_touch before update on ts_orders
  for each row execute function ts_touch_updated_at();

-- ---------- perfil automático al registrarse ----------
create or replace function ts_handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into ts_profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created_ts
  after insert on auth.users
  for each row execute function ts_handle_new_user();
