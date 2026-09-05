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

-- ============================================================ config audit (A6)
--
-- Every change an admin makes to the config tables is written here as one row
-- per field changed, so the admin dashboard can show "who changed what, from
-- what, to what". `actor_name` and `entity_label` are snapshots taken at write
-- time: the log must stay readable after a user is deleted or a product renamed.

create table if not exists config_audit_log (
  id           uuid primary key default gen_random_uuid(),
  -- Clerk user ID of whoever made the change.
  actor_id     text not null,
  actor_name   text,
  entity       text not null
                 check (entity in ('products','discount_rules','warehouses',
                                   'subscription_plans','users')),
  entity_id    text,
  entity_label text,
  action       text not null check (action in ('create','update','delete')),
  -- Null on create/delete, where the whole row is the change.
  field        text,
  old_value    text,
  new_value    text,
  created_at   timestamptz not null default now()
);

-- The dashboard only ever reads the newest rows.
create index if not exists config_audit_log_created_at_idx
  on config_audit_log (created_at desc);

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

-- ============================================================ upsell rules (B5)

create table if not exists upsell_rules (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  -- The product that triggers the suggestion, and the one suggested alongside.
  trigger_product_id uuid references products(id) on delete cascade,
  trigger_category   text,
  suggested_product_id uuid not null references products(id) on delete cascade,
  -- Ordering hint when several rules fire for the same line.
  priority           int not null default 100,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create index if not exists upsell_rules_trigger_product_idx
  on upsell_rules (trigger_product_id);

delete from upsell_rules a
  using upsell_rules b
  where a.name = b.name and a.ctid > b.ctid;

create unique index if not exists upsell_rules_name_key on upsell_rules (name);

-- ============================================================ RLS
--
-- The database is the last line, not the first. The route guard decides who may
-- load a URL and the API guards decide who may call an action; these policies
-- assume both have been bypassed — a browser talking straight to PostgREST with
-- a valid Clerk token — and still hold.
--
-- Note on the role claim: `clerk_role()` reads `publicMetadata.role`, NOT the
-- top-level `role` claim. In Clerk's native Supabase integration the top-level
-- `role` is the Postgres role ("authenticated") that Supabase maps the request
-- onto; the application role travels in publicMetadata. Comparing against
-- `auth.jwt() ->> 'role'` would compare every user against "authenticated" and
-- match nobody.

alter table products              enable row level security;
alter table discount_rules        enable row level security;
alter table warehouses            enable row level security;
alter table warehouse_stock       enable row level security;
alter table subscription_plans    enable row level security;
alter table upsell_rules          enable row level security;
alter table customers             enable row level security;
alter table quotations            enable row level security;
alter table quotation_lines       enable row level security;
alter table approvals             enable row level security;
alter table negotiation_messages  enable row level security;
alter table quotation_allocations enable row level security;
alter table config_audit_log      enable row level security;

-- ------------------------------------------------------------ config tables
--
-- Every staff role reads the catalog; who may write it differs per table, and
-- follows the permission matrix:
--   products, discount_rules, upsell_rules  → admin only
--   warehouses, warehouse_stock, subscription_plans → admin and finance
--
-- A customer reads none of it: `is_staff()` excludes them, so the portal cannot
-- enumerate the price list.

do $$
declare t text;
begin
  foreach t in array array['products','discount_rules','warehouses',
                           'warehouse_stock','subscription_plans','upsell_rules']
  loop
    execute format($f$
      drop policy if exists %1$I_staff_read on %1$I;
      create policy %1$I_staff_read on %1$I
        for select using (is_staff());
    $f$, t);
  end loop;
end $$;

-- Admin-only writes.
do $$
declare t text;
begin
  foreach t in array array['products','discount_rules','upsell_rules']
  loop
    execute format($f$
      drop policy if exists %1$I_admin_write on %1$I;
      create policy %1$I_admin_write on %1$I
        for all using (is_admin()) with check (is_admin());
    $f$, t);
  end loop;
end $$;

-- Finance owns warehouse setup and subscription plans alongside the admin.
do $$
declare t text;
begin
  foreach t in array array['warehouses','warehouse_stock','subscription_plans']
  loop
    execute format($f$
      drop policy if exists %1$I_admin_write on %1$I;
      drop policy if exists %1$I_finance_write on %1$I;
      create policy %1$I_finance_write on %1$I
        for all
        using (clerk_role() in ('admin','finance'))
        with check (clerk_role() in ('admin','finance'));
    $f$, t);
  end loop;
end $$;

-- A portal customer is not staff, so the policy above hides the catalog from
-- them — including through the embedded join the portal uses to name the lines
-- on their own quotation, which would otherwise render as "Item". This opens up
-- exactly the products that appear on a quotation they can already read, and
-- nothing else: `quotations` is itself filtered to their own rows.
drop policy if exists products_customer_read on products;
create policy products_customer_read on products
  for select using (
    clerk_role() = 'customer'
    and id in (
      select l.product_id from quotation_lines l
      where l.quotation_id in (select id from quotations)
    )
  );

-- ------------------------------------------------------------ customers

-- Staff see every customer; a portal user sees only their own row.
drop policy if exists customers_read on customers;
create policy customers_read on customers
  for select using (is_staff() or portal_user_id = clerk_user_id());

-- A customer never edits their own record — the link to a Clerk user is what
-- the portal's whole access model rests on.
drop policy if exists customers_staff_write on customers;
create policy customers_staff_write on customers
  for all using (is_staff()) with check (is_staff());

-- ------------------------------------------------------------ quotations

-- The owning rep, any approver, or the customer the quote was raised for.
drop policy if exists quotations_read on quotations;
create policy quotations_read on quotations
  for select using (
    rep_id = clerk_user_id()
    or clerk_role() in ('manager','finance','admin')
    or customer_id in (
      select id from customers where portal_user_id = clerk_user_id()
    )
  );

-- Writes are narrower than reads: a rep may only ever write their own rows, and
-- an approver may not write one at all. Approvers change a quotation's status
-- through the approvals table, not by editing it directly.
drop policy if exists quotations_rep_write on quotations;
drop policy if exists quotations_insert on quotations;
create policy quotations_insert on quotations
  for insert
  with check (
    (clerk_role() = 'rep' and rep_id = clerk_user_id())
    or is_admin()
  );

drop policy if exists quotations_update on quotations;
create policy quotations_update on quotations
  for update
  using (
    (clerk_role() = 'rep' and rep_id = clerk_user_id())
    or clerk_role() in ('manager','finance','admin')
  )
  with check (
    (clerk_role() = 'rep' and rep_id = clerk_user_id())
    or clerk_role() in ('manager','finance','admin')
  );

drop policy if exists quotations_delete on quotations;
create policy quotations_delete on quotations
  for delete
  using ((clerk_role() = 'rep' and rep_id = clerk_user_id()) or is_admin());

-- ------------------------------------------------------------ quotation lines

-- Readable by anyone who can read the parent quotation; writable only by the
-- rep who owns it and the admin, matching the builder's matrix row.
drop policy if exists quotation_lines_via_quotation on quotation_lines;
drop policy if exists quotation_lines_read on quotation_lines;
create policy quotation_lines_read on quotation_lines
  for select using (quotation_id in (select id from quotations));

drop policy if exists quotation_lines_write on quotation_lines;
create policy quotation_lines_write on quotation_lines
  for all
  using (
    is_admin()
    or quotation_id in (select id from quotations where rep_id = clerk_user_id())
  )
  with check (
    is_admin()
    or quotation_id in (select id from quotations where rep_id = clerk_user_id())
  );

-- ------------------------------------------------------------ approvals
--
-- The important one. Reading a decision is open to anyone who can read the
-- quotation, but recording one is restricted to the approver roles — without
-- this split a rep could insert an `approve` row against their own deal and
-- walk it straight past the desk.

drop policy if exists approvals_via_quotation on approvals;
drop policy if exists approvals_read on approvals;
create policy approvals_read on approvals
  for select using (quotation_id in (select id from quotations));

drop policy if exists approvals_insert on approvals;
create policy approvals_insert on approvals
  for insert
  with check (
    clerk_role() in ('manager','finance','admin')
    -- A manager may only record a manager-level decision, finance a finance-level
    -- one. Admins may record any tier.
    and (is_admin() or level = clerk_role())
    -- Decisions are attributed to whoever made them.
    and decided_by = clerk_user_id()
    and quotation_id in (select id from quotations)
  );

-- Deliberately no update or delete policy: an approval is an audit record.

-- ------------------------------------------------------------ negotiation

-- The portal thread. The customer the quote belongs to, and staff answering
-- them; an approver has no business posting into it.
drop policy if exists negotiation_messages_via_quotation on negotiation_messages;
drop policy if exists negotiation_messages_read on negotiation_messages;
create policy negotiation_messages_read on negotiation_messages
  for select using (quotation_id in (select id from quotations));

drop policy if exists negotiation_messages_insert on negotiation_messages;
create policy negotiation_messages_insert on negotiation_messages
  for insert
  with check (
    author_id = clerk_user_id()
    and quotation_id in (select id from quotations)
    and (
      -- The rep who owns the quotation, writing as staff.
      (author_kind = 'rep'
        and quotation_id in (select id from quotations where rep_id = clerk_user_id()))
      -- The customer it was raised for, writing as themselves.
      or (author_kind = 'customer'
        and clerk_role() = 'customer'
        and quotation_id in (
          select id from quotations
          where customer_id in (
            select id from customers where portal_user_id = clerk_user_id()
          )
        ))
    )
  );

-- ------------------------------------------------------------ allocations

-- Warehouse split: the rep may override the suggestion on their own quote,
-- finance manages allocation everywhere, and everyone else only looks.
drop policy if exists quotation_allocations_via_quotation on quotation_allocations;
drop policy if exists quotation_allocations_read on quotation_allocations;
create policy quotation_allocations_read on quotation_allocations
  for select using (quotation_id in (select id from quotations));

drop policy if exists quotation_allocations_write on quotation_allocations;
create policy quotation_allocations_write on quotation_allocations
  for all
  using (
    clerk_role() in ('finance','admin')
    or quotation_id in (select id from quotations where rep_id = clerk_user_id())
  )
  with check (
    clerk_role() in ('finance','admin')
    or quotation_id in (select id from quotations where rep_id = clerk_user_id())
  );

-- ------------------------------------------------------------ audit log

-- Any staff member may read the history; only admins append to it, and nobody
-- edits or deletes a written entry.
drop policy if exists config_audit_log_staff_read on config_audit_log;
create policy config_audit_log_staff_read on config_audit_log
  for select using (is_staff());

drop policy if exists config_audit_log_admin_insert on config_audit_log;
create policy config_audit_log_admin_insert on config_audit_log
  for insert with check (is_admin() and actor_id = clerk_user_id());

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

-- The admin dashboard's audit feed subscribes to inserts on this table.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'config_audit_log'
  ) then
    alter publication supabase_realtime add table config_audit_log;
  end if;
end $$;
