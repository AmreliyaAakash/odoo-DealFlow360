-- ============================================================================
-- The exact structure this database is missing, and nothing else.
--
-- Probed against the live PostgREST schema rather than guessed, column by
-- column: every other table in schema.sql is already present. What is missing
-- is four tables and six columns —
--
--   customers.phone / .address               -> the customer portal
--   quotations.requested_delivery_date       -> confirmation
--   products.unit / .tax_pct / .description  -> /products
--   product_variants, price_lists            -> /products
--   subscriptions                            -> /subscriptions
--   replenishment_rules                      -> the reorder panel on
--                                               /backend/stock
--
-- Prefer this over db/repair.sql for THIS database. repair.sql is the whole
-- schema and would also run the duplicate-name cleanup in its "seed
-- idempotency" section, which deletes rows from customers, discount_rules,
-- subscription_plans and upsell_rules that share a name. Nothing here deletes
-- anything.
--
-- Idempotent: safe to re-run. Requires has_capability(), which this database
-- already has.
--
--   Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================

-- ------------------------------------------------------------ contact details
-- What the portal shows a customer back about themselves. Nullable: an account
-- created from a quotation has a name long before anyone fills these in.
--
-- Without these the whole portal quotation screen fails, not just the contact
-- panel: the page selects them in one embedded join, so a missing column takes
-- the entire query with it.

alter table customers add column if not exists phone   text;
alter table customers add column if not exists address text;

-- ------------------------------------------------------------ delivery date
-- What the customer asked for at confirmation. A request, not a promise.

alter table quotations add column if not exists requested_delivery_date date;

-- ------------------------------------------------------------ catalog depth
-- The product screens need a unit to quote in, a tax rate to invoice at, and
-- prose for the detail page.

alter table products add column if not exists unit text not null default 'Each';
alter table products add column if not exists description text;
alter table products add column if not exists tax_pct numeric(5,2) not null default 0;
do $$ begin
  alter table products add constraint products_tax_pct_check
    check (tax_pct between 0 and 100);
exception when duplicate_object then null; end $$;

-- One product, several sellable shapes.
create table if not exists product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  attribute   text not null,
  values      text[] not null default '{}',
  extra_price numeric(12,2) not null default 0,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (product_id, attribute)
);

create index if not exists product_variants_product_id_idx
  on product_variants (product_id, position);

