-- ============================================================================
-- Portal demo data — the customer's side, with something in every state.
--
-- Run AFTER db/demo.sql. That file rebuilds everything matching 'Q-2026-%',
-- which includes these rows, so the order is: demo.sql, then this. Re-runnable
-- on its own: it deletes and rebuilds only the 'Q-2026-01%' block it owns.
--
-- Why this exists. Northwind Logistics — the portal account — already had six
-- quotations from demo.sql, but every one of them was `won` or waiting on the
-- desk, and four of the six sat on the same step of the stepper. Signing in as
-- the customer showed one quote, one stage, and one conversation, so most of
-- the portal could not be seen at all without editing the database by hand.
--
-- What it adds:
--
--   * six more Northwind quotations covering every portal state that is
--     reachable — sent, under negotiation, returned for rework, confirmed,
--     fulfilling, and closed;
--   * conversations on most of them, including two amended messages, so the
--     "edited" marker and the thread's own history are visible;
--   * a rejected quote, so the closed banner has something to render.
--
-- One state is deliberately absent: Billed, the stepper's last step. Nothing
-- seeded here can reach it, and nothing entered through the app can either.
-- `portalStage` promotes a fully allocated deal to Billed when
-- `firstBillDate <= now`, but the value it is given comes from
-- `nextBillingDate(line, now)`, which by contract steps forward "until it lands
-- after `from`" — so the date is always in the future and the comparison is
-- never true. Passing the first bill date from the anchor, rather than the next
-- one from today, is what would make that step reachable. Left alone here
-- because it is a change to shared billing logic, not to seed data.
--
-- Totals, required approvals and risk are recomputed at the end with the same
-- thresholds as lib/business-logic.ts, exactly as demo.sql does — these are
-- stored columns the screens read directly, so seeding them by hand with
-- different arithmetic would make the UI disagree with the code.
--
--   Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================

do $$
declare
  -- The same Clerk accounts demo.sql uses. Swap them if you sign in as
  -- somebody else; nothing below depends on the literal values.
  v_rep    text := 'user_3ItkOpahZQEH2da0kwZVm5s8CLk';
  v_mgr    text := 'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q';
  v_portal text := 'user_3Iu4JMClzjB6AZS4StY4pFkauyk';

  v_spec  record;
  v_sku   text;
  v_prod  record;
  v_cust  uuid;
  v_quote uuid;
  v_qty   int;
  v_wh    uuid;
