BEGIN;

-- A bank collection remains a single cash event in project_collections. This
-- table only distributes an invoice's value between the client's projects.
CREATE TABLE public.invoice_projects (
  invoice_id uuid NOT NULL,
  project_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_projects_pkey PRIMARY KEY (invoice_id, project_id),
  CONSTRAINT invoice_projects_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE,
  CONSTRAINT invoice_projects_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  CONSTRAINT invoice_projects_amount_check CHECK (amount > 0)
);

CREATE INDEX invoice_projects_project_id_idx ON public.invoice_projects(project_id);

-- Preserve every existing invoice/project relationship before changing any
-- validation. Existing invoices therefore remain one-project invoices.
INSERT INTO public.invoice_projects (invoice_id, project_id, amount)
SELECT id, project_id, total_amount
  FROM public.invoices;

-- Each accounting allocation now identifies the project portion of the
-- invoice that it settles. The real collection row is never duplicated.
ALTER TABLE public.invoice_allocations
  ADD COLUMN project_id uuid;

UPDATE public.invoice_allocations allocation
   SET project_id = invoice.project_id
  FROM public.invoices invoice
 WHERE invoice.id = allocation.invoice_id;

ALTER TABLE public.invoice_allocations
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE public.invoice_allocations
  DROP CONSTRAINT invoice_allocations_pair_unique;

ALTER TABLE public.invoice_allocations
  ADD CONSTRAINT invoice_allocations_project_fkey
  FOREIGN KEY (invoice_id, project_id)
  REFERENCES public.invoice_projects(invoice_id, project_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.invoice_allocations
  ADD CONSTRAINT invoice_allocations_project_pair_unique
  UNIQUE (invoice_id, collection_id, project_id);

CREATE INDEX invoice_allocations_project_id_idx
  ON public.invoice_allocations(project_id);

CREATE TRIGGER trg_invoice_projects_updated
  BEFORE UPDATE ON public.invoice_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.invoice_projects FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_projects TO authenticated;
GRANT ALL ON public.invoice_projects TO service_role;

ALTER TABLE public.invoice_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_projects select auth"
  ON public.invoice_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoice_projects insert admin"
  ON public.invoice_projects FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoice_projects update admin"
  ON public.invoice_projects FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "invoice_projects delete admin"
  ON public.invoice_projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

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

  -- project_id is retained as a compatibility/primary-project pointer. The
  -- complete accounting relationship lives in invoice_projects.
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
    RAISE EXCEPTION 'La factura y todos sus proyectos deben pertenecer al mismo cliente'
      USING ERRCODE = '23514';
  END IF;

  IF project_currency <> NEW.currency THEN
    RAISE EXCEPTION 'La factura y todos sus proyectos deben usar la misma moneda'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(sum(amount), 0)
      INTO allocated_amount
      FROM public.invoice_allocations
     WHERE invoice_id = OLD.id;

    IF allocated_amount > 0 AND (
      NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar cliente o moneda de una factura con cobros imputados'
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

-- Keep direct single-project inserts backwards compatible. Multi-project
-- writes use save_invoice_with_projects() so the header and breakdown commit
-- atomically.
CREATE OR REPLACE FUNCTION public.sync_single_invoice_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  line_count integer;
  line_project_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.invoice_projects (invoice_id, project_id, amount)
    VALUES (NEW.id, NEW.project_id, NEW.total_amount)
    ON CONFLICT (invoice_id, project_id) DO NOTHING;
    RETURN NEW;
  END IF;

  SELECT count(*), (array_agg(project_id ORDER BY project_id))[1]
    INTO line_count, line_project_id
    FROM public.invoice_projects
   WHERE invoice_id = NEW.id;

  IF line_count = 1
     AND line_project_id = OLD.project_id
     AND (
       NEW.project_id = OLD.project_id
       OR NOT EXISTS (
         SELECT 1 FROM public.invoice_allocations WHERE invoice_id = NEW.id
       )
     ) THEN
    UPDATE public.invoice_projects
       SET project_id = NEW.project_id,
           amount = NEW.total_amount
     WHERE invoice_id = NEW.id
       AND project_id = line_project_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_sync_single_project
  AFTER INSERT OR UPDATE OF project_id, total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_single_invoice_project();

CREATE OR REPLACE FUNCTION public.check_invoice_project_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_invoice public.invoices%ROWTYPE;
  target_invoice_id uuid;
  line_count integer;
  project_total numeric(14,2);
  invalid_project boolean;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    target_invoice_id := coalesce(NEW.id, OLD.id);
  ELSE
    target_invoice_id := coalesce(NEW.invoice_id, OLD.invoice_id);
  END IF;

  SELECT *
    INTO selected_invoice
    FROM public.invoices
   WHERE id = target_invoice_id
   FOR UPDATE;

  -- Cascading deletion of the breakdown is valid when the invoice is gone.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(line.amount), 0),
         coalesce(bool_or(
           project.client_id <> selected_invoice.client_id
           OR project.currency <> selected_invoice.currency
         ), false)
    INTO line_count, project_total, invalid_project
    FROM public.invoice_projects line
    JOIN public.projects project ON project.id = line.project_id
   WHERE line.invoice_id = target_invoice_id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'La factura debe estar asociada al menos a un proyecto'
      USING ERRCODE = '23514';
  END IF;

  IF invalid_project THEN
    RAISE EXCEPTION 'Todos los proyectos de la factura deben pertenecer al mismo cliente y moneda'
      USING ERRCODE = '23514';
  END IF;

  IF project_total <> selected_invoice.total_amount THEN
    RAISE EXCEPTION 'La suma del desglose por proyecto debe coincidir exactamente con el total de la factura'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.invoice_projects line
     WHERE line.invoice_id = target_invoice_id
       AND line.project_id = selected_invoice.project_id
  ) THEN
    RAISE EXCEPTION 'El proyecto principal debe formar parte del desglose de la factura'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_invoice_projects_check_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_project_totals();

