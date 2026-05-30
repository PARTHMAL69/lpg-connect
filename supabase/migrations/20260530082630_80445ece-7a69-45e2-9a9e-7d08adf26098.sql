
-- =========================================================================
-- ENUMS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('platform_admin', 'agency_admin', 'agency_operator');
CREATE TYPE public.agency_status AS ENUM ('active', 'disabled');
CREATE TYPE public.payment_mode AS ENUM ('cash', 'online', 'paytm', 'credit');
CREATE TYPE public.payment_receipt_mode AS ENUM ('cash', 'online', 'paytm');
CREATE TYPE public.expense_category AS ENUM (
  'bank_deposit','vehicle_expense','fuel','repair','maintenance',
  'salary','paytm_transfer','miscellaneous'
);
CREATE TYPE public.ledger_entry_kind AS ENUM ('sale_credit','payment','adjustment');

-- =========================================================================
-- CORE TABLES
-- =========================================================================

CREATE TABLE public.agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  phone TEXT,
  address TEXT,
  default_language TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN ('en','hi','mr')),
  status public.agency_status NOT NULL DEFAULT 'active',
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

-- Agency users: links Supabase auth.users to an agency.
-- Platform admins have agency_id = NULL.
-- Login flow: agency_code + username -> lookup synthetic email -> Supabase auth.
CREATE TABLE public.agency_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES public.agencies(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique username within an agency. Platform admins (NULL agency_id) unique globally.
CREATE UNIQUE INDEX agency_users_agency_username_uq
  ON public.agency_users (agency_id, lower(username))
  WHERE agency_id IS NOT NULL;
CREATE UNIQUE INDEX agency_users_platform_username_uq
  ON public.agency_users (lower(username))
  WHERE agency_id IS NULL;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES public.agencies(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, agency_id)
);

-- =========================================================================
-- SECURITY DEFINER HELPERS (avoid recursive RLS)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'platform_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_agency_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT agency_id FROM public.agency_users WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_exists()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'platform_admin');
$$;

-- =========================================================================
-- UPDATED_AT TRIGGER
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================================================================
-- TRANSACTION NUMBER GENERATOR (per agency per year per prefix)
-- =========================================================================
CREATE TABLE public.txn_counters (
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  year INT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agency_id, prefix, year)
);

CREATE OR REPLACE FUNCTION public.next_txn_no(_agency_id UUID, _prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _year INT := EXTRACT(YEAR FROM now())::INT;
  _val BIGINT;
BEGIN
  INSERT INTO public.txn_counters (agency_id, prefix, year, last_value)
  VALUES (_agency_id, _prefix, _year, 1)
  ON CONFLICT (agency_id, prefix, year)
  DO UPDATE SET last_value = txn_counters.last_value + 1
  RETURNING last_value INTO _val;
  RETURN _prefix || '-' || _year::TEXT || '-' || lpad(_val::TEXT, 6, '0');
END; $$;

-- =========================================================================
-- BUSINESS TABLES
-- =========================================================================

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  requires_delivery_boy BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_products_agency ON public.products(agency_id) WHERE is_deleted = false;

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  txn_no TEXT,
  name TEXT NOT NULL,
  mobile TEXT,
  village TEXT,
  consumer_number TEXT,
  address TEXT,
  outstanding_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_customers_agency ON public.customers(agency_id) WHERE is_deleted = false;
CREATE INDEX idx_customers_search ON public.customers
  USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(mobile,'')||' '||coalesce(consumer_number,'')||' '||coalesce(village,'')))
  WHERE is_deleted = false;

