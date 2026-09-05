-- ============================================================================
-- DealFlow360 — complete setup. Paste into Supabase → SQL Editor → Run.
-- Idempotent: every statement is guarded, so re-running is safe.
--
-- GENERATED FILE — do not edit. Source: schema.sql + seed.sql + demo.sql
-- Rebuild with: npm run db:build
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

-- Marked by the desk as currently pushed. The upsell engine ranks a promoted
-- product above an equally good one that is not.
alter table products add column if not exists promoted boolean not null default false;

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

-- Relative cost of dispatching one shipment from this site. The split engine
-- uses it only to break ties between warehouses that cover the same amount of
-- an order, so leaving it at 1 keeps the old priority-only behaviour.
alter table warehouses add column if not exists shipping_cost_weight
  numeric(8,2) not null default 1 check (shipping_cost_weight >= 0);

create table if not exists warehouse_stock (
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  available    int not null default 0 check (available >= 0),
  updated_at   timestamptz not null default now(),
  primary key (warehouse_id, product_id)
);

-- When to bring more stock in, per warehouse and product.
--
-- Separate from warehouse_stock because they answer different questions and
-- change on different clocks: stock is a fact that moves every time something
-- ships, a reorder point is a decision somebody made once. Keeping the decision
-- in the stock row would mean every shipment rewrites it.
--
-- reorder_qty is constrained above reorder_point so a delivery always clears
-- the trigger — otherwise stock lands, is still below the point, and the rule
-- fires again on the next check, forever.
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

-- Contact details the portal shows back to the customer. Kept nullable: an
-- account created from a quotation has a name long before anyone fills these in.
alter table customers add column if not exists phone   text;
alter table customers add column if not exists address text;

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

-- What the customer asked for at confirmation. A request, not a promise: the
-- promise is the allocation's ship date, and conflating the two would let a
-- date the customer typed silently become an SLA the desk never agreed to.
alter table quotations add column if not exists requested_delivery_date date;

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

-- ============================================================ catalog depth (A2)
--
-- The product screens need more than a price: a unit to quote in, a tax rate to
-- invoice at, and prose the rep can read on the detail page.

alter table products add column if not exists unit text not null default 'Each';
alter table products add column if not exists tax_pct numeric(5,2) not null default 0
  check (tax_pct between 0 and 100);
alter table products add column if not exists description text;

-- One product, several sellable shapes. Kept as attribute/value rather than a
-- generated SKU matrix: the desk thinks in "Size: S, M, L (+$10)", and exploding
-- that into rows the moment it is typed makes editing an attribute a migration.
create table if not exists product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  -- "Color", "RAM", "Manufacturer".
  attribute   text not null,
  -- The choices, in the order the desk wants them shown.
  values      text[] not null default '{}',
  -- Added to the product's list price when this variant is chosen. One figure
  -- for the attribute, because a per-value price belongs in a price list.
  extra_price numeric(12,2) not null default 0,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (product_id, attribute)
);

create index if not exists product_variants_product_id_idx
  on product_variants (product_id, position);

