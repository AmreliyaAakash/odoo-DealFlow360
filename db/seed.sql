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
