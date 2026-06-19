-- Payment accounts classify where expenses are paid and collections are received.
CREATE TABLE IF NOT EXISTS public.payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounts_type_check
    CHECK (type IN ('bank', 'virtual_wallet', 'cash', 'credit', 'other'))
);

CREATE TABLE IF NOT EXISTS public.general_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL,
  category text NOT NULL,
  expense_type text NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  payee text,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method public.payment_method NOT NULL,
  payment_account_id uuid NOT NULL,
  other_payment_account_detail text,
  receipt_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT general_expenses_amount_check CHECK (amount >= 0),
  CONSTRAINT general_expenses_category_check
    CHECK (category IN ('salaries','fuel','maintenance','services','accountant','taxes','general_travel_expenses','personal_expenses','tools','investments','other')),
  CONSTRAINT general_expenses_expense_type_check
    CHECK (expense_type IN ('operational', 'personal', 'investment')),
  CONSTRAINT general_expenses_status_check
    CHECK (status IN ('paid', 'pending', 'cancelled')),
  CONSTRAINT general_expenses_payment_account_id_fkey
    FOREIGN KEY (payment_account_id)
    REFERENCES public.payment_accounts(id)
    ON DELETE RESTRICT
);

ALTER TABLE public.project_expenses ADD COLUMN IF NOT EXISTS payment_account_id uuid;
ALTER TABLE public.project_collections ADD COLUMN IF NOT EXISTS payment_account_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_expenses_payment_account_id_fkey' AND conrelid='public.project_expenses'::regclass) THEN
    ALTER TABLE public.project_expenses ADD CONSTRAINT project_expenses_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.payment_accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_collections_payment_account_id_fkey' AND conrelid='public.project_collections'::regclass) THEN
    ALTER TABLE public.project_collections ADD CONSTRAINT project_collections_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.payment_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_payment_accounts_updated ON public.payment_accounts;
CREATE TRIGGER trg_payment_accounts_updated BEFORE UPDATE ON public.payment_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_general_expenses_updated ON public.general_expenses;
CREATE TRIGGER trg_general_expenses_updated BEFORE UPDATE ON public.general_expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.payment_accounts (name, type)
SELECT seed.name, seed.type
FROM (VALUES ('Banco Macro','bank'),('Mercado Pago','virtual_wallet'),('Efectivo','cash'),('Crédito','credit'),('Otro','other')) AS seed(name,type)
WHERE NOT EXISTS (SELECT 1 FROM public.payment_accounts existing WHERE lower(trim(existing.name))=lower(trim(seed.name)));

CREATE INDEX IF NOT EXISTS payment_accounts_active_idx ON public.payment_accounts(active);
CREATE INDEX IF NOT EXISTS general_expenses_expense_date_idx ON public.general_expenses(expense_date);
CREATE INDEX IF NOT EXISTS general_expenses_category_idx ON public.general_expenses(category);
CREATE INDEX IF NOT EXISTS general_expenses_expense_type_idx ON public.general_expenses(expense_type);
CREATE INDEX IF NOT EXISTS general_expenses_status_idx ON public.general_expenses(status);
CREATE INDEX IF NOT EXISTS general_expenses_payment_account_id_idx ON public.general_expenses(payment_account_id);
CREATE INDEX IF NOT EXISTS project_expenses_payment_account_id_idx ON public.project_expenses(payment_account_id);
CREATE INDEX IF NOT EXISTS project_collections_payment_account_id_idx ON public.project_collections(payment_account_id);

REVOKE ALL ON public.payment_accounts FROM PUBLIC, anon;
REVOKE ALL ON public.general_expenses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.general_expenses TO authenticated;
GRANT ALL ON public.payment_accounts TO service_role;
GRANT ALL ON public.general_expenses TO service_role;

ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_accounts select auth" ON public.payment_accounts;
CREATE POLICY "payment_accounts select auth" ON public.payment_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payment_accounts insert admin" ON public.payment_accounts;
CREATE POLICY "payment_accounts insert admin" ON public.payment_accounts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "payment_accounts update admin" ON public.payment_accounts;
CREATE POLICY "payment_accounts update admin" ON public.payment_accounts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "payment_accounts delete admin" ON public.payment_accounts;
CREATE POLICY "payment_accounts delete admin" ON public.payment_accounts FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "general_expenses select auth" ON public.general_expenses;
CREATE POLICY "general_expenses select auth" ON public.general_expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "general_expenses insert admin" ON public.general_expenses;
CREATE POLICY "general_expenses insert admin" ON public.general_expenses FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "general_expenses update admin" ON public.general_expenses;
CREATE POLICY "general_expenses update admin" ON public.general_expenses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "general_expenses delete admin" ON public.general_expenses;
CREATE POLICY "general_expenses delete admin" ON public.general_expenses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));