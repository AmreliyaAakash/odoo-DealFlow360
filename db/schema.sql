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

-- A rule may be pinned to one customer tier; null means it applies to every
-- tier. Nullable rather than defaulted, so rules written before tiers existed
-- keep applying to everyone.
alter table discount_rules add column if not exists customer_tier text;
do $$ begin
  alter table discount_rules add constraint discount_rules_customer_tier_check
    check (customer_tier is null
           or customer_tier in ('standard','silver','gold','platinum'));
exception when duplicate_object then null; end $$;

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

-- Commercial tier. With the product's category this decides the discount ceiling
-- a rep may quote without escalation — see discount_rules.customer_tier below.
alter table customers add column if not exists tier text not null default 'standard';
do $$ begin
  alter table customers add constraint customers_tier_check
    check (tier in ('standard','silver','gold','platinum'));
exception when duplicate_object then null; end $$;

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

-- Set only on subscription lines: which billing cycle the rep picked.
alter table quotation_lines add column if not exists subscription_plan_id uuid;
do $$ begin
  alter table quotation_lines add constraint quotation_lines_subscription_plan_id_fkey
    foreign key (subscription_plan_id) references subscription_plans(id);
exception when duplicate_object then null; end $$;

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

-- ============================================================ permissions (A8)
--
-- Access is resolved in three layers, outermost last:
--
--   1. the static matrix in lib/permissions.ts — the fallback, and the thing
--      `role_module_permissions` is seeded from;
--   2. `role_module_permissions` — what a role may do, editable as data;
--   3. `user_module_permissions` — one account's exception, which may grant a
--      module its role does not have, or take one away.
--
-- An admin is exempt from layer 3 in both directions: their access can never be
-- narrowed or widened per account, only role-wide. That is a deliberate
-- lockout guard — there must always be somebody who can put it back.

create table if not exists role_module_permissions (
  role       text not null,
  module     text not null,
  capability text not null
               check (capability in ('none','view','use','write','full')),
  scope      text not null default 'all'
               check (scope in ('none','own','team','all')),
  updated_at timestamptz not null default now(),
  primary key (role, module)
);

-- One account's exception to its role. `capability = 'none'` is a revoke.
create table if not exists user_module_permissions (
  user_id    text not null,
  module     text not null,
  capability text not null
               check (capability in ('none','view','use','write','full')),
  scope      text not null default 'all'
               check (scope in ('none','own','team','all')),
  created_at timestamptz not null default now(),
  created_by text,
  primary key (user_id, module)
);

create index if not exists user_module_permissions_user_idx
  on user_module_permissions (user_id);

