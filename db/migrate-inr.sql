-- ============================================================================
-- Rescale existing money columns from dollar-magnitude figures to rupees.
-- Run ONCE, only if you seeded before the INR switch. Idempotent by guard:
-- it refuses to run a second time.
-- ============================================================================

do $$
declare
  v_rate numeric := 85;
begin
  -- Guard: a rack server under ₹1,00,000 means the old dollar figures are still
  -- in place. If prices already look like rupees, do nothing.
  if not exists (
    select 1 from products where sku = 'SRV-R450' and list_price < 100000
  ) then
    raise notice 'Prices already in rupees; nothing to do.';
    return;
  end if;

  update products
     set list_price = round(list_price * v_rate, -2),
         cost       = round(cost       * v_rate, -2);

  update subscription_plans
     set unit_price = round(unit_price * v_rate, -2);

  -- Line snapshots hold their own copy of price and cost.
  update quotation_lines
     set unit_price = round(unit_price * v_rate, -2),
         unit_cost  = round(unit_cost  * v_rate, -2);

  -- Recompute quotation totals from the rescaled lines.
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
  where q.id = t.quotation_id;

  raise notice 'Rescaled products, plans, lines and quotation totals to INR.';
end $$;

-- Verification
select sku, list_price, cost from products order by list_price desc limit 5;
select reference, net_total, margin_total from quotations order by net_total desc limit 5;