CREATE TABLE public.delivery_boys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT,
  default_commission NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_delivery_boys_agency ON public.delivery_boys(agency_id) WHERE is_deleted = false;

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  txn_no TEXT,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  rate NUMERIC(12,2) NOT NULL,
  gross_amount NUMERIC(14,2) NOT NULL,
  commission_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL,
  payment_mode public.payment_mode NOT NULL,
  delivery_boy_id UUID REFERENCES public.delivery_boys(id) ON DELETE RESTRICT,
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_sales_agency_date ON public.sales(agency_id, sale_date DESC) WHERE is_deleted = false;
CREATE INDEX idx_sales_customer ON public.sales(customer_id) WHERE is_deleted = false;
CREATE INDEX idx_sales_delivery_boy ON public.sales(delivery_boy_id) WHERE is_deleted = false;
CREATE INDEX idx_sales_txn_no ON public.sales(txn_no);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  txn_no TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  mode public.payment_receipt_mode NOT NULL,
  remarks TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_payments_agency_date ON public.payments(agency_id, payment_date DESC) WHERE is_deleted = false;
CREATE INDEX idx_payments_customer ON public.payments(customer_id) WHERE is_deleted = false;
CREATE INDEX idx_payments_txn_no ON public.payments(txn_no);

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  txn_no TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category public.expense_category NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ, deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE INDEX idx_expenses_agency_date ON public.expenses(agency_id, expense_date DESC) WHERE is_deleted = false;

CREATE TABLE public.customer_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  kind public.ledger_entry_kind NOT NULL,
  reference TEXT,
  description TEXT,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cust_ledger_cust_date ON public.customer_ledger(customer_id, entry_date DESC, created_at DESC);

CREATE TABLE public.cash_book_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  book_date DATE NOT NULL,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_closing NUMERIC(14,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID,
  UNIQUE (agency_id, book_date)
);

-- =========================================================================
-- SALE COMPUTED FIELDS TRIGGER
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_sales_compute()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.gross_amount := round(NEW.quantity * NEW.rate, 2);
  NEW.commission_amount := round(NEW.quantity * NEW.commission_rate, 2);
  NEW.net_amount := NEW.gross_amount - NEW.commission_amount;
  IF NEW.txn_no IS NULL THEN
    NEW.txn_no := public.next_txn_no(NEW.agency_id, 'SAL');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_payments_txn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.txn_no IS NULL THEN NEW.txn_no := public.next_txn_no(NEW.agency_id, 'PAY'); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_expenses_txn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.txn_no IS NULL THEN NEW.txn_no := public.next_txn_no(NEW.agency_id, 'EXP'); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_customers_txn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.txn_no IS NULL THEN NEW.txn_no := public.next_txn_no(NEW.agency_id, 'CUS'); END IF;
  RETURN NEW;
END; $$;

-- =========================================================================
-- OUTSTANDING + LEDGER AUTOMATION
-- =========================================================================

-- Helper: apply a delta to customer outstanding
CREATE OR REPLACE FUNCTION public.apply_outstanding_delta(_customer_id UUID, _delta NUMERIC)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE public.customers SET outstanding_balance = outstanding_balance + _delta WHERE id = _customer_id;
$$;

-- Sales -> credit ledger + outstanding
CREATE OR REPLACE FUNCTION public.tg_sales_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_credit NUMERIC := 0; new_credit NUMERIC := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', NEW.net_amount, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, NEW.net_amount);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- reverse old effect
    IF OLD.payment_mode = 'credit' AND NOT OLD.is_deleted AND OLD.customer_id IS NOT NULL THEN
      old_credit := OLD.net_amount;
      PERFORM public.apply_outstanding_delta(OLD.customer_id, -old_credit);
    END IF;
    DELETE FROM public.customer_ledger WHERE sale_id = NEW.id;
    -- apply new effect
    IF NEW.payment_mode = 'credit' AND NOT NEW.is_deleted AND NEW.customer_id IS NOT NULL THEN
      new_credit := NEW.net_amount;
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, debit, sale_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.sale_date, 'sale_credit', NEW.txn_no, 'Credit sale', new_credit, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, new_credit);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.payment_mode = 'credit' AND NOT OLD.is_deleted AND OLD.customer_id IS NOT NULL THEN
      PERFORM public.apply_outstanding_delta(OLD.customer_id, -OLD.net_amount);
    END IF;
    DELETE FROM public.customer_ledger WHERE sale_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

