-- ============================================================================
-- DealFlow360 — complete setup. Paste into Supabase → SQL Editor → Run.
-- Idempotent: every statement is guarded, so re-running is safe.
-- ============================================================================

-- DealFlow360 schema (Clerk-compatible RLS)
--
-- Clerk user IDs look like `user_2abc...`, so every owner column is TEXT, not
-- UUID. Policies read the Clerk subject from the session token:
--     auth.jwt() ->> 'sub'
-- Role-based policies additionally read:
--     auth.jwt() -> 'publicMetadata' ->> 'role'
--
-- Auth wiring (Clerk's native Supabase integration, not a JWT template):
--   1. Supabase → Authentication → Third-Party Auth → add Clerk, using the
--      instance domain (e.g. ample-bee-3134.clerk.accounts.dev).
--   2. Clerk → Sessions → Customize session token:
--        { "role": "authenticated", "publicMetadata": "{{user.public_metadata}}" }
--      `role` lets Supabase map the request onto the `authenticated` Postgres
--      role; `publicMetadata` carries the app role these policies read.

-- ============================================================ helpers

create or replace function clerk_user_id() returns text
  language sql stable as $$
    select auth.jwt() ->> 'sub'
  $$;

create or replace function clerk_role() returns text
  language sql stable as $$
    select auth.jwt() -> 'publicMetadata' ->> 'role'
  $$;

create or replace function is_staff() returns boolean
  language sql stable as $$
    select clerk_role() in ('admin', 'manager', 'finance', 'rep')
  $$;

create or replace function is_admin() returns boolean
  language sql stable as $$
    select clerk_role() = 'admin'
  $$;

-- ============================================================ config (A2-A5)

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sku           text unique,
  category      text not null default 'Uncategorized',
  list_price    numeric(12,2) not null check (list_price >= 0),
  cost          numeric(12,2) not null check (cost >= 0),
  cadence       text not null default 'one_time'
                  check (cadence in ('one_time','monthly','quarterly','annual')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists discount_rules (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  scope            text not null default 'global'
                     check (scope in ('global','category','product')),
  scope_ref        text,
  max_discount_pct numeric(5,2) not null check (max_discount_pct between 0 and 100),
  approval_level   text not null check (approval_level in ('manager','finance','admin')),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists warehouses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text unique not null,
  region     text,
  priority   int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists warehouse_stock (
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  available    int not null default 0 check (available >= 0),
  updated_at   timestamptz not null default now(),
  primary key (warehouse_id, product_id)
);

create table if not exists subscription_plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  cadence         text not null
                    check (cadence in ('monthly','quarterly','annual')),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  min_term_months int not null default 12 check (min_term_months > 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================ customers & quotations

create table if not exists customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text,
  -- Clerk user ID of the customer contact who signs into the portal (B8).
  portal_user_id text unique,
  created_at     timestamptz not null default now()
);

create index if not exists customers_portal_user_id_idx
  on customers (portal_user_id);

create table if not exists quotations (
  id                 uuid primary key default gen_random_uuid(),
  reference          text unique,
  customer_id        uuid references customers(id) on delete set null,
  -- Clerk user ID of the owning sales rep.
  rep_id             text not null,
  status             text not null default 'draft'
                       check (status in ('draft','pending_approval','approved',
                                         'rejected','returned','won','lost')),
  notes              text,
  valid_until        date,

  -- Denormalised totals, recomputed server-side on every save.
  subtotal           numeric(14,2) not null default 0,
  discount_total     numeric(14,2) not null default 0,
  net_total          numeric(14,2) not null default 0,
  cost_total         numeric(14,2) not null default 0,
  margin_total       numeric(14,2) not null default 0,
  max_discount_pct   numeric(5,2)  not null default 0,
  risk_score         int           not null default 0,

  required_approvals text[] not null default '{}',
  submitted_by       text,
  submitted_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists quotations_rep_id_idx on quotations (rep_id);
create index if not exists quotations_status_idx on quotations (status);
create index if not exists quotations_customer_id_idx on quotations (customer_id);
-- Drives the approvals queue: "quotations pending at my level".
create index if not exists quotations_required_approvals_idx
  on quotations using gin (required_approvals);

create table if not exists quotation_lines (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id   uuid not null references products(id),
  qty          numeric(12,2) not null check (qty > 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  -- Price and cost are snapshotted so historic quotes do not move with the catalog.
  unit_price   numeric(12,2) not null,
  unit_cost    numeric(12,2) not null,
  created_at   timestamptz not null default now()
);

create index if not exists quotation_lines_quotation_id_idx
  on quotation_lines (quotation_id);

-- ============================================================ approvals (B4)

create table if not exists approvals (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  level        text not null check (level in ('manager','finance','admin')),
  action       text not null check (action in ('approve','reject','return')),
  reason       text,
  decided_by   text not null,
  decided_at   timestamptz not null default now()
);

create index if not exists approvals_quotation_id_idx on approvals (quotation_id);

-- ============================================================ negotiation (B8)

create table if not exists negotiation_messages (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  author_id    text not null,
  author_kind  text not null check (author_kind in ('rep','customer')),
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists negotiation_messages_quotation_id_idx
  on negotiation_messages (quotation_id, created_at);

-- ============================================================ warehouse split (B6)

create table if not exists quotation_allocations (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id   uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  qty          numeric(12,2) not null check (qty > 0),
  manual       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists quotation_allocations_quotation_id_idx
  on quotation_allocations (quotation_id);

-- ============================================================ seed idempotency
--
-- The seed uses bare `on conflict do nothing`, which only fires on an actual
-- unique violation. Without these, re-running the seed duplicates every row.

-- Drop any duplicates an earlier un-guarded run may have left, keeping the
-- oldest row, so the unique indexes below can be created.
delete from discount_rules a
  using discount_rules b
  where a.name = b.name and a.ctid > b.ctid;
delete from subscription_plans a
  using subscription_plans b
  where a.name = b.name and a.ctid > b.ctid;
delete from customers a
  using customers b
  where a.name = b.name and a.ctid > b.ctid;

create unique index if not exists discount_rules_name_key
  on discount_rules (name);
create unique index if not exists subscription_plans_name_key
  on subscription_plans (name);
create unique index if not exists customers_name_key
  on customers (name);

-- ============================================================ RLS

alter table products              enable row level security;
alter table discount_rules        enable row level security;
alter table warehouses            enable row level security;
alter table warehouse_stock       enable row level security;
alter table subscription_plans    enable row level security;
alter table customers             enable row level security;
alter table quotations            enable row level security;
alter table quotation_lines       enable row level security;
alter table approvals             enable row level security;
alter table negotiation_messages  enable row level security;
alter table quotation_allocations enable row level security;

-- Config tables: any signed-in staff member reads; only admins write (A2-A5).
do $$
declare t text;
begin
  foreach t in array array['products','discount_rules','warehouses',
                           'warehouse_stock','subscription_plans']
  loop
    execute format($f$
      drop policy if exists %1$I_staff_read on %1$I;
      create policy %1$I_staff_read on %1$I
        for select using (is_staff());

      drop policy if exists %1$I_admin_write on %1$I;
      create policy %1$I_admin_write on %1$I
        for all using (is_admin()) with check (is_admin());
    $f$, t);
  end loop;
end $$;

-- Customers: staff see all; a portal user sees only their own row.
drop policy if exists customers_read on customers;
create policy customers_read on customers
  for select using (is_staff() or portal_user_id = clerk_user_id());

drop policy if exists customers_staff_write on customers;
create policy customers_staff_write on customers
  for all using (is_staff()) with check (is_staff());

-- Quotations: the owning rep, any approver, or the customer on the portal.
drop policy if exists quotations_read on quotations;
create policy quotations_read on quotations
  for select using (
    rep_id = clerk_user_id()
    or clerk_role() in ('manager','finance','admin')
    or customer_id in (
      select id from customers where portal_user_id = clerk_user_id()
    )
  );

drop policy if exists quotations_rep_write on quotations;
create policy quotations_rep_write on quotations
  for all
  using (rep_id = clerk_user_id() or clerk_role() in ('manager','finance','admin'))
  with check (rep_id = clerk_user_id() or clerk_role() in ('manager','finance','admin'));

-- Child rows inherit their parent quotation's visibility.
do $$
declare t text;
begin
  foreach t in array array['quotation_lines','approvals',
                           'negotiation_messages','quotation_allocations']
  loop
    execute format($f$
      drop policy if exists %1$I_via_quotation on %1$I;
      create policy %1$I_via_quotation on %1$I
        for all
        using (quotation_id in (select id from quotations))
        with check (quotation_id in (select id from quotations));
    $f$, t);
  end loop;
end $$;

-- Realtime for the deal-health dashboard (B9). Guarded: re-adding a table to a
-- publication raises 42710, so check the catalog first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quotations'
  ) then
    alter publication supabase_realtime add table quotations;
  end if;
end $$;


-- DealFlow360 seed data: discount tiers, warehouses, products, subscription plans.
-- Safe to re-run: every insert is keyed on a natural unique column.

-- ============================================================ products

insert into products (name, sku, category, list_price, cost, cadence) values
  ('Rack Server R450',        'SRV-R450',  'Servers',     8400.00, 6100.00, 'one_time'),
  ('Rack Server R650',        'SRV-R650',  'Servers',    13900.00, 9800.00, 'one_time'),
  ('Edge Node E20',           'SRV-E20',   'Servers',     3200.00, 2350.00, 'one_time'),
  ('Core Switch 48P',         'NET-SW48',  'Networking',  4600.00, 3150.00, 'one_time'),
  ('Access Switch 24P',       'NET-SW24',  'Networking',  1850.00, 1240.00, 'one_time'),
  ('Firewall FG-200',         'NET-FW200', 'Networking',  5200.00, 3600.00, 'one_time'),
  ('NVMe Array 24TB',         'STO-N24',   'Storage',     9750.00, 7200.00, 'one_time'),
  ('Backup Vault 100TB',      'STO-B100',  'Storage',    12400.00, 9100.00, 'one_time'),
  ('Install & Commissioning', 'SVC-INST',  'Services',    2400.00, 1500.00, 'one_time'),
  ('Support Plan Standard',   'SUB-STD',   'Support',      180.00,   70.00, 'monthly'),
  ('Support Plan Premium',    'SUB-PRM',   'Support',      420.00,  165.00, 'monthly'),
  ('Monitoring Suite',        'SUB-MON',   'Support',      260.00,   95.00, 'monthly')
on conflict (sku) do nothing;

-- ============================================================ discount tiers

insert into discount_rules (name, scope, scope_ref, max_discount_pct, approval_level) values
  ('Tier 1 — rep discretion',   'global',   null,         10.00, 'manager'),
  ('Tier 2 — manager sign-off', 'global',   null,         25.00, 'finance'),
  ('Tier 3 — finance sign-off', 'global',   null,         40.00, 'admin'),
  ('Services floor',            'category', 'Services',   15.00, 'finance'),
  ('Support floor',             'category', 'Support',    20.00, 'finance')
on conflict do nothing;

-- ============================================================ warehouses

insert into warehouses (name, code, region, priority) values
  ('Amsterdam DC',  'AMS', 'EMEA',     10),
  ('Frankfurt DC',  'FRA', 'EMEA',     20),
  ('Dallas DC',     'DFW', 'AMER',     30),
  ('Singapore DC',  'SIN', 'APAC',     40)
on conflict (code) do nothing;

-- Stock: every product in every warehouse, so B6 has something to split across.
insert into warehouse_stock (warehouse_id, product_id, available)
select w.id,
       p.id,
       case w.code
         when 'AMS' then 40
         when 'FRA' then 25
         when 'DFW' then 15
         else 8
       end
from warehouses w
cross join products p
on conflict (warehouse_id, product_id) do nothing;

-- ============================================================ subscription plans

insert into subscription_plans (name, cadence, unit_price, min_term_months) values
  ('Support Standard — Monthly', 'monthly',   180.00, 12),
  ('Support Premium — Monthly',  'monthly',   420.00, 12),
  ('Support Standard — Annual',  'annual',   1950.00, 12),
  ('Support Premium — Annual',   'annual',   4550.00, 24),
  ('Monitoring — Quarterly',     'quarterly',  750.00, 12)
on conflict do nothing;

-- ============================================================ demo customer
-- Set `portal_user_id` to a real Clerk user ID to exercise the portal (B8).

insert into customers (name, email, portal_user_id) values
  ('Northwind Logistics', 'ops@northwind.example', null),
  ('Helios Manufacturing', 'it@helios.example',    null)
on conflict do nothing;


-- ============================================================================
-- Demo pipeline for the signed-in sales rep, so the dashboard has real shape.
-- Replace the rep id below if you sign in as a different Clerk user.
-- ============================================================================

do $$
declare
  v_rep   text := 'user_3ItkOpahZQEH2da0kwZVm5s8CLk';
  v_cust  uuid;
  v_quote uuid;
  v_prod  record;
  v_status text;
  v_disc  numeric;
  v_days  int;
  i       int;
begin
  -- Skip entirely if this rep already has quotations.
  if exists (select 1 from quotations where rep_id = v_rep) then
    raise notice 'Rep already has quotations; skipping demo data.';
    return;
  end if;

  for i in 1..14 loop
    select id into v_cust from customers order by random() limit 1;

    v_status := (array['draft','pending_approval','approved','won','lost'])[1 + (i % 5)];
    v_disc   := (array[0, 5, 12, 18, 27, 33, 41])[1 + (i % 7)];
    v_days   := (i * 5) % 60;

    insert into quotations (
      reference, customer_id, rep_id, status,
      max_discount_pct, created_at, updated_at,
      submitted_by, submitted_at
    )
    values (
      'Q-2026-' || lpad(i::text, 4, '0'), v_cust, v_rep, v_status,
      v_disc, now() - (v_days || ' days')::interval, now() - (v_days || ' days')::interval,
      case when v_status = 'draft' then null else v_rep end,
      case when v_status = 'draft' then null else now() - (v_days || ' days')::interval end
    )
    returning id into v_quote;

    -- Two or three lines per quote, drawn from the catalog.
    for v_prod in
      select id, list_price, cost from products order by random() limit 2 + (i % 2)
    loop
      insert into quotation_lines (
        quotation_id, product_id, qty, discount_pct, unit_price, unit_cost
      )
      values (v_quote, v_prod.id, 1 + (i % 4), v_disc, v_prod.list_price, v_prod.cost);
    end loop;
  end loop;

  -- Roll line-level maths up into the denormalised quotation totals.
  update quotations q
  set subtotal       = t.gross,
      discount_total = t.discount,
      net_total      = t.gross - t.discount,
      cost_total     = t.cost,
      margin_total   = (t.gross - t.discount) - t.cost
  from (
    select l.quotation_id,
           sum(l.unit_price * l.qty)                          as gross,
           sum(l.unit_price * l.qty * l.discount_pct / 100.0) as discount,
           sum(l.unit_cost  * l.qty)                          as cost
    from quotation_lines l
    group by l.quotation_id
  ) t
  where q.id = t.quotation_id and q.rep_id = v_rep;

  raise notice 'Seeded 14 demo quotations for %', v_rep;
end $$;

-- ============================================================================
-- Verification — the result should show non-zero counts.
-- ============================================================================

select 'products'        as table_name, count(*) from products
union all select 'discount_rules',      count(*) from discount_rules
union all select 'warehouses',          count(*) from warehouses
union all select 'subscription_plans',  count(*) from subscription_plans
union all select 'customers',           count(*) from customers
union all select 'quotations',          count(*) from quotations
union all select 'quotation_lines',     count(*) from quotation_lines
order by table_name;
