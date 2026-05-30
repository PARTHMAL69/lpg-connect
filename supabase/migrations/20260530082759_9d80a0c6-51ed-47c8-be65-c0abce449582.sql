
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;
ALTER FUNCTION public.tg_sales_compute() SET search_path = public;
ALTER FUNCTION public.tg_payments_txn() SET search_path = public;
ALTER FUNCTION public.tg_expenses_txn() SET search_path = public;
ALTER FUNCTION public.tg_customers_txn() SET search_path = public;
ALTER FUNCTION public.tg_sales_ledger() SET search_path = public;
ALTER FUNCTION public.tg_payments_ledger() SET search_path = public;
ALTER FUNCTION public.apply_outstanding_delta(uuid, numeric) SET search_path = public;

-- Revoke broad execute on SECURITY DEFINER helpers; allow authenticated only where needed.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_agency_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_admin_exists() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_txn_no(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_agency_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_exists() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_txn_no(uuid, text) TO service_role;