-- Payments -> credit ledger + outstanding
CREATE OR REPLACE FUNCTION public.tg_payments_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.is_deleted THEN
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, credit, payment_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.payment_date, 'payment', NEW.txn_no, coalesce(NEW.remarks,'Payment received'), NEW.amount, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, -NEW.amount);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT OLD.is_deleted THEN
      PERFORM public.apply_outstanding_delta(OLD.customer_id, OLD.amount);
    END IF;
    DELETE FROM public.customer_ledger WHERE payment_id = NEW.id;
    IF NOT NEW.is_deleted THEN
      INSERT INTO public.customer_ledger(agency_id, customer_id, entry_date, kind, reference, description, credit, payment_id)
      VALUES (NEW.agency_id, NEW.customer_id, NEW.payment_date, 'payment', NEW.txn_no, coalesce(NEW.remarks,'Payment received'), NEW.amount, NEW.id);
      PERFORM public.apply_outstanding_delta(NEW.customer_id, -NEW.amount);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF NOT OLD.is_deleted THEN
      PERFORM public.apply_outstanding_delta(OLD.customer_id, OLD.amount);
    END IF;
    DELETE FROM public.customer_ledger WHERE payment_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

-- =========================================================================
-- WIRE UP TRIGGERS
-- =========================================================================
CREATE TRIGGER trg_agencies_upd BEFORE UPDATE ON public.agencies FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_agency_users_upd BEFORE UPDATE ON public.agency_users FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_products_upd BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_customers_upd BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_delivery_boys_upd BEFORE UPDATE ON public.delivery_boys FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_sales_upd BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_payments_upd BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_expenses_upd BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_cashbook_upd BEFORE UPDATE ON public.cash_book_days FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_sales_compute BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.tg_sales_compute();
CREATE TRIGGER trg_payments_txn BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.tg_payments_txn();
CREATE TRIGGER trg_expenses_txn BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_txn();
CREATE TRIGGER trg_customers_txn BEFORE INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION public.tg_customers_txn();

CREATE TRIGGER trg_sales_ledger AFTER INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.tg_sales_ledger();
CREATE TRIGGER trg_payments_ledger AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.tg_payments_ledger();

-- =========================================================================
-- GRANTS
-- =========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agencies TO authenticated;
GRANT ALL ON public.agencies TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_users TO authenticated;
GRANT ALL ON public.agency_users TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_boys TO authenticated;
GRANT ALL ON public.delivery_boys TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_ledger TO authenticated;
GRANT ALL ON public.customer_ledger TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_book_days TO authenticated;
GRANT ALL ON public.cash_book_days TO service_role;

GRANT SELECT ON public.txn_counters TO authenticated;
GRANT ALL ON public.txn_counters TO service_role;

-- =========================================================================
-- ENABLE RLS
-- =========================================================================
ALTER TABLE public.agencies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_boys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_book_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.txn_counters    ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- RLS POLICIES
-- =========================================================================

-- agencies: platform admin all; agency users read own
CREATE POLICY agencies_admin_all ON public.agencies FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY agencies_user_read ON public.agencies FOR SELECT TO authenticated
  USING (id = public.current_agency_id());

-- agency_users
CREATE POLICY agency_users_admin_all ON public.agency_users FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY agency_users_self_read ON public.agency_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR agency_id = public.current_agency_id());

-- user_roles
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Generic per-agency policy generator (manual since SQL doesn't have it)
-- products
CREATE POLICY products_agency ON public.products FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY customers_agency ON public.customers FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY delivery_boys_agency ON public.delivery_boys FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY sales_agency ON public.sales FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY payments_agency ON public.payments FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY expenses_agency ON public.expenses FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY customer_ledger_agency ON public.customer_ledger FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY cash_book_agency ON public.cash_book_days FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));

CREATE POLICY txn_counters_read ON public.txn_counters FOR SELECT TO authenticated
  USING (agency_id = public.current_agency_id() OR public.is_platform_admin(auth.uid()));
