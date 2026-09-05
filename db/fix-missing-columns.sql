-- ============================================================================
-- DealFlow360 - Add missing columns and constraints
-- Run this in your Supabase SQL Editor to make sure all schema extensions are active.
-- ============================================================================

-- 1. Products: promoted flag for upsell engine
alter table products add column if not exists promoted boolean not null default false;

-- 2. Customers: commercial tier
alter table customers add column if not exists tier text not null default 'standard';
do $$ begin
  alter table customers add constraint customers_tier_check
    check (tier in ('standard','silver','gold','platinum'));
exception when duplicate_object then null; end $$;

-- 3. Discount Rules: customer tier scoping
alter table discount_rules add column if not exists customer_tier text;
do $$ begin
  alter table discount_rules add constraint discount_rules_customer_tier_check
    check (customer_tier is null
           or customer_tier in ('standard','silver','gold','platinum'));
exception when duplicate_object then null; end $$;

-- 4. Warehouses: shipping cost weight
alter table warehouses add column if not exists shipping_cost_weight
  numeric(8,2) not null default 1 check (shipping_cost_weight >= 0);

-- 5. Quotation lines: subscription plan linkage
alter table quotation_lines add column if not exists subscription_plan_id uuid;
do $$ begin
  alter table quotation_lines add constraint quotation_lines_subscription_plan_id_fkey
    foreign key (subscription_plan_id) references subscription_plans(id);
exception when duplicate_object then null; end $$;

-- 6. Upsell rules: min margin pct
alter table upsell_rules add column if not exists min_margin_pct numeric(5,2)
  check (min_margin_pct is null or min_margin_pct between 0 and 100);
