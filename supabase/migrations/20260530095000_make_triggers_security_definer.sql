-- Make ledger trigger functions SECURITY DEFINER so they bypass RLS on customer_ledger and customers tables
ALTER FUNCTION public.tg_sales_ledger() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.tg_payments_ledger() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.apply_outstanding_delta(uuid, numeric) SECURITY DEFINER SET search_path = public;