CREATE CONSTRAINT TRIGGER trg_invoices_check_project_totals
  AFTER INSERT OR UPDATE ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_project_totals();

CREATE OR REPLACE FUNCTION public.validate_invoice_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_invoice public.invoices%ROWTYPE;
  invoice_project_amount numeric(14,2);
  collection_project_id uuid;
  collection_client_id uuid;
  collection_amount numeric(14,2);
  collection_currency public.currency_code;
  allocated_to_invoice numeric(14,2);
  allocated_to_project numeric(14,2);
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

  -- Older clients that omit project_id retain their one-project behaviour.
  IF NEW.project_id IS NULL THEN
    NEW.project_id := collection_project_id;
  END IF;

  SELECT amount
    INTO invoice_project_amount
    FROM public.invoice_projects
   WHERE invoice_id = NEW.invoice_id
     AND project_id = NEW.project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proyecto de la imputación debe integrar la factura y pertenecer al mismo proyecto y cliente del desglose'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se pueden imputar cobros a una factura anulada'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.client_id <> collection_client_id THEN
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
    INTO allocated_to_project
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id
     AND project_id = NEW.project_id
     AND id <> NEW.id;

  IF allocated_to_project + NEW.amount > invoice_project_amount THEN
    RAISE EXCEPTION 'La imputación supera el saldo pendiente del proyecto en la factura'
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
    SELECT 1 FROM public.invoice_projects WHERE project_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar cliente o moneda de un proyecto con facturas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_invoice_with_projects(
  p_invoice jsonb,
  p_projects jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_invoice_id uuid := coalesce((p_invoice ->> 'id')::uuid, gen_random_uuid());
  target_client_id uuid := (p_invoice ->> 'client_id')::uuid;
  target_currency public.currency_code := (p_invoice ->> 'currency')::public.currency_code;
  target_total numeric(14,2) := (p_invoice ->> 'total_amount')::numeric(14,2);
  primary_project_id uuid;
  project_count integer;
  distinct_project_count integer;
  project_total numeric(14,2);
BEGIN
  IF jsonb_typeof(p_projects) <> 'array' OR jsonb_array_length(p_projects) = 0 THEN
    RAISE EXCEPTION 'La factura debe estar asociada al menos a un proyecto'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*), count(DISTINCT item.project_id), sum(item.amount)
    INTO project_count, distinct_project_count, project_total
    FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2));

  IF project_count <> distinct_project_count THEN
    RAISE EXCEPTION 'No se puede repetir un proyecto en el desglose de la factura'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2))
     WHERE item.project_id IS NULL OR item.amount IS NULL OR item.amount <= 0
  ) THEN
    RAISE EXCEPTION 'Cada proyecto debe tener un importe mayor a cero'
      USING ERRCODE = '23514';
  END IF;

  IF project_total <> target_total THEN
    RAISE EXCEPTION 'La suma del desglose por proyecto debe coincidir exactamente con el total de la factura'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2))
      LEFT JOIN public.projects project ON project.id = item.project_id
     WHERE project.id IS NULL
        OR project.client_id <> target_client_id
        OR project.currency <> target_currency
  ) THEN
    RAISE EXCEPTION 'Todos los proyectos de la factura deben pertenecer al mismo cliente y moneda'
      USING ERRCODE = '23514';
  END IF;

  -- Lock all participating projects in a deterministic order and share the
  -- same advisory locks used by project edits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('invoiced-project:' || item.project_id::text, 0)
  )
    FROM (
      SELECT project_id
        FROM jsonb_to_recordset(p_projects) AS requested(project_id uuid, amount numeric(14,2))
       ORDER BY project_id
    ) item;

  SELECT (entry.value ->> 'project_id')::uuid
    INTO primary_project_id
    FROM jsonb_array_elements(p_projects) WITH ORDINALITY AS entry(value, position)
   ORDER BY entry.position
   LIMIT 1;

  PERFORM 1 FROM public.invoices WHERE id = target_invoice_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.invoices WHERE id = target_invoice_id) THEN
    IF EXISTS (
      SELECT 1
        FROM (
          SELECT allocation.project_id, sum(allocation.amount) AS allocated_amount
            FROM public.invoice_allocations allocation
           WHERE allocation.invoice_id = target_invoice_id
           GROUP BY allocation.project_id
        ) allocated
        LEFT JOIN jsonb_to_recordset(p_projects)
          AS requested(project_id uuid, amount numeric(14,2))
          ON requested.project_id = allocated.project_id
       WHERE requested.project_id IS NULL
          OR requested.amount < allocated.allocated_amount
    ) THEN
      RAISE EXCEPTION 'El nuevo desglose es incompatible con los cobros ya imputados'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.invoices
       SET client_id = target_client_id,
           project_id = primary_project_id,
           document_type = p_invoice ->> 'document_type',
           point_of_sale = p_invoice ->> 'point_of_sale',
           invoice_number = p_invoice ->> 'invoice_number',
           issue_date = (p_invoice ->> 'issue_date')::date,
           due_date = (p_invoice ->> 'due_date')::date,
           concept = p_invoice ->> 'concept',
           net_amount = (p_invoice ->> 'net_amount')::numeric(14,2),
           vat_amount = (p_invoice ->> 'vat_amount')::numeric(14,2),
           total_amount = target_total,
           currency = target_currency,
           pdf_path = p_invoice ->> 'pdf_path',
           notes = p_invoice ->> 'notes',
           status = coalesce(p_invoice ->> 'status', 'issued')
     WHERE id = target_invoice_id;
  ELSE
    INSERT INTO public.invoices (
      id, client_id, project_id, document_type, point_of_sale, invoice_number,
      issue_date, due_date, concept, net_amount, vat_amount, total_amount,
      currency, pdf_path, notes, status
    ) VALUES (
      target_invoice_id,
      target_client_id,
      primary_project_id,
      p_invoice ->> 'document_type',
      p_invoice ->> 'point_of_sale',
      p_invoice ->> 'invoice_number',
      (p_invoice ->> 'issue_date')::date,
      (p_invoice ->> 'due_date')::date,
      p_invoice ->> 'concept',
      (p_invoice ->> 'net_amount')::numeric(14,2),
      (p_invoice ->> 'vat_amount')::numeric(14,2),
      target_total,
      target_currency,
      p_invoice ->> 'pdf_path',
      p_invoice ->> 'notes',
      coalesce(p_invoice ->> 'status', 'issued')
    );
  END IF;

  DELETE FROM public.invoice_projects WHERE invoice_id = target_invoice_id;

  INSERT INTO public.invoice_projects (invoice_id, project_id, amount)
  SELECT target_invoice_id, item.project_id, item.amount
    FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2));

  RETURN target_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_collection_to_invoice_projects(
  p_invoice_id uuid,
  p_collection_id uuid,
  p_projects jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  item record;
BEGIN
  IF jsonb_typeof(p_projects) <> 'array' OR jsonb_array_length(p_projects) = 0 THEN
    RAISE EXCEPTION 'Indicá al menos un importe para imputar'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_projects) AS requested(project_id uuid, amount numeric(14,2))
     WHERE requested.project_id IS NULL OR requested.amount IS NULL OR requested.amount <= 0
  ) THEN
    RAISE EXCEPTION 'Cada importe a imputar debe ser mayor a cero'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT project_id)
      FROM jsonb_to_recordset(p_projects) AS requested(project_id uuid, amount numeric(14,2))
  ) THEN
    RAISE EXCEPTION 'No se puede repetir un proyecto en una imputación'
      USING ERRCODE = '23514';
  END IF;

  -- A stable lock order makes concurrent allocations deterministic.
  PERFORM 1 FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura inexistente' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.project_collections WHERE id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro inexistente' USING ERRCODE = '23503';
  END IF;

  FOR item IN
    SELECT project_id, amount
      FROM jsonb_to_recordset(p_projects) AS requested(project_id uuid, amount numeric(14,2))
     ORDER BY project_id
  LOOP
    INSERT INTO public.invoice_allocations (
      invoice_id, collection_id, project_id, amount
    ) VALUES (
      p_invoice_id, p_collection_id, item.project_id, item.amount
    )
    ON CONFLICT (invoice_id, collection_id, project_id)
    DO UPDATE SET amount = public.invoice_allocations.amount + EXCLUDED.amount;
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW public.invoice_balances
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
       END AS payment_status,
       projects.project_ids,
       cardinality(projects.project_ids) AS project_count
  FROM public.invoices invoice
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.invoice_id = invoice.id
  ) allocation
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(item.project_id ORDER BY item.project_id), ARRAY[]::uuid[])
             AS project_ids
      FROM public.invoice_projects item
     WHERE item.invoice_id = invoice.id
  ) projects;

