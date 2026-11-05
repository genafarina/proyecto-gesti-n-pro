BEGIN;

-- Preserve historical project identifiers without changing the application's
-- automatic project numbering.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS legacy_code text;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_legacy_code_not_blank;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_legacy_code_not_blank
  CHECK (legacy_code IS NULL OR length(trim(legacy_code)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS projects_legacy_code_unique_idx
  ON public.projects (upper(trim(legacy_code)))
  WHERE legacy_code IS NOT NULL;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_type text NOT NULL,
  point_of_sale text NOT NULL,
  invoice_number text NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  concept text NOT NULL,
  net_amount numeric(14,2),
  vat_amount numeric(14,2),
  total_amount numeric(14,2) NOT NULL,
  currency public.currency_code NOT NULL,
  pdf_path text,
  notes text,
  status text NOT NULL DEFAULT 'issued',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT,
  CONSTRAINT invoices_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  CONSTRAINT invoices_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT invoices_document_type_check
    CHECK (
      document_type IN (
        'A', 'B', 'C', 'E', 'M', 'OTHER'
      )
    ),
  CONSTRAINT invoices_point_of_sale_check
    CHECK (point_of_sale ~ '^[0-9]{1,8}$'),
  CONSTRAINT invoices_number_check
    CHECK (invoice_number ~ '^[0-9]{1,20}$'),
  CONSTRAINT invoices_concept_not_blank
    CHECK (length(trim(concept)) > 0),
  CONSTRAINT invoices_due_date_check
    CHECK (due_date IS NULL OR due_date >= issue_date),
  CONSTRAINT invoices_net_amount_check
    CHECK (net_amount IS NULL OR net_amount >= 0),
  CONSTRAINT invoices_vat_amount_check
    CHECK (vat_amount IS NULL OR vat_amount >= 0),
  CONSTRAINT invoices_total_amount_check
    CHECK (total_amount > 0),
  CONSTRAINT invoices_amount_breakdown_check
    CHECK (
      net_amount IS NULL
      OR vat_amount IS NULL
      OR abs((net_amount + vat_amount) - total_amount) < 0.01
    ),
  CONSTRAINT invoices_pdf_path_check
    CHECK (
      pdf_path IS NULL
      OR (
        pdf_path !~ '(^/|\\|^https?://)'
        AND lower(pdf_path) ~ '\.pdf$'
      )
    ),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('issued', 'cancelled')),
  CONSTRAINT invoices_document_unique
    UNIQUE (document_type, point_of_sale, invoice_number)
);

CREATE TABLE public.invoice_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_allocations_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT,
  CONSTRAINT invoice_allocations_collection_id_fkey
    FOREIGN KEY (collection_id) REFERENCES public.project_collections(id) ON DELETE RESTRICT,
  CONSTRAINT invoice_allocations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT invoice_allocations_amount_check CHECK (amount > 0),
  CONSTRAINT invoice_allocations_pair_unique UNIQUE (invoice_id, collection_id)
);

CREATE INDEX invoices_client_id_idx ON public.invoices(client_id);
CREATE INDEX invoices_project_id_idx ON public.invoices(project_id);
CREATE INDEX invoices_issue_date_idx ON public.invoices(issue_date);
CREATE INDEX invoices_status_idx ON public.invoices(status);
CREATE INDEX invoices_currency_idx ON public.invoices(currency);
CREATE INDEX invoice_allocations_invoice_id_idx ON public.invoice_allocations(invoice_id);
CREATE INDEX invoice_allocations_collection_id_idx ON public.invoice_allocations(collection_id);

CREATE OR REPLACE FUNCTION public.validate_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_client_id uuid;
  project_currency public.currency_code;
  allocated_amount numeric(14,2);
