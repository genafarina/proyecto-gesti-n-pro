
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin','supervisor','viewer');
CREATE TYPE public.client_status AS ENUM ('active','inactive');
CREATE TYPE public.project_status AS ENUM ('quoted','approved','in_progress','paused','completed','cancelled');
CREATE TYPE public.currency_code AS ENUM ('ARS','USD');
CREATE TYPE public.stage_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','delayed','cancelled');
CREATE TYPE public.task_priority AS ENUM ('low','medium','high','urgent');
CREATE TYPE public.expense_category AS ENUM ('labor','materials','tools','equipment_rental','transport','fuel','subcontractors','travel_expenses','supplies','other');
CREATE TYPE public.payment_method AS ENUM ('cash','bank_transfer','debit_card','credit_card','check','mercado_pago','other');

-- updated_at trigger fn
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles read own or admin" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

-- profiles (basic)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles select all auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- clients
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_id text,
  phone text,
  email text,
  address text,
  contact_name text,
  notes text,
  status public.client_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients all auth" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- projects
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text,
  description text,
  manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.project_status NOT NULL DEFAULT 'quoted',
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  estimated_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  contracted_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (contracted_amount >= 0),
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  currency public.currency_code NOT NULL DEFAULT 'ARS',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects all auth" ON public.projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX projects_client_idx ON public.projects(client_id);

-- project_stages
CREATE TABLE public.project_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  order_index int NOT NULL DEFAULT 0,
  weight_percentage numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
  status public.stage_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_stages TO authenticated;
GRANT ALL ON public.project_stages TO service_role;
ALTER TABLE public.project_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stages all auth" ON public.project_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_stages_updated BEFORE UPDATE ON public.project_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX stages_project_idx ON public.project_stages(project_id);

-- project_tasks
CREATE TABLE public.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.project_stages(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.task_status NOT NULL DEFAULT 'pending',
  priority public.task_priority NOT NULL DEFAULT 'medium',
  progress_percentage numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tasks TO authenticated;
GRANT ALL ON public.project_tasks TO service_role;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks all auth" ON public.project_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX tasks_project_idx ON public.project_tasks(project_id);

-- project_expenses
CREATE TABLE public.project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category public.expense_category NOT NULL DEFAULT 'other',
  subcategory text,
  description text,
  supplier text,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  receipt_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_expenses TO authenticated;
GRANT ALL ON public.project_expenses TO service_role;
ALTER TABLE public.project_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses all auth" ON public.project_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.project_expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX expenses_project_idx ON public.project_expenses(project_id);

-- project_collections
CREATE TABLE public.project_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  payment_method public.payment_method NOT NULL DEFAULT 'bank_transfer',
  description text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_collections TO authenticated;
GRANT ALL ON public.project_collections TO service_role;
ALTER TABLE public.project_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections all auth" ON public.project_collections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_collections_updated BEFORE UPDATE ON public.project_collections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX collections_project_idx ON public.project_collections(project_id);
