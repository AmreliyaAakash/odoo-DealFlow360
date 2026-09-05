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