-- Tier and currency pricing. A rule rather than a fixed price, so a catalogue
-- price rise reaches every tier at once instead of silently leaving Gold behind.
create table if not exists price_lists (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references products(id) on delete cascade,
  -- Null product means the rule applies to the whole catalogue for that tier.
  tier        text not null
                check (tier in ('standard','silver','gold','platinum')),
  currency    text not null default 'INR',
  -- How the list price is adjusted: a percentage off, or an outright override.
  rule        text not null default 'none'
                check (rule in ('none','percent_off','fixed')),
  -- Percent for `percent_off`, absolute price for `fixed`, ignored for `none`.
  amount      numeric(12,2) not null default 0 check (amount >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists price_lists_product_id_idx on price_lists (product_id);
create index if not exists price_lists_tier_idx on price_lists (tier);

-- ============================================================ subscriptions (B7)
--
-- A running subscription, as its own record.
--
-- Derived from quotation lines it could only ever be "active": pausing or
-- cancelling one is a fact about the subscription, not about the quote that
-- created it, and a quote cannot be edited to say so after it is won.

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
  -- Where the billing dates step from, and when it next bills.
  started_at   date not null default current_date,
  next_bill_on date,
  -- Set when the status last moved away from active, for the audit trail.
  paused_at    timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists subscriptions_customer_id_idx on subscriptions (customer_id);
create index if not exists subscriptions_status_idx on subscriptions (status);
create index if not exists subscriptions_order_id_idx on subscriptions (order_id);

-- ============================================================ orders & billing (B7)
--
-- Where a quotation stops being a proposal. An order is raised from a confirmed
-- quotation and owns the money side of it: invoices, what has been paid against
-- them, and the credit notes that undo a charge without deleting the history of
-- having made it.
--
-- Kept separate from `quotations` rather than folded into its status, because
-- the two have different lifetimes. A quotation is finished the moment it is
-- won; the order it produced goes on billing for as long as the subscriptions
-- on it run.

create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  -- One order per quotation: raising it twice would bill the customer twice.
  quotation_id uuid not null unique references quotations(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  reference    text unique,
  status       text not null default 'open'
                 check (status in ('open','fulfilling','fulfilled','cancelled')),
  -- Clerk user ID of whoever raised it.
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists orders_customer_id_idx on orders (customer_id);
create index if not exists orders_status_idx on orders (status);

-- One invoice per charge. A mixed order produces several: one for the one-time
-- lines, and one per billing period per subscription — which is what keeps
-- "billed correctly and separately" true rather than a claim.
create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  reference    text unique,
  kind         text not null check (kind in ('one_time','recurring')),
  -- The period a recurring invoice covers. Null on a one-time invoice, which
  -- covers a delivery rather than a stretch of time.
  period_start date,
  period_end   date,
  due_date     date,
  total        numeric(14,2) not null default 0 check (total >= 0),
  -- Denormalised from `payments`, so a list of invoices needs no join to know
  -- what is outstanding. Recomputed on every payment.
  amount_paid  numeric(14,2) not null default 0 check (amount_paid >= 0),
  status       text not null default 'issued'
                 check (status in ('draft','issued','part_paid','paid','void')),
  issued_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists invoices_order_id_idx on invoices (order_id);
create index if not exists invoices_status_idx on invoices (status);

create table if not exists invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  -- Snapshotted, not joined: an invoice must still read correctly after the
  -- product behind it is renamed or withdrawn.
  description text not null,
  qty         numeric(12,2) not null check (qty > 0),
  unit_price  numeric(12,2) not null,
  amount      numeric(14,2) not null,
  created_at  timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_id_idx on invoice_lines (invoice_id);

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null default 'bank_transfer'
                check (method in ('bank_transfer','card','cheque','cash','other')),
  reference   text,
  -- Clerk user ID of whoever recorded it.
  recorded_by text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists payments_invoice_id_idx on payments (invoice_id);

-- A credit note reverses value without erasing the invoice that created it:
-- a cancelled subscription, a downgrade mid-cycle, a goodwill adjustment.
create table if not exists credit_notes (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  order_id   uuid not null references orders(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  reason     text not null
               check (reason in ('cancellation','downgrade','goodwill','correction')),
  note       text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_notes_order_id_idx on credit_notes (order_id);

-- ============================================================ deal health (B9)
--
-- A nudge is the action a manager takes on an alert: a note against the deal
-- saying it was chased, or escalated to whoever owns the next step. Kept as its
-- own table rather than folded into approvals, because it is not a decision —
-- nothing about the quotation changes, and the same deal may be chased twice.

create table if not exists deal_nudges (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  -- Which alert prompted it, so the dashboard can show what was acted on.
  alert        text not null check (alert in ('stalled','discount_anomaly','slipped')),
  action       text not null check (action in ('nudge','escalate')),
  note         text,
  -- Clerk user ID of whoever raised it.
  actor_id     text not null,
  actor_name   text,
  created_at   timestamptz not null default now()
);

create index if not exists deal_nudges_quotation_id_idx
  on deal_nudges (quotation_id, created_at desc);

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

-- Floor on the suggested product's own margin. A rule that would surface a
-- thin-margin add-on is better not surfaced at all; null falls back to the
-- engine's default.
alter table upsell_rules add column if not exists min_margin_pct numeric(5,2)
  check (min_margin_pct is null or min_margin_pct between 0 and 100);


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
alter table replenishment_rules     enable row level security;
alter table subscription_plans      enable row level security;
alter table upsell_rules            enable row level security;
alter table customers               enable row level security;
alter table quotations              enable row level security;
alter table quotation_lines         enable row level security;
alter table approvals               enable row level security;
alter table negotiation_messages    enable row level security;
alter table quotation_allocations   enable row level security;
alter table config_audit_log        enable row level security;
alter table product_variants        enable row level security;
alter table price_lists             enable row level security;
alter table subscriptions           enable row level security;
alter table orders                  enable row level security;
alter table invoices                enable row level security;
alter table invoice_lines           enable row level security;
alter table payments                enable row level security;
alter table credit_notes            enable row level security;
alter table deal_nudges             enable row level security;
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
    ['replenishment_rules','warehouses'],
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

-- ------------------------------------------------------------ orders & billing

-- The order side follows the quotation it came from: if you can read the
-- quotation you can read its order, and only the billing module can write.
drop policy if exists orders_read on orders;
create policy orders_read on orders
  for select using (quotation_id in (select id from quotations));

drop policy if exists orders_write on orders;
create policy orders_write on orders
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

drop policy if exists invoices_read on invoices;
create policy invoices_read on invoices
  for select using (order_id in (select id from orders));

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

drop policy if exists invoice_lines_read on invoice_lines;
create policy invoice_lines_read on invoice_lines
  for select using (invoice_id in (select id from invoices));

drop policy if exists invoice_lines_write on invoice_lines;
create policy invoice_lines_write on invoice_lines
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

-- Payments are readable with their invoice — a customer seeing what they have
-- already paid is the point — but recording one is finance's alone.
drop policy if exists payments_read on payments;
create policy payments_read on payments
  for select using (invoice_id in (select id from invoices));

drop policy if exists payments_write on payments;
create policy payments_write on payments
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

drop policy if exists credit_notes_read on credit_notes;
create policy credit_notes_read on credit_notes
  for select using (order_id in (select id from orders));

drop policy if exists credit_notes_write on credit_notes;
create policy credit_notes_write on credit_notes
  for all
  using (has_capability('billing', 'write'))
  with check (has_capability('billing', 'write'));

-- ------------------------------------------------------------ catalog depth

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

-- ------------------------------------------------------------ subscriptions

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

-- ------------------------------------------------------------ deal nudges

-- Visible with the quotation it chases, and writable by anyone who can act on
-- the deal-health dashboard. A rep sees nudges against their own deals, which is
-- the point — being chased is information they need.
drop policy if exists deal_nudges_read on deal_nudges;
create policy deal_nudges_read on deal_nudges
  for select using (quotation_id in (select id from quotations));

drop policy if exists deal_nudges_write on deal_nudges;
create policy deal_nudges_write on deal_nudges
  for all
  using (has_capability('dealHealth', 'write'))
  with check (has_capability('dealHealth', 'write'));

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

-- ============================================================ role defaults
--
-- GENERATED from lib/permissions.ts by db/build-setup.mjs. These are the
-- defaults a role starts with; an admin may edit them afterwards from Settings,
-- and re-running this file resets them to the matrix in code.
--
-- `on conflict do update` rather than `do nothing`: a rebuild is how you push
-- a matrix change out to an existing database.

insert into role_module_permissions (role, module, capability, scope) values
  ('rep', 'products', 'view', 'all'),
  ('rep', 'discountRules', 'none', 'none'),
  ('rep', 'warehouses', 'none', 'none'),
  ('rep', 'subscriptionPlans', 'none', 'none'),
  ('rep', 'upsellRules', 'none', 'none'),
  ('rep', 'reports', 'view', 'own'),
  ('rep', 'quotationBuilder', 'full', 'own'),
  ('rep', 'approvals', 'view', 'own'),
  ('rep', 'upsellPanel', 'use', 'own'),
  ('rep', 'warehouseSplit', 'write', 'own'),
  ('rep', 'billing', 'view', 'all'),
  ('rep', 'customerPortal', 'write', 'own'),
  ('rep', 'dealHealth', 'view', 'own'),
  ('manager', 'products', 'view', 'all'),
  ('manager', 'discountRules', 'write', 'all'),
  ('manager', 'warehouses', 'none', 'none'),
  ('manager', 'subscriptionPlans', 'none', 'none'),
  ('manager', 'upsellRules', 'none', 'none'),
  ('manager', 'reports', 'view', 'team'),
  ('manager', 'quotationBuilder', 'view', 'all'),
  ('manager', 'approvals', 'write', 'all'),
  ('manager', 'upsellPanel', 'none', 'none'),
  ('manager', 'warehouseSplit', 'view', 'all'),
  ('manager', 'billing', 'view', 'all'),
  ('manager', 'customerPortal', 'none', 'none'),
  ('manager', 'dealHealth', 'view', 'all'),
  ('finance', 'products', 'view', 'all'),
  ('finance', 'discountRules', 'write', 'all'),
  ('finance', 'warehouses', 'full', 'all'),
  ('finance', 'subscriptionPlans', 'full', 'all'),
  ('finance', 'upsellRules', 'none', 'none'),
  ('finance', 'reports', 'view', 'all'),
  ('finance', 'quotationBuilder', 'view', 'all'),
  ('finance', 'approvals', 'write', 'all'),
  ('finance', 'upsellPanel', 'none', 'none'),
  ('finance', 'warehouseSplit', 'full', 'all'),
  ('finance', 'billing', 'write', 'all'),
  ('finance', 'customerPortal', 'none', 'none'),
  ('finance', 'dealHealth', 'view', 'all'),
  ('customer', 'products', 'none', 'none'),
  ('customer', 'discountRules', 'none', 'none'),
  ('customer', 'warehouses', 'none', 'none'),
  ('customer', 'subscriptionPlans', 'none', 'none'),
  ('customer', 'upsellRules', 'none', 'none'),
  ('customer', 'reports', 'none', 'none'),
  ('customer', 'quotationBuilder', 'none', 'none'),
  ('customer', 'approvals', 'none', 'none'),
  ('customer', 'upsellPanel', 'none', 'none'),
  ('customer', 'warehouseSplit', 'none', 'none'),
  ('customer', 'billing', 'none', 'none'),
  ('customer', 'customerPortal', 'full', 'own'),
  ('customer', 'dealHealth', 'none', 'none'),
  ('admin', 'products', 'full', 'all'),
  ('admin', 'discountRules', 'full', 'all'),
  ('admin', 'warehouses', 'full', 'all'),
  ('admin', 'subscriptionPlans', 'full', 'all'),
  ('admin', 'upsellRules', 'full', 'all'),
  ('admin', 'reports', 'full', 'all'),
  ('admin', 'quotationBuilder', 'full', 'all'),
  ('admin', 'approvals', 'full', 'all'),
  ('admin', 'upsellPanel', 'full', 'all'),
  ('admin', 'warehouseSplit', 'full', 'all'),
  ('admin', 'billing', 'full', 'all'),
  ('admin', 'customerPortal', 'none', 'none'),
  ('admin', 'dealHealth', 'full', 'all')
on conflict (role, module) do update
  set capability = excluded.capability,
      scope      = excluded.scope,
      updated_at = now();

-- DealFlow360 seed data: discount tiers, warehouses, products, subscription plans.
-- Safe to re-run: every insert is keyed on a natural unique column.

-- ============================================================ products

insert into products (name, sku, category, list_price, cost, cadence) values
  ('Rack Server R450',        'SRV-R450',  'Servers',     714000.00, 519000.00, 'one_time'),
  ('Rack Server R650',        'SRV-R650',  'Servers',    1182000.00, 833000.00, 'one_time'),
  ('Edge Node E20',           'SRV-E20',   'Servers',     272000.00, 200000.00, 'one_time'),
  ('Core Switch 48P',         'NET-SW48',  'Networking',  391000.00, 268000.00, 'one_time'),
  ('Access Switch 24P',       'NET-SW24',  'Networking',  157000.00, 105000.00, 'one_time'),
  ('Firewall FG-200',         'NET-FW200', 'Networking',  442000.00, 306000.00, 'one_time'),
  ('NVMe Array 24TB',         'STO-N24',   'Storage',     829000.00, 612000.00, 'one_time'),
  ('Backup Vault 100TB',      'STO-B100',  'Storage',    1054000.00, 774000.00, 'one_time'),
  ('Install & Commissioning', 'SVC-INST',  'Services',    204000.00, 128000.00, 'one_time'),
  ('Support Plan Standard',   'SUB-STD',   'Support',      15300.00, 6000.00, 'monthly'),
  ('Support Plan Premium',    'SUB-PRM',   'Support',      35700.00, 14000.00, 'monthly'),
  ('Monitoring Suite',        'SUB-MON',   'Support',      22100.00, 8100.00, 'monthly')
on conflict (sku) do nothing;

-- ============================================================ discount tiers

insert into discount_rules (name, scope, scope_ref, max_discount_pct, approval_level) values
  ('Tier 1 — rep discretion',   'global',   null,         10.00, 'manager'),
  ('Tier 2 — manager sign-off', 'global',   null,         25.00, 'finance'),
  ('Tier 3 — finance sign-off', 'global',   null,         40.00, 'admin'),
  ('Services floor',            'category', 'Services',   15.00, 'finance'),
  ('Support floor',             'category', 'Support',    20.00, 'finance')
on conflict do nothing;

-- Tier ceilings. scope_ref may name a real product category (Servers, Support)
-- or one of the three kinds the builder groups by (Hardware, Service,
-- Subscription); the ceiling lookup matches either, so a rule can be written at
-- whichever level the desk thinks in.
insert into discount_rules (name, scope, scope_ref, customer_tier, max_discount_pct, approval_level) values
  ('Standard — hardware ceiling',     'category', 'Hardware',     'standard', 10.00, 'manager'),
  ('Standard — service ceiling',      'category', 'Service',      'standard', 12.00, 'manager'),
  ('Standard — subscription ceiling', 'category', 'Subscription', 'standard', 15.00, 'manager'),
  ('Silver — hardware ceiling',       'category', 'Hardware',     'silver',   12.00, 'manager'),
  ('Silver — service ceiling',        'category', 'Service',      'silver',   15.00, 'manager'),
  ('Silver — subscription ceiling',   'category', 'Subscription', 'silver',   20.00, 'manager'),
  ('Gold — hardware ceiling',         'category', 'Hardware',     'gold',     15.00, 'finance'),
  ('Gold — service ceiling',          'category', 'Service',      'gold',     20.00, 'finance'),
  ('Gold — subscription ceiling',     'category', 'Subscription', 'gold',     25.00, 'finance'),
  ('Platinum — hardware ceiling',     'category', 'Hardware',     'platinum', 20.00, 'finance'),
  ('Platinum — service ceiling',      'category', 'Service',      'platinum', 25.00, 'finance'),
  ('Platinum — subscription ceiling', 'category', 'Subscription', 'platinum', 30.00, 'finance')
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
  ('Support Standard — Monthly', 'monthly',   15300.00, 12),
  ('Support Premium — Monthly',  'monthly',   35700.00, 12),
  ('Support Standard — Annual',  'annual',   166000.00, 12),
  ('Support Premium — Annual',   'annual',   387000.00, 24),
  ('Monitoring — Quarterly',     'quarterly',  63800.00, 12)
on conflict do nothing;

-- ============================================================ demo customer
-- Set `portal_user_id` to a real Clerk user ID to exercise the portal (B8).

insert into customers (name, email, phone, address, tier, portal_user_id) values
  ('Northwind Logistics',  'ops@northwind.example',  '+91 22 4000 1180',
   E'Unit 7, Sahar Cargo Complex
Andheri East, Mumbai 400099',    'gold',     null),
  ('Helios Manufacturing', 'it@helios.example',      '+91 20 6725 3311',
   E'Plot 14, Chakan MIDC Phase II
Pune 410501',                  'silver',   null),
  ('Vertex Retail Group',  'procure@vertex.example', '+91 80 4155 9020',
   E'Prestige Tech Park, Tower C
Marathahalli, Bengaluru 560103', 'platinum', null),
  ('Bluepeak Systems',     'admin@bluepeak.example', '+91 44 2815 7744',
   E'3rd Floor, Tidel Park
Taramani, Chennai 600113',             'standard', null)
on conflict do nothing;

-- Backfill for a database seeded before contact details existed: the portal's
-- Profile tab is only worth opening if there is something in it.
update customers
   set phone   = coalesce(phone, '+91 22 4000 1180'),
       address = coalesce(address, E'Unit 7, Sahar Cargo Complex
Andheri East, Mumbai 400099')
 where name = 'Northwind Logistics';

-- ============================================================ upsell rules

-- Suggest the support subscription alongside the hardware it protects, and the
-- higher tier alongside the bigger box.
insert into upsell_rules (name, trigger_category, suggested_product_id, priority)
select 'Servers → Support Standard', 'Servers', p.id, 10
from products p where p.sku = 'SUB-STD'
on conflict (name) do nothing;

insert into upsell_rules (name, trigger_category, suggested_product_id, priority)
select 'Networking → Monitoring Suite', 'Networking', p.id, 20
from products p where p.sku = 'SUB-MON'
on conflict (name) do nothing;

insert into upsell_rules (name, trigger_product_id, suggested_product_id, priority)
select 'R650 → Support Premium', t.id, s.id, 5
from products t, products s
where t.sku = 'SRV-R650' and s.sku = 'SUB-PRM'
on conflict (name) do nothing;

insert into upsell_rules (name, trigger_category, suggested_product_id, priority)
select 'Storage → Install & Commissioning', 'Storage', p.id, 30
from products p where p.sku = 'SVC-INST'
on conflict (name) do nothing;

-- ============================================================ shipping weights
--
-- The split engine only uses these to break ties between warehouses that cover
-- the same amount of an order, so the numbers are relative, not currency.
-- Amsterdam is the cheap default; Singapore is the one you reach for last.

update warehouses set shipping_cost_weight = case code
  when 'AMS' then 1.0
  when 'FRA' then 1.4
  when 'DFW' then 2.2
  when 'SIN' then 3.0
  else 1.0
end
where code in ('AMS','FRA','DFW','SIN');

-- ============================================================ scarcity
--
-- Deliberate: with 40 units in Amsterdam every order is filled from one site and
-- the split engine has nothing to demonstrate. The R650 is made scarce enough
-- that a normal order has to be spread across warehouses, and scarcer still than
-- the total demand so a backorder appears and can be consolidated later.

update warehouse_stock ws
   set available = case w.code
         when 'AMS' then 4
         when 'FRA' then 3
         when 'DFW' then 2
         else 0
       end
  from warehouses w, products p
 where ws.warehouse_id = w.id
   and ws.product_id = p.id
   and p.sku = 'SRV-R650';

-- Premium support is stocked in one place only, so a mixed order shows the
-- engine choosing a second site for a single line rather than splitting all of them.
update warehouse_stock ws
   set available = case w.code when 'FRA' then 50 else 0 end
  from warehouses w, products p
 where ws.warehouse_id = w.id
   and ws.product_id = p.id
   and p.sku = 'SUB-PRM';

-- ============================================================ reorder rules
--
-- When to bring more stock in. Written against the stock levels set above so
-- the reorder panel opens with every health band showing rather than an empty
-- table: the R650 is below its point at all four sites, premium support is out
-- at three and healthy at the fourth, the installation service sits above its
-- point except at the smallest warehouse, and standard support lands exactly
-- on its point in Dallas — the one band the others never produce.
--
-- reorder_qty is above reorder_point in every rule, which the table also
-- enforces: a delivery that lands and leaves stock still below the point would
-- trip the rule again on the next check, forever.

insert into replenishment_rules (warehouse_id, product_id, reorder_point, reorder_qty, lead_time_days)
select w.id, p.id, 10, 25, 14
from warehouses w cross join products p
where p.sku = 'SRV-R650'
on conflict (warehouse_id, product_id) do nothing;

insert into replenishment_rules (warehouse_id, product_id, reorder_point, reorder_qty, lead_time_days)
select w.id, p.id, 5, 20, 3
from warehouses w cross join products p
where p.sku = 'SUB-PRM'
on conflict (warehouse_id, product_id) do nothing;

insert into replenishment_rules (warehouse_id, product_id, reorder_point, reorder_qty, lead_time_days)
select w.id, p.id, 10, 40, 7
from warehouses w cross join products p
where p.sku = 'SVC-INST'
on conflict (warehouse_id, product_id) do nothing;

-- Dallas holds exactly 15 of these, which is the reorder point: the "at reorder
-- point" band, which no other seeded line produces.
insert into replenishment_rules (warehouse_id, product_id, reorder_point, reorder_qty, lead_time_days)
select w.id, p.id, 15, 40, 5
from warehouses w cross join products p
where p.sku = 'SUB-STD'
on conflict (warehouse_id, product_id) do nothing;

-- ============================================================ promotions
--
-- What the desk is pushing this quarter. The upsell panel ranks these above an
-- equally good suggestion that is not promoted.

update products set promoted = true  where sku in ('SUB-PRM', 'SVC-INST');
update products set promoted = false where sku not in ('SUB-PRM', 'SVC-INST');

-- A margin floor on the rule that would otherwise surface the thinnest add-on.
update upsell_rules set min_margin_pct = 25
 where name = 'Storage → Install & Commissioning';

-- ============================================================================
-- Demo data — every role has something to look at.
--
-- Re-runnable: the block below deletes anything it previously created (matched
-- on the `Q-2026-%` reference prefix) and rebuilds it, so running setup.sql
-- twice gives the same result rather than doubling up. Quotations you raise in
-- the app get their own references and are left alone.
--
-- Totals, required approvals and risk scores are computed here with the same
-- thresholds as lib/business-logic.ts. They are stored columns the dashboards
-- read directly, so seeding them by hand with different numbers would make the
-- screens disagree with the code.
-- ============================================================================

do $$
declare
  -- Quotation owners. These are the real Clerk IDs of the four staff accounts,
  -- so the manager's team views resolve actual names instead of raw ids. Swap
  -- them for your own users' ids if you sign in as somebody else.
  v_rep     text := 'user_3ItkOpahZQEH2da0kwZVm5s8CLk';  -- rep
  v_mgr     text := 'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q';  -- manager
  v_fin     text := 'user_3IuBz8yfG8nxrMESeoGoWT8pbxU';  -- finance
  v_adm     text := 'user_3IuQrhB9aEzK2d2qndRwqeMgvmB';  -- admin
  v_portal  text := 'user_3Iu4JMClzjB6AZS4StY4pFkauyk';  -- customer (portal)

  v_spec    record;
  v_sku     text;
  v_prod    record;
  v_cust    uuid;
  v_quote   uuid;
  v_qty     int;
begin

  -- ---------------------------------------------------------------- reset
  -- Children cascade from quotations; allocations and messages go with them.
  delete from quotations where reference like 'Q-2026-%';

  -- ---------------------------------------------------------------- customers
  insert into customers (name, email) values
    ('Orion Retail',      'procurement@orion.example'),
    ('Vertex Health',     'it@vertexhealth.example'),
    ('Cobalt Energy',     'ops@cobalt.example')
  on conflict (name) do nothing;

  -- The portal customer. Their Clerk user must hold publicMetadata.role =
  -- 'customer': the RLS portal policies and the negotiation API both key on it.
  update customers
     set portal_user_id = v_portal
   where name = 'Northwind Logistics'
     and portal_user_id is distinct from v_portal;

  -- ---------------------------------------------------------------- specs
  --
  -- Discounts are chosen per rep so the manager's anomaly detector has
  -- something true to find: it flags a rep whose OPEN deals are discounted more
  -- than 5 points above their own CLOSED history, and needs at least two closed
  -- deals to call that a baseline.
  --
  --   rep      closed ~7%   open ~23%   -> flagged
  --   finance  closed ~20%  open ~31%   -> flagged
  --   manager  closed ~14%  open ~15%   -> not flagged
  --   admin    closed ~11%  open ~9%    -> not flagged
  --
  -- days_ago spreads across 84 days so the admin's 12-week volume chart is
  -- populated the whole way along, not just at the right-hand edge.

  drop table if exists demo_spec;
  create temp table demo_spec (
    ref      text,
    rep      text,
    customer text,
    status   text,
    disc     numeric,
    days_ago int,
    skus     text[],
    qty      int
  ) on commit drop;

  insert into demo_spec (ref, rep, customer, status, disc, days_ago, skus, qty) values
    -- ---- rep: a clean history, then a run of deep discounts on open deals
    ('Q-2026-0001', v_rep, 'Northwind Logistics',  'won',              5,  82, array['SRV-R450','SUB-STD'],            2),
    ('Q-2026-0002', v_rep, 'Helios Manufacturing', 'won',              8,  74, array['NET-SW48','NET-SW24'],           3),
    ('Q-2026-0003', v_rep, 'Orion Retail',         'lost',             6,  66, array['STO-N24'],                       1),
    ('Q-2026-0004', v_rep, 'Vertex Health',        'won',             10,  58, array['SRV-E20','SUB-MON'],             4),
    ('Q-2026-0005', v_rep, 'Cobalt Energy',        'won',              7,  45, array['NET-FW200','SUB-STD'],           2),
    ('Q-2026-0006', v_rep, 'Northwind Logistics',  'approved',        18,  31, array['SRV-R650','SUB-PRM'],            2),
    ('Q-2026-0007', v_rep, 'Orion Retail',         'pending_approval',22,  12, array['STO-B100','SVC-INST'],           4),
    ('Q-2026-0008', v_rep, 'Vertex Health',        'pending_approval',28,   6, array['SRV-R650','STO-N24','SUB-PRM'],  3),
    ('Q-2026-0009', v_rep, 'Cobalt Energy',        'draft',           15,   2, array['NET-SW24'],                      2),
    ('Q-2026-0010', v_rep, 'Helios Manufacturing', 'returned',        26,   4, array['SRV-R450','SUB-STD'],            3),
    ('Q-2026-0011', v_rep, 'Northwind Logistics',  'won',              9,  20, array['SRV-E20'],                       2),
    -- Newest non-draft for the portal customer: won and part-allocated, so the
    -- portal stepper sits on "Fulfilling" rather than the opening step.
    ('Q-2026-0012', v_rep, 'Northwind Logistics',  'won',             12,   3, array['SRV-R650','SUB-PRM','SVC-INST'], 3),

    -- ---- manager: steady, no drift
    ('Q-2026-0013', v_mgr, 'Orion Retail',         'won',             12,  70, array['SRV-R450'],                      2),
    ('Q-2026-0014', v_mgr, 'Cobalt Energy',        'lost',            15,  52, array['STO-N24','SUB-MON'],             1),
    ('Q-2026-0015', v_mgr, 'Vertex Health',        'approved',        16,  27, array['NET-SW48','SUB-STD'],            3),
    ('Q-2026-0016', v_mgr, 'Helios Manufacturing', 'pending_approval',14,   8, array['SRV-E20','NET-SW24'],            2),
    ('Q-2026-0017', v_mgr, 'Northwind Logistics',  'won',             13,  38, array['NET-FW200'],                     1),

    -- ---- finance: a high baseline that has crept higher still
    ('Q-2026-0018', v_fin, 'Cobalt Energy',        'won',             20,  78, array['STO-B100'],                      1),
    ('Q-2026-0019', v_fin, 'Orion Retail',         'lost',            18,  61, array['SRV-R450','SUB-STD'],            2),
    ('Q-2026-0020', v_fin, 'Vertex Health',        'rejected',        22,  40, array['SRV-R650'],                      2),
    ('Q-2026-0021', v_fin, 'Helios Manufacturing', 'pending_approval',33,   5, array['SRV-R650','STO-N24','SUB-PRM'],  4),
    ('Q-2026-0022', v_fin, 'Northwind Logistics',  'pending_approval',30,   9, array['STO-B100','SVC-INST','SUB-MON'], 3),

    -- ---- admin: a couple of house accounts
    ('Q-2026-0023', v_adm, 'Orion Retail',         'won',             10,  64, array['NET-SW24','SUB-MON'],            2),
    ('Q-2026-0024', v_adm, 'Vertex Health',        'won',             12,  48, array['SRV-E20'],                       3),
    ('Q-2026-0025', v_adm, 'Cobalt Energy',        'approved',         9,  16, array['NET-SW48','SUB-STD'],            2),
    ('Q-2026-0026', v_adm, 'Helios Manufacturing', 'draft',            0,   1, array['SRV-R450'],                      1);

  -- ---------------------------------------------------------------- quotations
  for v_spec in select * from demo_spec order by ref loop
    select id into v_cust from customers where name = v_spec.customer;

    insert into quotations (
      reference, customer_id, rep_id, status, max_discount_pct,
      valid_until, created_at, updated_at, submitted_by, submitted_at
    )
    values (
      v_spec.ref, v_cust, v_spec.rep, v_spec.status, v_spec.disc,
      (now() + interval '30 days')::date,
      now() - (v_spec.days_ago || ' days')::interval,
      now() - (v_spec.days_ago || ' days')::interval,
      case when v_spec.status = 'draft' then null else v_spec.rep end,
      case when v_spec.status = 'draft' then null
           else now() - (v_spec.days_ago || ' days')::interval end
    )
    returning id into v_quote;

    -- Quantity tapers down the line list, so a quote is not N identical rows.
    v_qty := v_spec.qty;
    foreach v_sku in array v_spec.skus loop
      select id, list_price, cost into v_prod from products where sku = v_sku;

      insert into quotation_lines (
        quotation_id, product_id, qty, discount_pct, unit_price, unit_cost
      )
      values (v_quote, v_prod.id, greatest(v_qty, 1), v_spec.disc,
              v_prod.list_price, v_prod.cost);

      v_qty := v_qty - 1;
    end loop;
  end loop;

  raise notice 'Seeded % demo quotations', (select count(*) from demo_spec);
end $$;

-- ============================================================================
-- Roll line maths into the stored totals, then derive required approvals and
-- risk exactly as lib/business-logic.ts does.
-- ============================================================================

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
where q.id = t.quotation_id and q.reference like 'Q-2026-%';

-- APPROVAL_RULES: >10% needs a manager, >25% or sub-15% margin needs finance,
-- and anything over a crore needs an admin.
update quotations q
set required_approvals = (
  select coalesce(array_agg(distinct lvl), '{}'::text[])
  from (
    select 'manager'::text as lvl where q.max_discount_pct > 10
    union all
    select 'finance' where q.max_discount_pct > 25
    union all
    select 'finance'
      where q.net_total > 0 and (q.margin_total / q.net_total) < 0.15
    union all
    select 'admin' where q.net_total > 10000000
  ) rules
)
where q.reference like 'Q-2026-%';

-- RISK_WEIGHTS: 45% discount depth, 35% margin erosion, 20% deal size.
update quotations q
set risk_score = round(100 * (
      0.45 * least(greatest(q.max_discount_pct / 40.0, 0), 1)
    + 0.35 * (case
                when q.net_total = 0 then 0
                else least(greatest(
                  (0.30 - (q.margin_total / q.net_total)) / (0.30 - 0.05), 0), 1)
              end)
    + 0.20 * least(greatest(q.net_total / 10000000.0, 0), 1)
  ))
where q.reference like 'Q-2026-%';

-- A quotation cannot sit in pending_approval with nothing to approve; if the
-- thresholds cleared it, it is simply approved.
update quotations
   set status = 'approved'
 where reference like 'Q-2026-%'
   and status = 'pending_approval'
   and cardinality(required_approvals) = 0;

-- ============================================================================
-- Approval history — fills the manager's 14-day volume chart and "approved
-- today" tile. Decisions are spread across the window deterministically.
-- ============================================================================

insert into approvals (quotation_id, level, action, reason, decided_by, decided_at)
select q.id,
       'manager',
       case q.status
         when 'rejected' then 'reject'
         when 'returned' then 'return'
         else 'approve'
       end,
       case q.status
         when 'rejected' then 'Margin below the floor for this account.'
         when 'returned' then 'Re-quote the support line at the standard tier.'
         else null
       end,
       'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q',
       -- Two land today so the "Approved Today" tile is not zero; the rest fan
       -- out across the previous fortnight.
       now() - ((row_number() over (order by q.reference) % 14) || ' days')::interval
from quotations q
where q.reference like 'Q-2026-%'
  and q.status in ('approved', 'won', 'rejected', 'returned')
  and 'manager' = any(q.required_approvals);

-- Finance sign-off on the deals that also needed a second level.
insert into approvals (quotation_id, level, action, reason, decided_by, decided_at)
select q.id, 'finance', 'approve', null,
       'user_3IuBz8yfG8nxrMESeoGoWT8pbxU',
       now() - ((row_number() over (order by q.reference) % 10) || ' days')::interval
from quotations q
where q.reference like 'Q-2026-%'
  and q.status in ('approved', 'won')
  and 'finance' = any(q.required_approvals);

-- ============================================================================
-- Fulfilment — allocations give the finance queue a spread of split states and
-- move the portal stepper past "Confirmed".
-- ============================================================================

-- One product is deliberately short, so the finance dashboard reports a real
-- backorder rather than a comfortable zero.
update warehouse_stock ws
   set available = 1
  from products p
 where p.id = ws.product_id and p.sku = 'STO-B100';

-- Fully allocated: the oldest won deals have shipped from the priority warehouse.
insert into quotation_allocations (quotation_id, product_id, warehouse_id, qty, manual)
select l.quotation_id, l.product_id, w.id, l.qty, false
from quotation_lines l
join quotations q on q.id = l.quotation_id
cross join lateral (
  select id from warehouses where active order by priority limit 1
) w
where q.reference in ('Q-2026-0001', 'Q-2026-0002', 'Q-2026-0004', 'Q-2026-0013');

-- Partly allocated: half the units committed, the rest outstanding. Q-2026-0012
-- is the portal customer's newest deal, which is what puts their stepper on
-- "Fulfilling".
insert into quotation_allocations (quotation_id, product_id, warehouse_id, qty, manual)
select l.quotation_id, l.product_id, w.id, greatest(round(l.qty / 2.0), 1), true
from quotation_lines l
join quotations q on q.id = l.quotation_id
cross join lateral (
  select id from warehouses where active order by priority offset 1 limit 1
) w
where q.reference in ('Q-2026-0012', 'Q-2026-0005', 'Q-2026-0018');

-- Q-2026-0011, Q-2026-0017, Q-2026-0023 and Q-2026-0024 are left unallocated on
-- purpose, so the queue shows every split state.

-- ============================================================================
-- Portal conversation (B8) — the customer's thread on their newest quotation.
-- ============================================================================

insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
from quotations q
cross join (values
  ('user_3ItkOpahZQEH2da0kwZVm5s8CLk', 'rep',
   'Hello — your quotation is ready. Happy to walk through any of the lines.',
   interval '3 days'),
  ('user_3Iu4JMClzjB6AZS4StY4pFkauyk', 'customer',
   'Thanks. The R650 looks high against our budget this quarter — is there any movement on it?',
   interval '2 days'),
  ('user_3ItkOpahZQEH2da0kwZVm5s8CLk', 'rep',
   'There is some room. Propose a figure on the line and I will take it to the desk.',
   interval '1 day'),
  ('user_3Iu4JMClzjB6AZS4StY4pFkauyk', 'customer',
   'Understood — I will put something forward against the server line shortly.',
   interval '6 hours')
) as m(author_id, author_kind, body, ago)
where q.reference = 'Q-2026-0012';

-- ============================================================================
-- Config audit trail — the admin dashboard's feed. Realtime inserts land on top.
-- ============================================================================

delete from config_audit_log where actor_name = 'Admin';

insert into config_audit_log
  (actor_id, actor_name, entity, entity_label, action, field, old_value, new_value, created_at)
values
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'products',           'Rack Server R650',          'update', 'list_price',       '1150000.00', '1182000.00', now() - interval '2 hours'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'discount_rules',     'Tier 2 — manager sign-off', 'update', 'max_discount_pct', '20.00',      '25.00',      now() - interval '9 hours'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'warehouses',         'Singapore DC',              'create', null,               null,         null,         now() - interval '1 day'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'subscription_plans', 'Support Premium — Annual',  'update', 'min_term_months',  '12',         '24',         now() - interval '2 days'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'products',           'Edge Node E20',             'update', 'cost',             '215000.00',  '200000.00',  now() - interval '3 days'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'warehouses',         'Dallas DC',                 'update', 'priority',         '25',         '30',         now() - interval '4 days'),
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'Admin', 'users',              'Finance — Aakash Amreliya', 'update', 'role',             'rep',        'finance',    now() - interval '6 days');

-- ============================================================================
-- Deal-health signals
--
-- The flags are computed from the rows rather than stored, so the data has to
-- make them true. Two things are arranged here that the spec block above does
-- not cover.
-- ============================================================================

-- 1. Finance needs a third settled deal before it has a discount baseline at
--    all: the detector refuses to average two quotations and call it a habit.
--    With three closed near 20%, its open deals at 30%+ read as the drift they
--    are, instead of falling back to the absolute threshold and being missed.
do $$
declare
  v_fin   text := 'user_3IuBz8yfG8nxrMESeoGoWT8pbxU';
  v_cust  uuid;
  v_prod  record;
  v_quote uuid;
begin
  select id into v_cust from customers where name = 'Vertex Health';
  select id, list_price, cost into v_prod from products where sku = 'NET-SW48';

  delete from quotations where reference = 'Q-2026-0027';

  insert into quotations (
    reference, customer_id, rep_id, status, max_discount_pct,
    subtotal, discount_total, net_total, cost_total, margin_total,
    valid_until, created_at, updated_at, submitted_by, submitted_at
  )
  values (
    'Q-2026-0027', v_cust, v_fin, 'won', 21,
    v_prod.list_price * 2,
    v_prod.list_price * 2 * 0.21,
    v_prod.list_price * 2 * 0.79,
    v_prod.cost * 2,
    v_prod.list_price * 2 * 0.79 - v_prod.cost * 2,
    (now() - interval '5 days')::date,
    now() - interval '55 days', now() - interval '55 days',
    v_fin, now() - interval '55 days'
  )
  returning id into v_quote;

  insert into quotation_lines
    (quotation_id, product_id, qty, discount_pct, unit_price, unit_cost)
  values (v_quote, v_prod.id, 2, 21, v_prod.list_price, v_prod.cost);
end $$;

-- 2. A promise that has already passed. Everything the spec block creates is
--    valid for another 30 days, so without this nothing ever shows the delivery
--    slippage flag.
update quotations
   set valid_until = (now() - interval '6 days')::date
 where reference in ('Q-2026-0006', 'Q-2026-0021');

-- Chases already filed, so the dashboard shows what acting on an alert leaves
-- behind rather than only the buttons that do it.
delete from deal_nudges where actor_name in ('Manager', 'Finance');

insert into deal_nudges
  (quotation_id, alert, action, note, actor_id, actor_name, created_at)
select q.id, v.alert, v.action, v.note,
       'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q', 'Manager',
       now() - v.ago
  from quotations q
  join (values
    ('Q-2026-0007', 'stalled', 'nudge',
     'Chased the rep — customer is mid budget cycle.', interval '2 days'),
    ('Q-2026-0021', 'discount_anomaly', 'escalate',
     'Depth is well outside the desk norm. Raised with finance.', interval '1 day')
  ) as v(ref, alert, action, note, ago) on v.ref = q.reference;

-- ============================================================================
-- Orders, invoices and payments
--
-- Raised from the confirmed quotations, following exactly the rule the billing
-- code follows: one-time lines and recurring lines never share an invoice. The
-- payments are deliberately uneven — one settled, one part paid, one untouched —
-- so the ledger has all three states to render rather than a single one.
--
-- Only three of the won quotations are ordered. The rest are left alone on
-- purpose, so the "Raise order" button on a quotation page has something real to
-- act on during a demo.
-- ============================================================================

delete from orders where reference like 'ORD-2026-%';

do $$
declare
  v_fin   text := 'user_3IuBz8yfG8nxrMESeoGoWT8pbxU';
  v_quote record;
  v_order uuid;
  v_inv   uuid;
  v_line  record;
  v_total numeric;
  v_index int;
  v_paid  numeric;
  v_ref   text;
begin
  for v_quote in
    select q.id, q.reference, q.customer_id, q.submitted_at
      from quotations q
     where q.status = 'won'
       and q.reference in ('Q-2026-0012', 'Q-2026-0005', 'Q-2026-0001')
     order by q.reference
  loop
    v_ref := 'ORD-2026-' || right(v_quote.reference, 4);

    insert into orders
      (quotation_id, customer_id, reference, status, created_by, created_at)
    values (
      v_quote.id, v_quote.customer_id, v_ref, 'fulfilling',
      v_fin, coalesce(v_quote.submitted_at, now())
    )
    returning id into v_order;

    -- ---- one-time lines: a single invoice on 30-day terms
    select coalesce(sum(l.qty * l.unit_price * (1 - l.discount_pct / 100)), 0)
      into v_total
      from quotation_lines l
      join products p on p.id = l.product_id
     where l.quotation_id = v_quote.id and p.cadence = 'one_time';

    if v_total > 0 then
      insert into invoices (order_id, reference, kind, due_date, total, issued_at)
      values (
        v_order, v_ref || '-INV', 'one_time',
        (coalesce(v_quote.submitted_at, now()) + interval '30 days')::date,
        round(v_total, 2), coalesce(v_quote.submitted_at, now())
      )
      returning id into v_inv;

      insert into invoice_lines
        (invoice_id, product_id, description, qty, unit_price, amount)
      select v_inv, p.id, p.name, l.qty, l.unit_price,
             round(l.qty * l.unit_price * (1 - l.discount_pct / 100), 2)
        from quotation_lines l
        join products p on p.id = l.product_id
       where l.quotation_id = v_quote.id and p.cadence = 'one_time';

      -- Paid in full, part paid, or untouched — one of each across the three.
      v_paid := case v_quote.reference
                  when 'Q-2026-0001' then round(v_total, 2)
                  when 'Q-2026-0005' then round(v_total * 0.4, 2)
                  else 0
                end;

      if v_paid > 0 then
        insert into payments
          (invoice_id, amount, method, reference, recorded_by, recorded_at)
        values (
          v_inv, v_paid, 'bank_transfer',
          'NEFT-' || right(v_quote.reference, 4), v_fin, now() - interval '3 days'
        );

        update invoices
           set amount_paid = v_paid,
               status = case when v_paid >= total then 'paid' else 'part_paid' end
         where id = v_inv;
      end if;
    end if;

    -- ---- recurring lines: one invoice each, covering its own first period.
    -- Separate invoices because the cadences differ, and one document cannot be
    -- right about two different periods at once.
    v_index := 0;
    for v_line in
      select l.qty, l.unit_price, l.discount_pct,
             p.id as product_id, p.name, p.cadence
        from quotation_lines l
        join products p on p.id = l.product_id
       where l.quotation_id = v_quote.id and p.cadence <> 'one_time'
       order by p.name
    loop
      v_index := v_index + 1;
      v_total := round(
        v_line.qty * v_line.unit_price * (1 - v_line.discount_pct / 100), 2);

      insert into invoices
        (order_id, reference, kind, period_start, period_end, due_date, total, issued_at)
      values (
        v_order, v_ref || '-SUB' || v_index, 'recurring',
        coalesce(v_quote.submitted_at, now())::date,
        (coalesce(v_quote.submitted_at, now())
          + (case v_line.cadence
               when 'monthly'   then interval '1 month'
               when 'quarterly' then interval '3 months'
               else interval '12 months'
             end))::date,
        coalesce(v_quote.submitted_at, now())::date,
        v_total, coalesce(v_quote.submitted_at, now())
      )
      returning id into v_inv;

      insert into invoice_lines
        (invoice_id, product_id, description, qty, unit_price, amount)
      values (
        v_inv, v_line.product_id, v_line.name,
        v_line.qty, v_line.unit_price, v_total
      );
    end loop;
  end loop;
end $$;

-- One subscription already cancelled mid-cycle, so the credit-note half of B7 is
-- visible without anyone having to cancel something first to see it.
insert into credit_notes
  (invoice_id, order_id, amount, reason, note, created_by, created_at)
select i.id, i.order_id, round(i.total * 0.5, 2), 'cancellation',
       'Quantity 1 to 0 mid-cycle',
       'user_3IuBz8yfG8nxrMESeoGoWT8pbxU', now() - interval '2 days'
  from invoices i
 where i.reference = 'ORD-2026-0001-SUB1';



-- ============================================================ catalog depth
--
-- Units, tax and prose for the product screens. Set per category rather than
-- per SKU: the desk quotes hardware by the unit and services by the day, and a
-- rule the seed can state in one line is a rule the admin can see is wrong.

update products set unit = case
  when category in ('Servers','Networking','Storage') then 'Each'
  when category = 'Services' then 'Day'
  else 'Month'
end;

update products set tax_pct = case
  when category = 'Services' then 10
  when category = 'Support'  then 0
  else 15
end;

update products
   set description = 'Catalogue item in ' || category ||
                     ', quoted per ' || lower(unit) || '.'
 where description is null;

-- ============================================================ variants
--
-- Only on the hardware that genuinely ships in more than one shape.

delete from product_variants;

insert into product_variants (product_id, attribute, values, extra_price, position)
select p.id, v.attribute, v.values, v.extra_price, v.position
  from products p
  join (values
    ('SRV-R450', 'RAM',          array['64GB','128GB','256GB'], 45000.00, 0),
    ('SRV-R450', 'Support Tier', array['Standard','Premium'],   18000.00, 1),
    ('SRV-R650', 'RAM',          array['128GB','256GB','512GB'],90000.00, 0),
    ('SRV-R650', 'Rails',        array['Static','Sliding'],      6000.00, 1),
    ('NET-SW48', 'Optics',       array['SR','LR'],              22000.00, 0),
    ('STO-N24',  'Capacity',     array['24TB','48TB'],         180000.00, 0)
  ) as v(sku, attribute, values, extra_price, position) on v.sku = p.sku;

-- ============================================================ price lists
--
-- Tier pricing as a rule, so a catalogue price rise reaches every tier at once.
-- Catalogue-wide entries (null product) set the floor; the R650 gets its own
-- keener Platinum rule, which is exactly the case the resolver has to get right.

delete from price_lists;

insert into price_lists (product_id, tier, currency, rule, amount) values
  (null, 'standard', 'INR', 'none',        0),
  (null, 'silver',   'INR', 'percent_off', 3),
  (null, 'gold',     'INR', 'percent_off', 6),
  (null, 'platinum', 'INR', 'percent_off', 9);

insert into price_lists (product_id, tier, currency, rule, amount)
select p.id, 'platinum', 'INR', 'percent_off', 12
  from products p where p.sku = 'SRV-R650';

-- ============================================================ subscriptions
--
-- One record per running plan, with a spread of states so the list screen has
-- all three to render rather than a wall of "active".

delete from subscriptions;

insert into subscriptions (
  order_id, quotation_id, customer_id, product_id, qty, unit_price,
  cadence, status, started_at, next_bill_on, paused_at, cancelled_at
)
select o.id,
       q.id,
       q.customer_id,
       p.id,
       l.qty,
       l.unit_price,
       p.cadence,
       v.status,
       (coalesce(q.submitted_at, q.created_at))::date,
       case when v.status = 'active'
            then (coalesce(q.submitted_at, q.created_at)
                  + case p.cadence
                      when 'monthly'   then interval '1 month'
                      when 'quarterly' then interval '3 months'
                      else interval '12 months'
                    end)::date
       end,
       case when v.status = 'paused'    then now() - interval '9 days' end,
       case when v.status = 'cancelled' then now() - interval '4 days' end
  from quotation_lines l
  join quotations q on q.id = l.quotation_id
  join products p on p.id = l.product_id
  left join orders o on o.quotation_id = q.id
  join (values
    ('Q-2026-0001', 'active'),
    ('Q-2026-0004', 'active'),
    ('Q-2026-0005', 'paused'),
    ('Q-2026-0011', 'active'),
    ('Q-2026-0012', 'active'),
    ('Q-2026-0023', 'cancelled')
  ) as v(ref, status) on v.ref = q.reference
 where p.cadence <> 'one_time';

-- ============================================================================
-- Verification — every line should report a non-zero count, and the per-role
-- checks below should each return at least one row.
-- ============================================================================

select 'products'         as table_name, count(*) from products
union all select 'discount_rules',       count(*) from discount_rules
union all select 'warehouses',           count(*) from warehouses
union all select 'subscription_plans',   count(*) from subscription_plans
union all select 'upsell_rules',         count(*) from upsell_rules
union all select 'customers',            count(*) from customers
union all select 'quotations',           count(*) from quotations
union all select 'quotation_lines',      count(*) from quotation_lines
union all select 'approvals',            count(*) from approvals
union all select 'quotation_allocations',count(*) from quotation_allocations
union all select 'negotiation_messages', count(*) from negotiation_messages
union all select 'config_audit_log',     count(*) from config_audit_log
union all select 'deal_nudges',           count(*) from deal_nudges
union all select 'orders',                count(*) from orders
union all select 'invoices',              count(*) from invoices
union all select 'invoice_lines',         count(*) from invoice_lines
union all select 'payments',              count(*) from payments
union all select 'credit_notes',          count(*) from credit_notes
union all select 'product_variants',      count(*) from product_variants
union all select 'price_lists',           count(*) from price_lists
union all select 'subscriptions',         count(*) from subscriptions
order by table_name;

-- What each role will see.
select 'rep: own pipeline'          as role_check, count(*)::text as value
  from quotations where rep_id = 'user_3ItkOpahZQEH2da0kwZVm5s8CLk'
union all
select 'manager: awaiting sign-off',  count(*)::text
  from quotations where status = 'pending_approval' and 'manager' = any(required_approvals)
union all
select 'finance: awaiting sign-off',  count(*)::text
  from quotations where status = 'pending_approval' and 'finance' = any(required_approvals)
union all
select 'manager: high-risk deals',    count(*)::text
  from quotations where risk_score >= 70
union all
select 'manager: decisions (14d)',    count(*)::text
  from approvals where decided_at >= now() - interval '14 days'
union all
select 'finance: committed deals',    count(*)::text
  from quotations where status in ('approved','won')
union all
select 'finance: recurring lines',    count(*)::text
  from quotation_lines l join products p on p.id = l.product_id
 where p.cadence <> 'one_time'
union all
select 'finance: outstanding invoices', count(*)::text
  from invoices where status in ('issued','part_paid')
union all
select 'finance: recurring invoices',   count(*)::text
  from invoices where kind = 'recurring'
union all
select 'manager: stalled candidates',   count(*)::text
  from quotations
 where status = 'pending_approval' and submitted_at < now() - interval '5 days'
union all
select 'admin: audit entries',        count(*)::text from config_audit_log
union all
select 'portal: customer quote',      coalesce(max(q.reference), 'NONE')
  from quotations q
  join customers c on c.id = q.customer_id
 where c.portal_user_id = 'user_3Iu4JMClzjB6AZS4StY4pFkauyk'
   and q.status <> 'draft';