BEGIN
  NEW.document_type := upper(trim(NEW.document_type));
  NEW.point_of_sale := trim(NEW.point_of_sale);
  NEW.invoice_number := trim(NEW.invoice_number);
  NEW.concept := trim(NEW.concept);

  -- Serialize invoice creation with client/currency changes on the project
  -- without requiring the caller to pass the project's UPDATE RLS policy.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('invoiced-project:' || NEW.project_id::text, 0)
  );

  SELECT client_id, currency
    INTO project_client_id, project_currency
    FROM public.projects
   WHERE id = NEW.project_id;

  IF project_client_id IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '23503';
  END IF;

  IF project_client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'La factura y el proyecto deben pertenecer al mismo cliente'
      USING ERRCODE = '23514';
  END IF;

  IF project_currency <> NEW.currency THEN
    RAISE EXCEPTION 'La factura y el proyecto deben usar la misma moneda'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(sum(amount), 0)
      INTO allocated_amount
      FROM public.invoice_allocations
     WHERE invoice_id = OLD.id;

    IF allocated_amount > 0 AND (
      NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar proyecto, cliente o moneda de una factura con cobros imputados'
        USING ERRCODE = '23514';
    END IF;

    IF allocated_amount > NEW.total_amount THEN
      RAISE EXCEPTION 'El total de la factura no puede ser menor al importe ya cobrado'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND allocated_amount > 0 THEN
      RAISE EXCEPTION 'Desvinculá los cobros antes de anular la factura'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_validate
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice();

CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_invoice_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_invoice public.invoices%ROWTYPE;
  collection_project_id uuid;
  collection_client_id uuid;
  collection_amount numeric(14,2);
  collection_currency public.currency_code;
  allocated_to_invoice numeric(14,2);
  allocated_from_collection numeric(14,2);
BEGIN
  SELECT *
    INTO selected_invoice
    FROM public.invoices
   WHERE id = NEW.invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura inexistente' USING ERRCODE = '23503';
  END IF;

  SELECT collection.project_id,
         collection.client_id,
         collection.amount,
         project.currency
    INTO collection_project_id,
         collection_client_id,
         collection_amount,
         collection_currency
    FROM public.project_collections collection
    JOIN public.projects project ON project.id = collection.project_id
   WHERE collection.id = NEW.collection_id
   FOR UPDATE OF collection;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro inexistente' USING ERRCODE = '23503';
  END IF;

  IF selected_invoice.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se pueden imputar cobros a una factura anulada'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.project_id <> collection_project_id
     OR selected_invoice.client_id <> collection_client_id THEN
    RAISE EXCEPTION 'La factura y el cobro deben pertenecer al mismo proyecto y cliente'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.currency <> collection_currency THEN
    RAISE EXCEPTION 'No se puede imputar un cobro de otra moneda sin una conversión registrada'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(amount), 0)
    INTO allocated_to_invoice
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id
     AND id <> NEW.id;

  IF allocated_to_invoice + NEW.amount > selected_invoice.total_amount THEN
    RAISE EXCEPTION 'La imputación supera el saldo pendiente de la factura'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(amount), 0)
    INTO allocated_from_collection
    FROM public.invoice_allocations
   WHERE collection_id = NEW.collection_id
     AND id <> NEW.id;

  IF allocated_from_collection + NEW.amount > collection_amount THEN
    RAISE EXCEPTION 'La imputación supera el importe disponible del cobro'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_allocations_validate
  BEFORE INSERT OR UPDATE ON public.invoice_allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_allocation();

CREATE TRIGGER trg_invoice_allocations_updated
  BEFORE UPDATE ON public.invoice_allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.protect_allocated_collection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allocated_amount numeric(14,2);
