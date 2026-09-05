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
