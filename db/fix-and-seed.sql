-- ============================================================================
-- DealFlow360 — unblock RLS and populate every role's screens.
--
-- Run AFTER db/setup.sql (which creates the tables). Idempotent: safe to re-run.
--
-- Two things happen here:
--   1. The role stops coming from the Clerk session token and starts coming from
--      a table. That removes the dependency on "Customize session token" in the
--      Clerk dashboard, which is what has been making every table return zero
--      rows for every user.
--   2. Demo data is added so each role's dashboard has something true to show.
-- ============================================================================


-- ============================================================ 1. roles in SQL

create table if not exists user_roles (
  clerk_user_id text primary key,
  email         text,
  role          text not null
                  check (role in ('admin','manager','finance','rep','customer')),
  updated_at    timestamptz not null default now()
);

alter table user_roles enable row level security;

-- Readable by any signed-in user (the row set is tiny and non-sensitive); only
-- the service role writes it directly. The admin UI writes through Clerk.
drop policy if exists user_roles_read on user_roles;
create policy user_roles_read on user_roles for select using (true);

/*
 * The role, resolved from the table rather than the JWT.
 *
 * SECURITY DEFINER so the lookup is not itself subject to RLS — otherwise every
 * policy that calls this would recurse through user_roles' own policy.
 *
 * `sub` is still taken from the token: that claim is always present, and it is
 * what ties a request to a user. Only the *role* moved.
 */
create or replace function clerk_role() returns text
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select coalesce(
      (select r.role from user_roles r where r.clerk_user_id = auth.jwt() ->> 'sub'),
      -- Falls back to the claim, so setting up the Clerk template later also works.
      auth.jwt() -> 'publicMetadata' ->> 'role'
    )
  $$;

-- The five demo accounts.
insert into user_roles (clerk_user_id, email, role) values
  ('user_3IuQrhB9aEzK2d2qndRwqeMgvmB', 'codex9600@gmail.com',         'admin'),
  ('user_3Iu6aE3DrFFtWp8WfedpZFlNl0q', 'amreliyaaakash3@gmail.com',   'manager'),
  ('user_3IuBz8yfG8nxrMESeoGoWT8pbxU', 'amreliyaaakash05@gmail.com',  'finance'),
  ('user_3ItkOpahZQEH2da0kwZVm5s8CLk', 'aakashamreliya905@gmail.com', 'rep'),
  ('user_3Iu4JMClzjB6AZS4StY4pFkauyk', 'localweb0303@gmail.com',      'customer')
on conflict (clerk_user_id) do update
  set role = excluded.role, email = excluded.email, updated_at = now();


-- ============================================================ 2. portal link
-- Gives the customer account a customers row, so /portal has something to open.

update customers
   set portal_user_id = 'user_3Iu4JMClzjB6AZS4StY4pFkauyk'
 where name = 'Northwind Logistics'
   and (portal_user_id is null
        or portal_user_id = 'user_3Iu4JMClzjB6AZS4StY4pFkauyk');


-- ============================================================ 3. demo pipeline

do $$
declare
  v_rep      text := 'user_3ItkOpahZQEH2da0kwZVm5s8CLk';
  v_manager  text := 'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q';
  v_finance  text := 'user_3IuBz8yfG8nxrMESeoGoWT8pbxU';
  v_admin    text := 'user_3IuQrhB9aEzK2d2qndRwqeMgvmB';
  v_cust     uuid;
  v_quote    uuid;
  v_prod     record;
  v_sub      record;
  v_status   text;
  v_disc     numeric;
  v_req      text[];
  v_days     int;
  i          int;