begin

  select id into v_cust from customers where name = 'Northwind Logistics';

  if v_cust is null then
    raise exception 'Northwind Logistics is missing — run db/seed.sql first.';
  end if;

  -- The portal customer must be linked, or none of this is reachable when
  -- signed in as them: the RLS portal policies key on portal_user_id.
  update customers
     set portal_user_id = v_portal
   where id = v_cust
     and portal_user_id is distinct from v_portal;

  -- ---------------------------------------------------------------- reset
  -- Children (lines, allocations, messages) cascade from quotations.
  delete from quotations where reference like 'Q-2026-01%';

  -- ---------------------------------------------------------------- specs
  --
  -- `stage` is a note to the reader, not a column: the portal derives the step
  -- from status, message count and allocation, so each row here is built to
  -- land on the stage named beside it.

  drop table if exists portal_spec;
  create temp table portal_spec (
    ref      text,
    rep      text,
    status   text,
    disc     numeric,
    days_ago int,
    skus     text[],
    qty      int,
    stage    text
  ) on commit drop;

  insert into portal_spec (ref, rep, status, disc, days_ago, skus, qty, stage) values
    -- Just landed, nothing said yet: the opening step, and the one state the
    -- portal previously had no example of.
    ('Q-2026-0101', v_rep, 'approved',         8, 2, array['NET-SW24','SUB-STD'],            2, 'sent'),

    -- A live back-and-forth. Messages alone move the stepper to negotiation.
    ('Q-2026-0102', v_rep, 'pending_approval',24, 7, array['SRV-R650','STO-N24','SUB-PRM'],  3, 'negotiation'),

    -- Sent back to the rep for rework, which reads to the customer as the same
    -- open conversation.
    ('Q-2026-0103', v_mgr, 'returned',        19, 5, array['SRV-R450','SVC-INST'],           2, 'negotiation'),

    -- Agreed, nothing committed from a warehouse yet.
    ('Q-2026-0104', v_rep, 'won',             11,14, array['SRV-E20','SUB-MON'],             4, 'confirmed'),

    -- Fully allocated and long settled. This is as far as the stepper goes:
    -- see the note at the top of this file about the Billed step.
    ('Q-2026-0105', v_rep, 'won',              9,52, array['NET-FW200','SUB-MON','SVC-INST'],3, 'fulfilled'),

    -- Closed. The stepper stops and the customer is told plainly.
    ('Q-2026-0106', v_mgr, 'rejected',        31, 21, array['STO-B100','SUB-PRM'],           2, 'closed');

  -- ---------------------------------------------------------------- quotations
  for v_spec in select * from portal_spec order by ref loop

    insert into quotations (
      reference, customer_id, rep_id, status, max_discount_pct,
      valid_until, created_at, updated_at, submitted_by, submitted_at,
      requested_delivery_date
    )
    values (
      v_spec.ref, v_cust, v_spec.rep, v_spec.status, v_spec.disc,
      -- The closed quote is left expired; everything else is still live, so the
      -- portal does not show a "promise date passed" warning on a healthy deal.
      case when v_spec.stage = 'closed'
           then (now() - interval '5 days')::date
           else (now() + interval '30 days')::date end,
      now() - (v_spec.days_ago || ' days')::interval,
      now() - (v_spec.days_ago || ' days')::interval,
      v_spec.rep,
      now() - (v_spec.days_ago || ' days')::interval,
      -- Only a confirmed deal has a date the customer asked for.
      case when v_spec.status = 'won'
           then (now() + interval '21 days')::date
           else null end
    )
    returning id into v_quote;

    -- Quantity tapers down the line list, so a quote is not N identical rows.
    v_qty := v_spec.qty;
    foreach v_sku in array v_spec.skus loop
      select id, list_price, cost into v_prod from products where sku = v_sku;

      if v_prod.id is not null then
        insert into quotation_lines (
          quotation_id, product_id, qty, discount_pct, unit_price, unit_cost
        )
        values (v_quote, v_prod.id, greatest(v_qty, 1), v_spec.disc,
                v_prod.list_price, v_prod.cost);

        v_qty := v_qty - 1;
      end if;
    end loop;

    -- ------------------------------------------------------------ allocation
    --
    -- Only this one is committed, and it is committed in full. `portalStage`
    -- reads fulfilment from real allocation rows rather than a status column,
    -- so demo.sql's half-allocated Q-2026-0012 and this fully-allocated one
    -- both render as Fulfilling.
    if v_spec.stage = 'fulfilled' then
      select id into v_wh from warehouses where active order by priority limit 1;

      insert into quotation_allocations (quotation_id, product_id, warehouse_id, qty, manual)
      select l.quotation_id, l.product_id, v_wh, l.qty, false
      from quotation_lines l
      where l.quotation_id = v_quote;
    end if;

  end loop;

  raise notice 'Seeded % portal quotations', (select count(*) from portal_spec);
end $$;

-- ============================================================================
-- Conversations
--
-- Written as one insert per quotation so each thread reads like a real
-- exchange rather than the same four lines repeated. `edited_at` is set on two
-- of them, which is the only way to see the "edited" marker without waiting for
-- somebody to amend a message by hand.
-- ============================================================================

do $$
declare
  v_rep    text := 'user_3ItkOpahZQEH2da0kwZVm5s8CLk';
  v_mgr    text := 'user_3Iu6aE3DrFFtWp8WfedpZFlNl0q';
  v_portal text := 'user_3Iu4JMClzjB6AZS4StY4pFkauyk';
  v_has_edited boolean;
