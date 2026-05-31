-- =====================================================
-- Migration: Add Delivery Settlements Table & Triggers
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_boy_id UUID NOT NULL REFERENCES public.delivery_boys(id) ON DELETE RESTRICT,
  collection_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_kept NUMERIC(14,2) NOT NULL DEFAULT 0,
  submitted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  remarks TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

-- Settlement auto-compute submitted amount
CREATE OR REPLACE FUNCTION public.settlement_calc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.submitted_amount := COALESCE(NEW.collection_amount, 0) - COALESCE(NEW.commission_kept, 0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_settlement_calc ON public.delivery_settlements;
CREATE TRIGGER trg_settlement_calc BEFORE INSERT OR UPDATE ON public.delivery_settlements FOR EACH ROW EXECUTE FUNCTION public.settlement_calc();

-- Hook touch_updated_at trigger
DROP TRIGGER IF EXISTS trg_settlements_updated ON public.delivery_settlements;
CREATE TRIGGER trg_settlements_updated BEFORE UPDATE ON public.delivery_settlements FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_settlements TO authenticated;
GRANT ALL ON public.delivery_settlements TO service_role;

-- Enable RLS
ALTER TABLE public.delivery_settlements ENABLE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY settlements_agency ON public.delivery_settlements FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));