begin
  select id into v_cust from customers
   where portal_user_id = 'user_3Iu4JMClzjB6AZS4StY4pFkauyk' limit 1;
  if v_cust is null then
    select id into v_cust from customers order by name limit 1;
  end if;

  -- A recurring product guarantees the finance dashboard has MRR to show.
  select id, list_price, cost into v_sub
    from products where cadence <> 'one_time' order by list_price desc limit 1;

  ---------------------------------------------------------------- quotations
  -- Reference prefix DEMO- keeps these separable from anything you create.
  for i in 1..18 loop
    -- Spread across every status so each dashboard has rows.
    v_status := (array['draft','pending_approval','pending_approval','approved',
                       'approved','won','won','lost','returned'])[1 + (i % 9)];
    v_disc   := (array[0, 6, 12, 18, 22, 27, 33, 38, 44])[1 + (i % 9)];
    v_days   := (i * 3) % 42;

    -- Which approvals the deal needs, mirroring lib/business-logic.ts:
    -- >10% needs a manager, >25% also needs finance.
    v_req := array[]::text[];
    if v_disc > 10 then v_req := v_req || 'manager'; end if;
    if v_disc > 25 then v_req := v_req || 'finance'; end if;

    if v_status <> 'pending_approval' then
      v_req := array[]::text[];
    elsif array_length(v_req, 1) is null then
      -- A pending quote with no trigger would never appear in a queue.
      v_req := array['manager'];
    end if;

    insert into quotations (
      reference, customer_id, rep_id, status, max_discount_pct,
      required_approvals, created_at, updated_at, submitted_by, submitted_at
    )
    values (
      'DEMO-' || lpad(i::text, 3, '0'), v_cust, v_rep, v_status, v_disc,
      v_req,
      now() - (v_days || ' days')::interval,
      now() - (v_days || ' days')::interval,
      case when v_status = 'draft' then null else v_rep end,
      case when v_status = 'draft' then null
           else now() - (v_days || ' days')::interval end
    )
    on conflict (reference) do nothing
    returning id into v_quote;

    continue when v_quote is null;   -- already seeded on an earlier run

    -- Two one-time lines.
    for v_prod in
      select id, list_price, cost from products
       where cadence = 'one_time' order by random() limit 2
    loop
      insert into quotation_lines (
        quotation_id, product_id, qty, discount_pct, unit_price, unit_cost
      ) values (v_quote, v_prod.id, 1 + (i % 3), v_disc, v_prod.list_price, v_prod.cost);
    end loop;

    -- Every second committed deal carries a subscription, so MRR is non-zero.
    if v_sub.id is not null and v_status in ('approved','won') and i % 2 = 0 then
      insert into quotation_lines (
        quotation_id, product_id, qty, discount_pct, unit_price, unit_cost
      ) values (v_quote, v_sub.id, 1 + (i % 4), v_disc, v_sub.list_price, v_sub.cost);
    end if;

    v_quote := null;
  end loop;

  ---------------------------------------------------------------- totals
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
        from quotation_lines l group by l.quotation_id
    ) t
   where q.id = t.quotation_id;

  ---------------------------------------------------------------- approvals
  -- Decisions across the last fortnight, so the manager's volume chart draws.
  if not exists (select 1 from approvals) then
    insert into approvals (quotation_id, level, action, reason, decided_by, decided_at)
    select q.id,
           case when row_number() over (order by q.created_at) % 3 = 0
                then 'finance' else 'manager' end,
           case when row_number() over (order by q.created_at) % 5 = 0 then 'reject'
                when row_number() over (order by q.created_at) % 4 = 0 then 'return'
                else 'approve' end,
           'Seeded decision for the demo dataset',
           case when row_number() over (order by q.created_at) % 3 = 0
                then v_finance else v_manager end,
           now() - ((row_number() over (order by q.created_at)) || ' days')::interval
      from quotations q
     where q.status in ('approved','won','lost','returned')
       and q.reference like 'DEMO-%'
     limit 14;
  end if;

  ---------------------------------------------------------------- allocations
  -- Partial allocations give the finance fulfilment queue real split statuses.
  if not exists (select 1 from quotation_allocations) then
    insert into quotation_allocations (quotation_id, product_id, warehouse_id, qty, manual)
    select l.quotation_id, l.product_id, w.id,
           greatest(1, floor(l.qty / 2)), false
      from quotation_lines l
      join quotations q on q.id = l.quotation_id
      cross join lateral (
        select id from warehouses order by priority limit 1
      ) w
     where q.status in ('approved','won')
     limit 20;
  end if;

  ---------------------------------------------------------------- audit log
  if not exists (select 1 from config_audit_log) then
    insert into config_audit_log
      (actor_id, actor_name, entity, entity_id, entity_label, action, field, old_value, new_value, created_at)
    values
      (v_admin, 'Admin', 'products', null, 'Rack Server R450', 'update', 'list_price', '700000', '714000', now() - interval '2 days'),
      (v_admin, 'Admin', 'discount_rules', null, 'Tier 2 — manager sign-off', 'update', 'max_discount_pct', '20', '25', now() - interval '4 days'),
      (v_admin, 'Admin', 'warehouses', null, 'Singapore DC', 'create', null, null, null, now() - interval '6 days'),
      (v_admin, 'Admin', 'subscription_plans', null, 'Support Premium — Annual', 'update', 'unit_price', '350000', '387000', now() - interval '8 days'),
      (v_admin, 'Admin', 'users', v_rep, 'aakashamreliya905@gmail.com', 'update', 'role', 'none', 'rep', now() - interval '10 days');
  end if;
end $$;


-- ============================================================ 4. verification

select 'user_roles'        as table_name, count(*) from user_roles
union all select 'products',              count(*) from products
union all select 'customers (linked)',    count(*) from customers where portal_user_id is not null
union all select 'quotations',            count(*) from quotations
union all select 'quotation_lines',       count(*) from quotation_lines
union all select 'pending_approval',      count(*) from quotations where status = 'pending_approval'
union all select 'approvals',             count(*) from approvals
union all select 'allocations',           count(*) from quotation_allocations
union all select 'audit_log',             count(*) from config_audit_log
order by table_name;
