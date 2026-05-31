-- =========================================================================
-- REDEFINE SALES LEDGER TRIGGER TO USE GROSS_AMOUNT FOR CUSTOMER OUTSTANDING
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tg_sales_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_credit NUMERIC := 0; new_credit NUMERIC := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', NEW.gross_amount, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, NEW.gross_amount);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- reverse old effect (was based on old gross_amount)
    IF OLD.payment_mode = 'credit' AND NOT OLD.is_deleted AND OLD.customer_id IS NOT NULL THEN
      old_credit := OLD.gross_amount;
      PERFORM public.apply_outstanding_delta(OLD.customer_id, -old_credit);
    END IF;
    DELETE FROM public.customer_ledger WHERE sale_id = NEW.id;
    -- apply new effect (based on new gross_amount)
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      new_credit := NEW.gross_amount;
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', new_credit, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, new_credit);
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
END; $$;


-- =========================================================================
-- LPG STOCK MANAGEMENT TABLES
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.product_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE UNIQUE,
  opening_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'purchase', 'adjustment', 'transfer', 'sale')),
  quantity NUMERIC(12,2) NOT NULL,
  reference TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- RLS policies for multi-tenant isolation
ALTER TABLE public.product_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_stocks_agency ON public.product_stocks FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY stock_ledger_agency ON public.stock_ledger FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_stocks TO authenticated;
GRANT ALL ON public.product_stocks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_ledger TO authenticated;
GRANT ALL ON public.stock_ledger TO service_role;
