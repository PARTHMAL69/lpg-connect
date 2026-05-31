-- ==========================================================
-- Migration: Add Delivery Boy Payout Category & References
-- ==========================================================

-- 1. Add delivery_boy_payment to the expense_category enum
ALTER TYPE public.expense_category ADD VALUE IF NOT EXISTS 'delivery_boy_payment';

-- 2. Add delivery_boy_id column to expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS delivery_boy_id UUID REFERENCES public.delivery_boys(id) ON DELETE SET NULL;

-- 3. Create index for quick lookup of boy payments
CREATE INDEX IF NOT EXISTS idx_expenses_delivery_boy 
  ON public.expenses(delivery_boy_id) 
  WHERE delivery_boy_id IS NOT NULL AND is_deleted = false;
