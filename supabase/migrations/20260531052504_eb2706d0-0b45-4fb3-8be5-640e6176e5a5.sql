ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS delivery_boy_id UUID REFERENCES public.delivery_boys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_delivery_boy ON public.expenses(delivery_boy_id);
ALTER TYPE public.expense_category ADD VALUE IF NOT EXISTS 'delivery_boy_payment';