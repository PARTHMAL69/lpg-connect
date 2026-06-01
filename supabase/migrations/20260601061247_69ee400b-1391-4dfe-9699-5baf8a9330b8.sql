-- Fix tg_sales_ledger to debit customer with GROSS amount (full invoice),
-- not NET amount. Commission is the agency's expense, never reduces customer debt.
CREATE OR REPLACE FUNCTION public.tg_sales_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_debit NUMERIC := 0; new_debit NUMERIC := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', NEW.gross_amount, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, NEW.gross_amount);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.payment_mode = 'credit' AND NOT OLD.is_deleted AND OLD.customer_id IS NOT NULL THEN
      old_debit := OLD.gross_amount;
      PERFORM public.apply_outstanding_delta(OLD.customer_id, -old_debit);
    END IF;
    DELETE FROM public.customer_ledger WHERE sale_id = NEW.id;
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      new_debit := NEW.gross_amount;
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', new_debit, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, new_debit);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.payment_mode = 'credit' AND NOT OLD.is_deleted AND OLD.customer_id IS NOT NULL THEN
      PERFORM public.apply_outstanding_delta(OLD.customer_id, -OLD.gross_amount);
    END IF;
    DELETE FROM public.customer_ledger WHERE sale_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $function$;

-- BACKFILL: existing credit-sale ledger rows were debited with net_amount.
-- Update them to gross_amount.
UPDATE public.customer_ledger cl
SET debit = s.gross_amount
FROM public.sales s
WHERE cl.sale_id = s.id
  AND cl.kind = 'sale_credit'
  AND cl.debit <> s.gross_amount;

-- BACKFILL: recompute every customer's outstanding_balance from their ledger.
UPDATE public.customers c
SET outstanding_balance = COALESCE(t.balance, 0)
FROM (
  SELECT customer_id, SUM(debit) - SUM(credit) AS balance
  FROM public.customer_ledger
  GROUP BY customer_id
) t
WHERE c.id = t.customer_id;

-- Customers with no ledger entries -> outstanding should be 0
UPDATE public.customers
SET outstanding_balance = 0
WHERE id NOT IN (SELECT DISTINCT customer_id FROM public.customer_ledger)
  AND outstanding_balance <> 0;