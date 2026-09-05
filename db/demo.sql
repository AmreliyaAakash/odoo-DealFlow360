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
select 'admin: audit entries',        count(*)::text from config_audit_log
union all
select 'portal: customer quote',      coalesce(max(q.reference), 'NONE')
  from quotations q
  join customers c on c.id = q.customer_id
 where c.portal_user_id = 'user_3Iu4JMClzjB6AZS4StY4pFkauyk'
   and q.status <> 'draft';