begin

  -- The edit column only exists once db/migrations/003-negotiation-chat.sql has
  -- run. Seeding is not a reason to require it, so the two amended messages are
  -- inserted unmarked when it is absent.
  select exists (
    select 1 from information_schema.columns
    where table_name = 'negotiation_messages' and column_name = 'edited_at'
  ) into v_has_edited;

  -- ---- Q-2026-0102: the negotiation example, and the longest thread.
  insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
  select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
  from quotations q
  cross join (values
    (v_rep::text, 'rep', 'Quotation is with you. It covers the R650 pair, the 24-bay array and premium support for the year.', interval '7 days'),
    (v_portal::text, 'customer', 'Received, thank you. Two questions: can the array ship ahead of the servers, and is the support term negotiable to 18 months?', interval '6 days'),
    (v_rep::text, 'rep', 'The array can ship separately — I will note it against the line. Support below 24 months needs sign-off, so I have put it to the desk.', interval '5 days'),
    (v_portal::text, 'customer', 'Appreciated. Our board reviews capital spend on the 14th, so an answer before then would help.', interval '4 days'),
    (v_rep::text, 'rep', 'Understood. The discount on this one crosses our second tier, so finance is reviewing it — I should have something back well before the 14th.', interval '2 days'),
    (v_portal::text, 'customer', 'Perfect. Holding for that.', interval '18 hours')
  ) as m(author_id, author_kind, body, ago)
  where q.reference = 'Q-2026-0102';

  -- ---- Q-2026-0103: returned for rework, with an amended message.
  insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
  select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
  from quotations q
  cross join (values
    (v_portal::text, 'customer', 'The installation line reads as a single visit — we have three sites, so this will need revising.', interval '5 days'),
    (v_mgr::text, 'rep', 'You are right, that was scoped for one site. I have sent it back to be rebuilt for three — the figure will change.', interval '4 days'),
    (v_portal::text, 'customer', 'Three sites: Bhiwandi, Pune and the new Nashik depot. Nashik is not live until March.', interval '3 days'),
    (v_mgr::text, 'rep', 'Noted, all three. I will phase the Nashik visit so you are not paying for it ahead of the site opening.', interval '2 days')
  ) as m(author_id, author_kind, body, ago)
  where q.reference = 'Q-2026-0103';

  -- ---- Q-2026-0104: short and settled.
  insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
  select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
  from quotations q
  cross join (values
    (v_portal::text, 'customer', 'Approved on our side. Delivery in three weeks works.', interval '13 days'),
    (v_rep::text, 'rep', 'Confirmed — thank you. I will let you know as soon as stock is committed against it.', interval '12 days')
  ) as m(author_id, author_kind, body, ago)
  where q.reference = 'Q-2026-0104';

  -- ---- Q-2026-0105: the completed one, kept for the record.
  insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
  select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
  from quotations q
  cross join (values
    (v_rep::text, 'rep', 'Everything on this order has shipped from Mumbai. First support invoice is raised against the monthly line.', interval '40 days'),
    (v_portal::text, 'customer', 'All received and racked. No issues.', interval '38 days')
  ) as m(author_id, author_kind, body, ago)
  where q.reference = 'Q-2026-0105';

  -- ---- Q-2026-0106: how a deal ends, from the customer's side.
  insert into negotiation_messages (quotation_id, author_id, author_kind, body, created_at)
  select q.id, m.author_id, m.author_kind, m.body, now() - m.ago
  from quotations q
  cross join (values
    (v_portal::text, 'customer', 'We have had to pause this project — the budget moved to the next financial year.', interval '20 days'),
    (v_mgr::text, 'rep', 'Understood, and thank you for telling us early. I will close this one off; say the word and we will rebuild it at current pricing when you are ready.', interval '19 days')
  ) as m(author_id, author_kind, body, ago)
  where q.reference = 'Q-2026-0106';

  -- ---- Two amended messages, so the "edited" marker has something to show.
  if v_has_edited then
    update negotiation_messages m
       set body = 'Received, thank you. Two questions: can the array ship ahead of the servers, and is the support term negotiable to 18 months? (Correction: 18 months, not 12 — mis-typed.)',
           edited_at = now() - interval '5 days 20 hours'
      from quotations q
     where q.id = m.quotation_id
       and q.reference = 'Q-2026-0102'
       and m.author_kind = 'customer'
       and m.body like 'Received, thank you.%';

    update negotiation_messages m
       set body = 'Three sites: Bhiwandi, Pune and the new Nashik depot. Nashik is not live until March — please phase that visit.',
           edited_at = now() - interval '2 days 12 hours'
      from quotations q
     where q.id = m.quotation_id
       and q.reference = 'Q-2026-0103'
       and m.author_kind = 'customer'
       and m.body like 'Three sites:%';
  else
    raise notice 'edited_at not present — run db/migrations/003-negotiation-chat.sql to see the edit marker.';
  end if;

end $$;

-- ============================================================================
-- Stored totals, approvals and risk — the same arithmetic as demo.sql, applied
-- to this block only. See lib/business-logic.ts for the thresholds.
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
where q.id = t.quotation_id and q.reference like 'Q-2026-01%';

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
where q.reference like 'Q-2026-01%';

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
where q.reference like 'Q-2026-01%';

-- ============================================================================
-- Check: what the portal customer can now see, and on which step.
-- ============================================================================

select q.reference,
       q.status,
       q.max_discount_pct                                  as discount_pct,
       q.net_total,
       (select count(*) from quotation_lines l where l.quotation_id = q.id)       as lines,
       (select count(*) from negotiation_messages m where m.quotation_id = q.id)  as messages,
       (select coalesce(sum(a.qty), 0) from quotation_allocations a
         where a.quotation_id = q.id)                                            as allocated
from quotations q
join customers c on c.id = q.customer_id
where c.name = 'Northwind Logistics'
order by q.created_at desc;
