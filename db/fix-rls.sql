-- ============================================================================
-- DealFlow360 — Unblock RLS for Application Reads & Writes
-- Paste into Supabase → SQL Editor → Run
-- ============================================================================

-- Allow reading all rows so Next.js server and dashboards can display data
drop policy if exists allow_all_read_products on products;
create policy allow_all_read_products on products for select using (true);

drop policy if exists allow_all_write_products on products;
create policy allow_all_write_products on products for all using (true) with check (true);

drop policy if exists allow_all_read_warehouses on warehouses;
create policy allow_all_read_warehouses on warehouses for select using (true);

drop policy if exists allow_all_write_warehouses on warehouses;
create policy allow_all_write_warehouses on warehouses for all using (true) with check (true);

drop policy if exists allow_all_read_warehouse_stock on warehouse_stock;
create policy allow_all_read_warehouse_stock on warehouse_stock for select using (true);

drop policy if exists allow_all_write_warehouse_stock on warehouse_stock;
create policy allow_all_write_warehouse_stock on warehouse_stock for all using (true) with check (true);

drop policy if exists allow_all_read_discount_rules on discount_rules;
create policy allow_all_read_discount_rules on discount_rules for select using (true);

drop policy if exists allow_all_write_discount_rules on discount_rules;
create policy allow_all_write_discount_rules on discount_rules for all using (true) with check (true);

drop policy if exists allow_all_read_subscription_plans on subscription_plans;
create policy allow_all_read_subscription_plans on subscription_plans for select using (true);

drop policy if exists allow_all_write_subscription_plans on subscription_plans;
create policy allow_all_write_subscription_plans on subscription_plans for all using (true) with check (true);

drop policy if exists allow_all_read_upsell_rules on upsell_rules;
create policy allow_all_read_upsell_rules on upsell_rules for select using (true);

drop policy if exists allow_all_write_upsell_rules on upsell_rules;
create policy allow_all_write_upsell_rules on upsell_rules for all using (true) with check (true);

drop policy if exists allow_all_read_customers on customers;
create policy allow_all_read_customers on customers for select using (true);

drop policy if exists allow_all_write_customers on customers;
create policy allow_all_write_customers on customers for all using (true) with check (true);

drop policy if exists allow_all_read_quotations on quotations;
create policy allow_all_read_quotations on quotations for select using (true);

drop policy if exists allow_all_write_quotations on quotations;
create policy allow_all_write_quotations on quotations for all using (true) with check (true);

drop policy if exists allow_all_read_quotation_lines on quotation_lines;
create policy allow_all_read_quotation_lines on quotation_lines for select using (true);

drop policy if exists allow_all_write_quotation_lines on quotation_lines;
create policy allow_all_write_quotation_lines on quotation_lines for all using (true) with check (true);

drop policy if exists allow_all_read_approvals on approvals;
create policy allow_all_read_approvals on approvals for select using (true);

drop policy if exists allow_all_write_approvals on approvals;
create policy allow_all_write_approvals on approvals for all using (true) with check (true);

drop policy if exists allow_all_read_quotation_allocations on quotation_allocations;
create policy allow_all_read_quotation_allocations on quotation_allocations for select using (true);

drop policy if exists allow_all_write_quotation_allocations on quotation_allocations;
create policy allow_all_write_quotation_allocations on quotation_allocations for all using (true) with check (true);

drop policy if exists allow_all_read_negotiation_messages on negotiation_messages;
create policy allow_all_read_negotiation_messages on negotiation_messages for select using (true);

drop policy if exists allow_all_write_negotiation_messages on negotiation_messages;
create policy allow_all_write_negotiation_messages on negotiation_messages for all using (true) with check (true);

drop policy if exists allow_all_read_config_audit_log on config_audit_log;
create policy allow_all_read_config_audit_log on config_audit_log for select using (true);

drop policy if exists allow_all_write_config_audit_log on config_audit_log;
create policy allow_all_write_config_audit_log on config_audit_log for all using (true) with check (true);

drop policy if exists allow_all_read_role_module_permissions on role_module_permissions;
create policy allow_all_read_role_module_permissions on role_module_permissions for select using (true);

drop policy if exists allow_all_write_role_module_permissions on role_module_permissions;
create policy allow_all_write_role_module_permissions on role_module_permissions for all using (true) with check (true);

drop policy if exists allow_all_read_user_module_permissions on user_module_permissions;
create policy allow_all_read_user_module_permissions on user_module_permissions for select using (true);

drop policy if exists allow_all_write_user_module_permissions on user_module_permissions;
create policy allow_all_write_user_module_permissions on user_module_permissions for all using (true) with check (true);

drop policy if exists allow_all_read_user_permission_profiles on user_permission_profiles;
create policy allow_all_read_user_permission_profiles on user_permission_profiles for select using (true);

drop policy if exists allow_all_write_user_permission_profiles on user_permission_profiles;
create policy allow_all_write_user_permission_profiles on user_permission_profiles for all using (true) with check (true);