BEGIN
  SELECT coalesce(sum(amount), 0)
    INTO allocated_amount
    FROM public.invoice_allocations
   WHERE collection_id = OLD.id;

  IF TG_OP = 'DELETE' THEN
    IF allocated_amount > 0 THEN
      RAISE EXCEPTION 'Desvinculá las facturas antes de eliminar el cobro'
        USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;

  IF allocated_amount > 0 AND (
    NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar proyecto o cliente de un cobro imputado'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.amount < allocated_amount THEN
    RAISE EXCEPTION 'El importe del cobro no puede ser menor al total ya imputado'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_collections_protect_allocations
  BEFORE UPDATE OR DELETE ON public.project_collections
  FOR EACH ROW EXECUTE FUNCTION public.protect_allocated_collection();

CREATE OR REPLACE FUNCTION public.protect_invoiced_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('invoiced-project:' || OLD.id::text, 0)
  );

  IF (
    NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) AND EXISTS (
    SELECT 1 FROM public.invoices WHERE project_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar cliente o moneda de un proyecto con facturas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_projects_protect_invoices
  BEFORE UPDATE OF client_id, currency ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_invoiced_project();

CREATE VIEW public.invoice_balances
WITH (security_invoker = true, security_barrier = true)
AS
SELECT invoice.*,
       allocation.allocated_amount,
       greatest(invoice.total_amount - allocation.allocated_amount, 0)::numeric(14,2)
         AS balance_due,
       CASE
         WHEN allocation.allocated_amount <= 0 THEN 'pending'
         WHEN allocation.allocated_amount < invoice.total_amount THEN 'partial'
         ELSE 'paid'
       END AS payment_status
  FROM public.invoices invoice
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.invoice_id = invoice.id
  ) allocation;

CREATE VIEW public.collection_allocation_summary
WITH (security_invoker = true, security_barrier = true)
AS
SELECT collection.*,
       project.currency,
       allocation.allocated_amount,
       greatest(collection.amount - allocation.allocated_amount, 0)::numeric(14,2)
         AS unallocated_amount
  FROM public.project_collections collection
  JOIN public.projects project ON project.id = collection.project_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.collection_id = collection.id
  ) allocation;

REVOKE ALL ON public.invoices FROM PUBLIC, anon;
REVOKE ALL ON public.invoice_allocations FROM PUBLIC, anon;
REVOKE ALL ON public.invoice_balances FROM PUBLIC, anon;
REVOKE ALL ON public.collection_allocation_summary FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_allocations TO authenticated;
GRANT SELECT ON public.invoice_balances TO authenticated;
GRANT SELECT ON public.collection_allocation_summary TO authenticated;
GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.invoice_allocations TO service_role;
GRANT SELECT ON public.invoice_balances TO service_role;
GRANT SELECT ON public.collection_allocation_summary TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices select auth"
  ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices insert admin"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoices update admin"
  ON public.invoices FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoices delete admin"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "invoice_allocations select auth"
  ON public.invoice_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoice_allocations insert admin"
  ON public.invoice_allocations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoice_allocations update admin"
  ON public.invoice_allocations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoice_allocations delete admin"
  ON public.invoice_allocations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.validate_invoice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_invoice_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_allocated_collection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_invoiced_project() FROM PUBLIC, anon, authenticated;

-- Private PDF storage. The application stores object paths, never public URLs or
-- local filesystem paths, and creates short-lived signed URLs when needed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-documents',
  'invoice-documents',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "invoice_documents select auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND EXISTS (
      SELECT 1
        FROM public.invoices invoice
       WHERE invoice.pdf_path = storage.objects.name
    )
  );
CREATE POLICY "invoice_documents insert admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoice-documents'
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "invoice_documents update admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id = 'invoice-documents'
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "invoice_documents delete admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND public.has_role(auth.uid(), 'admin')
  );

COMMENT ON TABLE public.invoices IS
  'Manual registry of invoices already issued; it does not issue fiscal documents.';
COMMENT ON TABLE public.invoice_allocations IS
  'Amounts from existing project_collections allocated to invoices without duplicating cash income.';
COMMENT ON COLUMN public.projects.legacy_code IS
  'Optional historical project code used only to map future imports.';

COMMIT;
