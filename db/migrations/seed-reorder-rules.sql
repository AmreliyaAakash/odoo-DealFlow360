-- Sample reorder rules, to run AFTER db/repair.sql has created the table.
--
-- Structure lives in db/schema.sql and reaches an existing database through
-- db/repair.sql; this file deliberately contains no DDL, so there is only ever
-- one definition of the table to keep in step.
--
-- repair.sql leaves your rows alone, which also means it adds no reorder rules.
-- Without at least one, the "Needs reordering" panel has nothing to check and
-- reads as empty. These four match the stock levels db/seed.sql sets, so the
-- panel opens with every health band showing.
--
-- Skips any pair that already has a rule, so it is safe to re-run and safe on a
-- database where somebody has added their own.
--
--   psql "$DATABASE_URL" -f db/migrations/seed-reorder-rules.sql
-- or paste into Supabase → SQL Editor → Run.

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