CREATE VIEW public.invoice_project_balances
WITH (security_invoker = true, security_barrier = true)
AS
SELECT invoice.id AS invoice_id,
       line.project_id,
       invoice.client_id,
       invoice.document_type,
       invoice.point_of_sale,
       invoice.invoice_number,
       invoice.issue_date,
       invoice.due_date,
       invoice.concept,
       invoice.currency,
       invoice.status,
       line.amount AS project_amount,
       allocation.allocated_amount,
       greatest(line.amount - allocation.allocated_amount, 0)::numeric(14,2) AS balance_due,
       CASE
         WHEN allocation.allocated_amount <= 0 THEN 'pending'
         WHEN allocation.allocated_amount < line.amount THEN 'partial'
         ELSE 'paid'
       END AS payment_status
  FROM public.invoice_projects line
  JOIN public.invoices invoice ON invoice.id = line.invoice_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.invoice_id = line.invoice_id
       AND item.project_id = line.project_id
  ) allocation;

REVOKE ALL ON public.invoice_project_balances FROM PUBLIC, anon;
GRANT SELECT ON public.invoice_project_balances TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_single_invoice_project() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_invoice_project_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_invoice_with_projects(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_collection_to_invoice_projects(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice_with_projects(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_collection_to_invoice_projects(uuid, uuid, jsonb)
  TO authenticated;

COMMENT ON TABLE public.invoice_projects IS
  'Exact distribution of one invoice total between one or more projects of the same client and currency.';
COMMENT ON COLUMN public.invoices.project_id IS
  'Compatibility pointer to one primary project; invoice_projects is the accounting source of truth.';
COMMENT ON COLUMN public.invoice_allocations.project_id IS
  'Project portion of the invoice settled by this accounting allocation; the collection remains a single cash row.';

COMMIT;
