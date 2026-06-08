
-- 1. Fix mutable search_path on settlement_calc
CREATE OR REPLACE FUNCTION public.settlement_calc()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.submitted_amount := COALESCE(NEW.collection_amount, 0) - COALESCE(NEW.commission_kept, 0);
  RETURN NEW;
END $function$;

-- 2. Make current_agency_id deterministic
CREATE OR REPLACE FUNCTION public.current_agency_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT agency_id FROM public.agency_users
  WHERE user_id = auth.uid() AND is_active = true AND agency_id IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1;
$function$;

-- 3. Lock down EXECUTE privileges on SECURITY DEFINER + trigger functions.
-- Trigger functions: never called directly by clients.
REVOKE ALL ON FUNCTION public.tg_sales_compute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payments_txn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_expenses_txn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_customers_txn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payments_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_sales_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settlement_calc() FROM PUBLIC, anon, authenticated;

-- Internal helpers (only triggers should call): revoke from clients.
REVOKE ALL ON FUNCTION public.apply_outstanding_delta(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_txn_no(uuid, text) FROM PUBLIC, anon, authenticated;

-- Helpers used by RLS policies must remain callable by authenticated, never anon.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.current_agency_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_agency_id() TO authenticated;

REVOKE ALL ON FUNCTION public.platform_admin_exists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_exists() TO authenticated;
