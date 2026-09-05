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

insert into customers (name, email, tier, portal_user_id) values
  ('Northwind Logistics',  'ops@northwind.example',  'gold',     null),
  ('Helios Manufacturing', 'it@helios.example',      'silver',   null),
  ('Vertex Retail Group',  'procure@vertex.example', 'platinum', null),
  ('Bluepeak Systems',     'admin@bluepeak.example', 'standard', null)
on conflict do nothing;

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