-- Tier and currency pricing.
create table if not exists price_lists (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references products(id) on delete cascade,
  tier        text not null
                check (tier in ('standard','silver','gold','platinum')),
  currency    text not null default 'INR',
  rule        text not null default 'none'
                check (rule in ('none','percent_off','fixed')),
  amount      numeric(12,2) not null default 0 check (amount >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists price_lists_product_id_idx on price_lists (product_id);
create index if not exists price_lists_tier_idx on price_lists (tier);

-- ------------------------------------------------------------ subscriptions
-- A running subscription, as its own record.

create table if not exists subscriptions (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references orders(id) on delete cascade,
  quotation_id uuid references quotations(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  product_id   uuid references products(id) on delete set null,
  plan_id      uuid references subscription_plans(id) on delete set null,
  qty          numeric(12,2) not null default 1 check (qty >= 0),
  unit_price   numeric(12,2) not null default 0 check (unit_price >= 0),
  cadence      text not null default 'monthly'
                 check (cadence in ('monthly','quarterly','annual')),
  status       text not null default 'active'
                 check (status in ('active','paused','cancelled')),
  started_at   date not null default current_date,
  next_bill_on date,
  paused_at    timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists subscriptions_customer_id_idx on subscriptions (customer_id);
create index if not exists subscriptions_status_idx on subscriptions (status);
create index if not exists subscriptions_order_id_idx on subscriptions (order_id);

-- ------------------------------------------------------------ reorder rules

create table if not exists replenishment_rules (
  id             uuid primary key default gen_random_uuid(),
  warehouse_id   uuid not null references warehouses(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  reorder_point  int not null default 0 check (reorder_point >= 0),
  reorder_qty    int not null check (reorder_qty > 0),
  lead_time_days int not null default 7 check (lead_time_days >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  check (reorder_qty > reorder_point),
  unique (warehouse_id, product_id)
);

create index if not exists replenishment_rules_warehouse_idx
  on replenishment_rules (warehouse_id);

-- ============================================================ RLS
--
-- A table created above arrives with RLS off, which through PostgREST means
-- world-readable. Every policy below is the one schema.sql defines for that
-- table, so this grants nothing extra.

alter table product_variants     enable row level security;
alter table price_lists          enable row level security;
alter table subscriptions        enable row level security;
alter table replenishment_rules  enable row level security;

-- Variants and price lists are part of the product record, so they follow the
-- products module rather than carrying a permission of their own.
drop policy if exists product_variants_read on product_variants;
create policy product_variants_read on product_variants
  for select using (has_capability('products', 'view'));

drop policy if exists product_variants_write on product_variants;
create policy product_variants_write on product_variants
  for all
  using (has_capability('products', 'write'))
  with check (has_capability('products', 'write'));

drop policy if exists price_lists_read on price_lists;
create policy price_lists_read on price_lists
  for select using (has_capability('products', 'view'));

drop policy if exists price_lists_write on price_lists;
create policy price_lists_write on price_lists
  for all
  using (has_capability('products', 'write'))
  with check (has_capability('products', 'write'));

-- A customer may read their own running subscriptions through the portal; only
-- billing may pause, cancel or create one.
drop policy if exists subscriptions_read on subscriptions;
create policy subscriptions_read on subscriptions
  for select using (
    has_capability('billing', 'view')
    or customer_id in (
      select id from customers where portal_user_id = clerk_user_id()
    )
  );

drop policy if exists subscriptions_write on subscriptions;
create policy subscriptions_write on subscriptions
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

-- Reorder rules are warehouse configuration, same as the stock they watch.
drop policy if exists replenishment_rules_read on replenishment_rules;
create policy replenishment_rules_read on replenishment_rules
  for select using (has_capability('warehouses', 'view'));

drop policy if exists replenishment_rules_write on replenishment_rules;
create policy replenishment_rules_write on replenishment_rules
  for all
  using (has_capability('warehouses', 'write'))
  with check (has_capability('warehouses', 'write'));

-- PostgREST caches the schema; a new table is invisible until it reloads.
notify pgrst, 'reload schema';

-- ============================================================ specialist role
--
-- The cross-department role: no department of its own, every module at none
-- until an admin grants it from Users & Roles.
--
-- Strictly speaking these rows are optional — effective_capability() coalesces
-- a missing row to 'none', which is the same answer. They are written anyway so
-- the role exists as data: the permission editor lists what it finds in this
-- table, and a role with no rows would be invisible there.
--
-- GENERATED from lib/permissions.ts. `npm run db:build` rewrites the same rows
-- into db/setup.sql and db/repair.sql; this copy is here so an existing database
-- needs only one file.

insert into role_module_permissions (role, module, capability, scope) values
  ('specialist', 'products', 'none', 'none'),
  ('specialist', 'discountRules', 'none', 'none'),
  ('specialist', 'warehouses', 'none', 'none'),
  ('specialist', 'subscriptionPlans', 'none', 'none'),
  ('specialist', 'upsellRules', 'none', 'none'),
  ('specialist', 'reports', 'none', 'none'),
  ('specialist', 'quotationBuilder', 'none', 'none'),
  ('specialist', 'approvals', 'none', 'none'),
  ('specialist', 'upsellPanel', 'none', 'none'),
  ('specialist', 'warehouseSplit', 'none', 'none'),
  ('specialist', 'billing', 'none', 'none'),
  ('specialist', 'customerPortal', 'none', 'none'),
  ('specialist', 'dealHealth', 'none', 'none')
on conflict (role, module) do update
  set capability = excluded.capability,
      scope      = excluded.scope,
      updated_at = now();

notify pgrst, 'reload schema';