-- "Customize this account" takes a full snapshot of what the account can do
-- right now and stores it as overrides, then sets this flag. From then on the
-- account is independent of its role: editing the role changes everybody else,
-- never this account. Only editing its own checklist does.
create table if not exists user_permission_profiles (
  user_id    text primary key,
  customized boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- ------------------------------------------------------------ resolvers
--
-- These run inside RLS policies, so they are SECURITY DEFINER: a policy that
-- queried the permission tables under the caller's own RLS would recurse. The
-- fixed search_path is what stops a caller shadowing `public` with their own
-- tables and changing what these functions read.

create or replace function capability_rank(c text) returns int
  language sql immutable as $$
    select case c
      when 'full'  then 4
      when 'write' then 3
      when 'use'   then 2
      when 'view'  then 1
      else 0
    end
  $$;

create or replace function is_permissions_customized(p_user text) returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce(
      (select customized from user_permission_profiles where user_id = p_user),
      false)
  $$;

/**
 * What the signed-in user may do with one module, after every layer.
 */
create or replace function effective_capability(p_module text) returns text
  language sql stable security definer set search_path = public as $$
    select case
      -- Admins hold everything and are exempt from per-account overrides.
      when clerk_role() = 'admin' then 'full'
      -- A customized account IS its overrides; the role is not consulted.
      when is_permissions_customized(clerk_user_id()) then coalesce(
        (select capability from user_module_permissions
          where user_id = clerk_user_id() and module = p_module),
        'none')
      else coalesce(
        (select capability from user_module_permissions
          where user_id = clerk_user_id() and module = p_module),
        (select capability from role_module_permissions
          where role = clerk_role() and module = p_module),
        'none')
    end
  $$;

/** Which rows of a module the signed-in user may see. */
create or replace function effective_scope(p_module text) returns text
  language sql stable security definer set search_path = public as $$
    select case
      when clerk_role() = 'admin' then 'all'
      when is_permissions_customized(clerk_user_id()) then coalesce(
        (select scope from user_module_permissions
          where user_id = clerk_user_id() and module = p_module),
        'none')
      else coalesce(
        (select scope from user_module_permissions
          where user_id = clerk_user_id() and module = p_module),
        (select scope from role_module_permissions
          where role = clerk_role() and module = p_module),
        'none')
    end
  $$;

create or replace function has_capability(p_module text, p_min text) returns boolean
  language sql stable as $$
    select capability_rank(effective_capability(p_module)) >= capability_rank(p_min)
  $$;

/** True when the user sees more than just their own rows of a module. */
create or replace function sees_all(p_module text) returns boolean
  language sql stable as $$
    select effective_scope(p_module) in ('team','all')
  $$;

-- ============================================================ RLS
--
-- The database is the last line, not the first. The route guard decides who may
-- load a URL and the API guards decide who may call an action; these policies
-- assume both have been bypassed — a browser talking straight to PostgREST with
-- a valid Clerk token — and still hold.
--
-- They read the same resolved capability the app does, so an override granted
-- to one account in Settings works all the way down rather than passing the API
-- and then being silently refused here.
--
-- Note on the role claim: `clerk_role()` reads `publicMetadata.role`, NOT the
-- top-level `role` claim. In Clerk's native Supabase integration the top-level
-- `role` is the Postgres role ("authenticated") that Supabase maps the request
-- onto; the application role travels in publicMetadata. Comparing against
-- `auth.jwt() ->> 'role'` would compare every user against "authenticated" and
-- match nobody.

alter table products                enable row level security;
alter table discount_rules          enable row level security;
alter table warehouses              enable row level security;
alter table warehouse_stock         enable row level security;
alter table subscription_plans      enable row level security;
alter table upsell_rules            enable row level security;
alter table customers               enable row level security;
alter table quotations              enable row level security;
alter table quotation_lines         enable row level security;
alter table approvals               enable row level security;
alter table negotiation_messages    enable row level security;
alter table quotation_allocations   enable row level security;
alter table config_audit_log        enable row level security;
alter table role_module_permissions enable row level security;
alter table user_module_permissions enable row level security;
alter table user_permission_profiles enable row level security;

-- ------------------------------------------------------------ config tables
--
-- Each table names the module that governs it, so an override on that module
-- reaches the table without another policy edit. Reads need `view`, writes need
-- `write`; the matrix is what decides which roles clear those bars.

do $$
declare
  t text;
  m text;
  pairs text[][] := array[
    ['products','products'],
    ['discount_rules','discountRules'],
    ['warehouses','warehouses'],
    ['warehouse_stock','warehouses'],
    ['subscription_plans','subscriptionPlans'],
    ['upsell_rules','upsellRules']
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    m := pairs[i][2];

    execute format($f$
      drop policy if exists %1$I_staff_read on %1$I;
      drop policy if exists %1$I_read on %1$I;
      create policy %1$I_read on %1$I
        for select using (has_capability(%2$L, 'view'));

      drop policy if exists %1$I_admin_write on %1$I;
      drop policy if exists %1$I_finance_write on %1$I;
      drop policy if exists %1$I_write on %1$I;
      create policy %1$I_write on %1$I
        for all
        using (has_capability(%2$L, 'write'))
        with check (has_capability(%2$L, 'write'));
    $f$, t, m);
  end loop;
end $$;

-- A portal customer holds no capability on the catalog, so the policy above
-- hides it from them — including through the embedded join the portal uses to
-- name the lines on their own quotation, which would otherwise render as
-- "Item". This opens up exactly the products on a quotation they can already
-- read, and nothing else.
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

drop policy if exists customers_read on customers;
create policy customers_read on customers
  for select using (is_staff() or portal_user_id = clerk_user_id());

-- A customer never edits their own record — the link to a Clerk user is what
-- the portal's whole access model rests on.
drop policy if exists customers_staff_write on customers;
create policy customers_staff_write on customers
  for all using (is_staff()) with check (is_staff());

-- ------------------------------------------------------------ quotations

-- The owning rep, anyone whose scope on the builder reaches past their own
-- rows, or the customer the quote was raised for.
drop policy if exists quotations_read on quotations;
create policy quotations_read on quotations
  for select using (
    (has_capability('quotationBuilder', 'view') and rep_id = clerk_user_id())
    or (has_capability('quotationBuilder', 'view') and sees_all('quotationBuilder'))
    or customer_id in (
      select id from customers where portal_user_id = clerk_user_id()
    )
  );

-- Writes are narrower than reads: an approver reviews a quotation but does not
-- edit it, and changes its status through the approvals table instead.
drop policy if exists quotations_rep_write on quotations;
drop policy if exists quotations_insert on quotations;
create policy quotations_insert on quotations
  for insert
  with check (
    has_capability('quotationBuilder', 'write') and rep_id = clerk_user_id()
    or is_admin()
  );

drop policy if exists quotations_update on quotations;
create policy quotations_update on quotations
  for update
  using (
    (has_capability('quotationBuilder', 'write') and rep_id = clerk_user_id())
    -- Approvers move a quotation between statuses without holding write on the
    -- builder itself.
    or clerk_role() in ('manager','finance','admin')
  )
  with check (
    (has_capability('quotationBuilder', 'write') and rep_id = clerk_user_id())
    or clerk_role() in ('manager','finance','admin')
  );

drop policy if exists quotations_delete on quotations;
create policy quotations_delete on quotations
  for delete
  using (
    (has_capability('quotationBuilder', 'write') and rep_id = clerk_user_id())
    or is_admin()
  );

-- ------------------------------------------------------------ quotation lines

drop policy if exists quotation_lines_via_quotation on quotation_lines;
drop policy if exists quotation_lines_read on quotation_lines;
create policy quotation_lines_read on quotation_lines
  for select using (quotation_id in (select id from quotations));

drop policy if exists quotation_lines_write on quotation_lines;
create policy quotation_lines_write on quotation_lines
  for all
  using (
    is_admin()
    or (has_capability('quotationBuilder', 'write')
        and quotation_id in (select id from quotations where rep_id = clerk_user_id()))
  )
  with check (
    is_admin()
    or (has_capability('quotationBuilder', 'write')
        and quotation_id in (select id from quotations where rep_id = clerk_user_id()))
  );

-- ------------------------------------------------------------ approvals
--
-- The important one. Reading a decision is open to anyone who can read the
-- quotation, but recording one is restricted — without this split a rep could
-- insert an `approve` row against their own deal and walk it past the desk.

drop policy if exists approvals_via_quotation on approvals;
drop policy if exists approvals_read on approvals;
create policy approvals_read on approvals
  for select using (quotation_id in (select id from quotations));

drop policy if exists approvals_insert on approvals;
create policy approvals_insert on approvals
  for insert
  with check (
    has_capability('approvals', 'write')
    -- A manager may only record a manager-level decision, finance a
    -- finance-level one; admins may record any tier. A role with no tier of its
    -- own cannot satisfy this even if granted `approvals` write, because the
    -- level column only accepts manager/finance/admin.
    and (is_admin() or level = clerk_role())
    and decided_by = clerk_user_id()
    and quotation_id in (select id from quotations)
  );

-- Deliberately no update or delete policy: an approval is an audit record.

-- ------------------------------------------------------------ negotiation

drop policy if exists negotiation_messages_via_quotation on negotiation_messages;
drop policy if exists negotiation_messages_read on negotiation_messages;
create policy negotiation_messages_read on negotiation_messages
  for select using (quotation_id in (select id from quotations));

drop policy if exists negotiation_messages_insert on negotiation_messages;
create policy negotiation_messages_insert on negotiation_messages
  for insert
  with check (
    author_id = clerk_user_id()
    and has_capability('customerPortal', 'write')
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

drop policy if exists quotation_allocations_via_quotation on quotation_allocations;
drop policy if exists quotation_allocations_read on quotation_allocations;
create policy quotation_allocations_read on quotation_allocations
  for select using (quotation_id in (select id from quotations));

drop policy if exists quotation_allocations_write on quotation_allocations;
create policy quotation_allocations_write on quotation_allocations
  for all
  using (
    (has_capability('warehouseSplit', 'write') and sees_all('warehouseSplit'))
    or (has_capability('warehouseSplit', 'write')
        and quotation_id in (select id from quotations where rep_id = clerk_user_id()))
  )
  with check (
    (has_capability('warehouseSplit', 'write') and sees_all('warehouseSplit'))
    or (has_capability('warehouseSplit', 'write')
        and quotation_id in (select id from quotations where rep_id = clerk_user_id()))
  );

-- ------------------------------------------------------------ audit log

drop policy if exists config_audit_log_staff_read on config_audit_log;
create policy config_audit_log_staff_read on config_audit_log
  for select using (is_staff());

drop policy if exists config_audit_log_admin_insert on config_audit_log;
create policy config_audit_log_admin_insert on config_audit_log
  for insert with check (is_admin() and actor_id = clerk_user_id());

-- ------------------------------------------------------------ the tables that
-- ------------------------------------------------------------ hold all this
--
-- Everyone may read the rules that apply to them, so the app can render an
-- honest "what can I do" view; only an admin may rewrite them. Writing these
-- from the browser is never necessary — the admin API uses the service path —
-- but leaving them writable by anyone would undo every policy above.

drop policy if exists role_module_permissions_read on role_module_permissions;
create policy role_module_permissions_read on role_module_permissions
  for select using (is_staff());

drop policy if exists role_module_permissions_write on role_module_permissions;
create policy role_module_permissions_write on role_module_permissions
  for all using (is_admin()) with check (is_admin());

drop policy if exists user_module_permissions_read on user_module_permissions;
create policy user_module_permissions_read on user_module_permissions
  for select using (is_admin() or user_id = clerk_user_id());

drop policy if exists user_module_permissions_write on user_module_permissions;
create policy user_module_permissions_write on user_module_permissions
  for all using (is_admin()) with check (is_admin());

drop policy if exists user_permission_profiles_read on user_permission_profiles;
create policy user_permission_profiles_read on user_permission_profiles
  for select using (is_admin() or user_id = clerk_user_id());

drop policy if exists user_permission_profiles_write on user_permission_profiles;
create policy user_permission_profiles_write on user_permission_profiles
  for all using (is_admin()) with check (is_admin());

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
