BEGIN;

-- Credit notes are manually registered documents that were already issued
-- outside this application. They adjust receivables but never create a cash
-- movement or an expense.
CREATE TABLE public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  client_id uuid NOT NULL,
  document_type text NOT NULL,
  point_of_sale text NOT NULL,
  credit_note_number text NOT NULL,
  issue_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'ARS',
  reason text NOT NULL,
  pdf_path text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT credit_notes_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT credit_notes_cancelled_by_fkey
    FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT credit_notes_id_invoice_unique UNIQUE (id, invoice_id),
  CONSTRAINT credit_notes_document_type_check
    CHECK (document_type IN ('A', 'B', 'C', 'E', 'M', 'OTHER')),
  CONSTRAINT credit_notes_point_of_sale_check
    CHECK (point_of_sale ~ '^[0-9]{1,8}$'),
  CONSTRAINT credit_notes_number_check
    CHECK (credit_note_number ~ '^[0-9]{1,20}$'),
  CONSTRAINT credit_notes_amount_check CHECK (amount > 0),
  CONSTRAINT credit_notes_currency_check CHECK (currency = 'ARS'),
  CONSTRAINT credit_notes_reason_not_blank CHECK (length(trim(reason)) > 0),
  CONSTRAINT credit_notes_pdf_path_check
    CHECK (
      pdf_path IS NULL
      OR (
        pdf_path !~ '(^/|\\|^https?://)'
        AND lower(pdf_path) ~ '\.pdf$'
      )
    ),
  CONSTRAINT credit_notes_status_check CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT credit_notes_cancellation_check CHECK (
    (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR status = 'cancelled'
  )
);

-- Fiscal numbering is global for this issuer and document type. Casting the
-- numeric strings prevents 1 and 00000001 from being registered twice.
CREATE UNIQUE INDEX credit_notes_document_unique_idx
  ON public.credit_notes (
    document_type,
    (point_of_sale::numeric),
    (credit_note_number::numeric)
  );
CREATE INDEX credit_notes_invoice_id_idx ON public.credit_notes(invoice_id);
CREATE INDEX credit_notes_client_id_idx ON public.credit_notes(client_id);
CREATE INDEX credit_notes_issue_date_idx ON public.credit_notes(issue_date);
CREATE INDEX credit_notes_status_idx ON public.credit_notes(status);

-- The redundant invoice_id enables declarative foreign keys both to the note
-- header and to the exact project portion of the original invoice.
CREATE TABLE public.credit_note_projects (
  credit_note_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  project_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_projects_pkey PRIMARY KEY (credit_note_id, project_id),
  CONSTRAINT credit_note_projects_note_fkey
    FOREIGN KEY (credit_note_id, invoice_id)
    REFERENCES public.credit_notes(id, invoice_id)
    ON DELETE RESTRICT,
  CONSTRAINT credit_note_projects_invoice_project_fkey
    FOREIGN KEY (invoice_id, project_id)
    REFERENCES public.invoice_projects(invoice_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT credit_note_projects_amount_check CHECK (amount > 0)
);

CREATE INDEX credit_note_projects_invoice_id_idx
  ON public.credit_note_projects(invoice_id);
CREATE INDEX credit_note_projects_project_id_idx
  ON public.credit_note_projects(project_id);

-- Preserve the previous header and distribution when an admin edits or cancels.
CREATE TABLE public.credit_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  previous_header jsonb NOT NULL,
  previous_projects jsonb NOT NULL,
  recorded_by uuid DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_note_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_note_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.credit_note_revisions TO authenticated, service_role;
CREATE POLICY "credit_note_revisions select auth"
  ON public.credit_note_revisions FOR SELECT TO authenticated USING (true);

CREATE FUNCTION public.record_credit_note_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.credit_note_revisions (credit_note_id, previous_header, previous_projects)
  SELECT OLD.id, to_jsonb(OLD),
    coalesce(jsonb_agg(to_jsonb(line) ORDER BY line.project_id)
      FILTER (WHERE line.credit_note_id IS NOT NULL), '[]'::jsonb)
    FROM public.credit_note_projects line WHERE line.credit_note_id = OLD.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_credit_note_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_credit_notes_revision
  AFTER UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.record_credit_note_revision();

CREATE OR REPLACE FUNCTION public.validate_credit_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_invoice public.invoices%ROWTYPE;
  active_credit_total numeric(14,2);
BEGIN
  NEW.document_type := upper(trim(NEW.document_type));
  NEW.point_of_sale := trim(NEW.point_of_sale);
  NEW.credit_note_number := trim(NEW.credit_note_number);
  NEW.reason := trim(NEW.reason);
  NEW.updated_by := auth.uid();

  SELECT *
    INTO selected_invoice
    FROM public.invoices
   WHERE id = NEW.invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura inexistente' USING ERRCODE = '23503';
  END IF;

  IF selected_invoice.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede acreditar una factura anulada'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.currency <> 'ARS' OR NEW.currency <> 'ARS' THEN
    RAISE EXCEPTION 'Las notas de crédito solo están habilitadas para facturas en ARS'
      USING ERRCODE = '23514';
  END IF;

  IF selected_invoice.client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'La nota de crédito y la factura deben pertenecer al mismo cliente'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.issue_date < selected_invoice.issue_date THEN
    RAISE EXCEPTION 'La fecha de la nota no puede ser anterior a la factura'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'Una nota nueva debe registrarse activa y luego anularse mediante la operación auditada'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'Una nota de crédito anulada es inmutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'No se puede cambiar la factura ni el cliente de una nota existente'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'cancelled' THEN
      IF NEW.document_type IS DISTINCT FROM OLD.document_type
         OR NEW.point_of_sale IS DISTINCT FROM OLD.point_of_sale
         OR NEW.credit_note_number IS DISTINCT FROM OLD.credit_note_number
         OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
         OR NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.reason IS DISTINCT FROM OLD.reason
         OR NEW.pdf_path IS DISTINCT FROM OLD.pdf_path THEN
        RAISE EXCEPTION 'La anulación no puede modificar los datos de la nota'
          USING ERRCODE = '23514';
      END IF;
      NEW.cancelled_by := auth.uid();
      NEW.cancelled_at := now();
    END IF;
  END IF;

  IF NEW.status = 'active' THEN
    SELECT coalesce(sum(note.amount), 0)
      INTO active_credit_total
      FROM public.credit_notes note
     WHERE note.invoice_id = NEW.invoice_id
       AND note.status = 'active'
       AND note.id <> NEW.id;

    IF active_credit_total + NEW.amount > selected_invoice.total_amount THEN
      RAISE EXCEPTION 'La suma de notas activas supera el importe original de la factura'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_notes_validate
  BEFORE INSERT OR UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.validate_credit_note();

CREATE TRIGGER trg_credit_notes_updated
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.protect_credit_note_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Las notas de crédito se anulan y no se eliminan para conservar trazabilidad'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_credit_notes_no_delete
  BEFORE DELETE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.protect_credit_note_delete();

CREATE OR REPLACE FUNCTION public.validate_credit_note_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_note public.credit_notes%ROWTYPE;
BEGIN
  SELECT *
    INTO selected_note
    FROM public.credit_notes
   WHERE id = NEW.credit_note_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito inexistente' USING ERRCODE = '23503';
  END IF;

  IF selected_note.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede modificar el desglose de una nota anulada'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.invoice_id <> selected_note.invoice_id THEN
    RAISE EXCEPTION 'El desglose debe pertenecer a la factura acreditada'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_note_projects_validate
  BEFORE INSERT OR UPDATE ON public.credit_note_projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_credit_note_project();

CREATE OR REPLACE FUNCTION public.protect_credit_note_project_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.credit_notes note
     WHERE note.id = OLD.credit_note_id
       AND note.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'No se puede modificar el desglose de una nota anulada'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_credit_note_projects_protect_delete
  BEFORE DELETE ON public.credit_note_projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_credit_note_project_delete();

CREATE TRIGGER trg_credit_note_projects_updated
  BEFORE UPDATE ON public.credit_note_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.check_credit_note_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_credit_note_id uuid;
  selected_note public.credit_notes%ROWTYPE;
  line_count integer;
  line_total numeric(14,2);
  invalid_project boolean;
  project_over_credit boolean;
BEGIN
  IF TG_TABLE_NAME = 'credit_notes' THEN
    target_credit_note_id := coalesce(NEW.id, OLD.id);
  ELSE
    target_credit_note_id := coalesce(NEW.credit_note_id, OLD.credit_note_id);
  END IF;

  SELECT *
    INTO selected_note
    FROM public.credit_notes
   WHERE id = target_credit_note_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM 1
    FROM public.invoices
   WHERE id = selected_note.invoice_id
   FOR UPDATE;

  SELECT count(*),
         coalesce(sum(line.amount), 0),
         coalesce(bool_or(
           line.invoice_id <> selected_note.invoice_id
           OR invoice_line.project_id IS NULL
         ), false)
    INTO line_count, line_total, invalid_project
    FROM public.credit_note_projects line
    LEFT JOIN public.invoice_projects invoice_line
      ON invoice_line.invoice_id = line.invoice_id
     AND invoice_line.project_id = line.project_id
   WHERE line.credit_note_id = target_credit_note_id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'La nota debe distribuirse al menos en un proyecto'
      USING ERRCODE = '23514';
  END IF;

  IF invalid_project THEN
    RAISE EXCEPTION 'Todos los proyectos de la nota deben integrar la factura'
      USING ERRCODE = '23514';
  END IF;

  IF line_total <> selected_note.amount THEN
    RAISE EXCEPTION 'La suma del desglose por proyecto debe coincidir exactamente con la nota'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.invoice_projects invoice_line
      JOIN (
        SELECT line.invoice_id, line.project_id, sum(line.amount) AS credited_amount
          FROM public.credit_note_projects line
          JOIN public.credit_notes note ON note.id = line.credit_note_id
         WHERE line.invoice_id = selected_note.invoice_id
           AND note.status = 'active'
         GROUP BY line.invoice_id, line.project_id
      ) credited
        ON credited.invoice_id = invoice_line.invoice_id
       AND credited.project_id = invoice_line.project_id
     WHERE invoice_line.invoice_id = selected_note.invoice_id
       AND credited.credited_amount > invoice_line.amount
  ) INTO project_over_credit;

  IF project_over_credit THEN
    RAISE EXCEPTION 'Las notas activas superan el importe original de un proyecto en la factura'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_credit_notes_check_totals
  AFTER INSERT OR UPDATE ON public.credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_credit_note_totals();

CREATE CONSTRAINT TRIGGER trg_credit_note_projects_check_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_note_projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_credit_note_totals();

CREATE OR REPLACE FUNCTION public.protect_invoice_credit_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  active_credit_total numeric(14,2);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.credit_notes note WHERE note.invoice_id = OLD.id
  ) AND (
    NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar cliente o moneda de una factura con notas de crédito'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.credit_notes note
     WHERE note.invoice_id = OLD.id
       AND note.issue_date < NEW.issue_date
  ) THEN
    RAISE EXCEPTION 'La fecha de la factura no puede ser posterior a una nota de crédito vinculada'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(note.amount), 0)
    INTO active_credit_total
    FROM public.credit_notes note
   WHERE note.invoice_id = OLD.id
     AND note.status = 'active';

  IF active_credit_total > NEW.total_amount THEN
    RAISE EXCEPTION 'El total de la factura no puede ser menor a sus notas de crédito activas'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'cancelled'
     AND OLD.status <> 'cancelled'
     AND active_credit_total > 0 THEN
    RAISE EXCEPTION 'Anulá las notas de crédito activas antes de anular la factura'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_protect_credit_notes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.protect_invoice_credit_notes();

CREATE OR REPLACE FUNCTION public.check_invoice_project_credit_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_invoice_id uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
  target_project_id uuid := coalesce(NEW.project_id, OLD.project_id);
  invoice_project_amount numeric(14,2);
  active_credit_total numeric(14,2);
BEGIN
  SELECT amount
    INTO invoice_project_amount
    FROM public.invoice_projects
   WHERE invoice_id = target_invoice_id
     AND project_id = target_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(line.amount), 0)
    INTO active_credit_total
    FROM public.credit_note_projects line
    JOIN public.credit_notes note ON note.id = line.credit_note_id
   WHERE line.invoice_id = target_invoice_id
     AND line.project_id = target_project_id
     AND note.status = 'active';

  IF active_credit_total > invoice_project_amount THEN
    RAISE EXCEPTION 'El importe del proyecto no puede ser menor a sus notas de crédito activas'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_invoice_projects_check_credit_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_project_credit_totals();

-- Existing allocations remain untouched when a later note creates a customer
-- credit. New or increased allocations cannot exceed the new net amount.
CREATE OR REPLACE FUNCTION public.validate_net_invoice_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  gross_invoice_amount numeric(14,2);
  gross_project_amount numeric(14,2);
  invoice_credit_amount numeric(14,2);
  project_credit_amount numeric(14,2);
  current_invoice_allocated numeric(14,2);
  proposed_invoice_allocated numeric(14,2);
  current_project_allocated numeric(14,2);
  proposed_project_allocated numeric(14,2);
  net_invoice_amount numeric(14,2);
  net_project_amount numeric(14,2);
BEGIN
  SELECT total_amount
    INTO gross_invoice_amount
    FROM public.invoices
   WHERE id = NEW.invoice_id
   FOR UPDATE;

  SELECT amount
    INTO gross_project_amount
    FROM public.invoice_projects
   WHERE invoice_id = NEW.invoice_id
     AND project_id = NEW.project_id;

  SELECT coalesce(sum(amount), 0)
    INTO invoice_credit_amount
    FROM public.credit_notes
   WHERE invoice_id = NEW.invoice_id
     AND status = 'active';

  SELECT coalesce(sum(line.amount), 0)
    INTO project_credit_amount
    FROM public.credit_note_projects line
    JOIN public.credit_notes note ON note.id = line.credit_note_id
   WHERE line.invoice_id = NEW.invoice_id
     AND line.project_id = NEW.project_id
     AND note.status = 'active';

  net_invoice_amount := greatest(gross_invoice_amount - invoice_credit_amount, 0);
  net_project_amount := greatest(gross_project_amount - project_credit_amount, 0);

  SELECT coalesce(sum(amount), 0)
    INTO current_invoice_allocated
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount
    INTO proposed_invoice_allocated
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id
     AND id <> NEW.id;

  IF proposed_invoice_allocated > net_invoice_amount
     AND proposed_invoice_allocated > current_invoice_allocated THEN
    RAISE EXCEPTION 'La imputación supera el saldo neto pendiente de la factura'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(amount), 0)
    INTO current_project_allocated
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id
     AND project_id = NEW.project_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount
    INTO proposed_project_allocated
    FROM public.invoice_allocations
   WHERE invoice_id = NEW.invoice_id
     AND project_id = NEW.project_id
     AND id <> NEW.id;

  IF proposed_project_allocated > net_project_amount
     AND proposed_project_allocated > current_project_allocated THEN
    RAISE EXCEPTION 'La imputación supera el saldo neto pendiente del proyecto en la factura'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_allocations_validate_net
  BEFORE INSERT OR UPDATE ON public.invoice_allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_net_invoice_allocation();

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

  INSERT INTO public.invoice_projects (invoice_id, project_id, amount)
  SELECT target_invoice_id, item.project_id, item.amount
    FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2))
  ON CONFLICT (invoice_id, project_id)
  DO UPDATE SET amount = EXCLUDED.amount
    WHERE public.invoice_projects.amount IS DISTINCT FROM EXCLUDED.amount;

  DELETE FROM public.invoice_projects line
   WHERE line.invoice_id = target_invoice_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(p_projects)
         AS item(project_id uuid, amount numeric(14,2))
        WHERE item.project_id = line.project_id
     );

  RETURN target_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_credit_note_with_projects(
  p_credit_note jsonb,
  p_projects jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_credit_note_id uuid := coalesce((p_credit_note ->> 'id')::uuid, gen_random_uuid());
  target_invoice_id uuid := (p_credit_note ->> 'invoice_id')::uuid;
  target_client_id uuid;
  target_amount numeric(14,2) := (p_credit_note ->> 'amount')::numeric(14,2);
  existing_note public.credit_notes%ROWTYPE;
  project_count integer;
  distinct_project_count integer;
  project_total numeric(14,2);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar notas de crédito'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_projects) <> 'array' OR jsonb_array_length(p_projects) = 0 THEN
    RAISE EXCEPTION 'La nota debe distribuirse al menos en un proyecto'
      USING ERRCODE = '23514';
  END IF;

  SELECT client_id
    INTO target_client_id
    FROM public.invoices
   WHERE id = target_invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura inexistente' USING ERRCODE = '23503';
  END IF;

  SELECT count(*), count(DISTINCT item.project_id), sum(item.amount)
    INTO project_count, distinct_project_count, project_total
    FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2));

  IF project_count <> distinct_project_count THEN
    RAISE EXCEPTION 'No se puede repetir un proyecto en el desglose de la nota'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2))
     WHERE item.project_id IS NULL OR item.amount IS NULL OR item.amount <= 0
  ) THEN
    RAISE EXCEPTION 'Cada proyecto acreditado debe tener un importe mayor a cero'
      USING ERRCODE = '23514';
  END IF;

  IF project_total <> target_amount THEN
    RAISE EXCEPTION 'La suma del desglose por proyecto debe coincidir exactamente con la nota'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2))
      LEFT JOIN public.invoice_projects invoice_line
        ON invoice_line.invoice_id = target_invoice_id
       AND invoice_line.project_id = item.project_id
     WHERE invoice_line.project_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Todos los proyectos de la nota deben integrar la factura'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO existing_note
    FROM public.credit_notes
   WHERE id = target_credit_note_id
   FOR UPDATE;

  IF FOUND THEN
    IF existing_note.status = 'cancelled' THEN
      RAISE EXCEPTION 'Una nota de crédito anulada es inmutable'
        USING ERRCODE = '23514';
    END IF;
    IF existing_note.invoice_id <> target_invoice_id THEN
      RAISE EXCEPTION 'No se puede cambiar la factura de una nota existente'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.credit_notes
       SET document_type = p_credit_note ->> 'document_type',
           point_of_sale = p_credit_note ->> 'point_of_sale',
           credit_note_number = p_credit_note ->> 'credit_note_number',
           issue_date = (p_credit_note ->> 'issue_date')::date,
           amount = target_amount,
           reason = p_credit_note ->> 'reason',
           pdf_path = p_credit_note ->> 'pdf_path'
     WHERE id = target_credit_note_id;
  ELSE
    INSERT INTO public.credit_notes (
      id, invoice_id, client_id, document_type, point_of_sale,
      credit_note_number, issue_date, amount, currency, reason, pdf_path
    ) VALUES (
      target_credit_note_id,
      target_invoice_id,
      target_client_id,
      p_credit_note ->> 'document_type',
      p_credit_note ->> 'point_of_sale',
      p_credit_note ->> 'credit_note_number',
      (p_credit_note ->> 'issue_date')::date,
      target_amount,
      'ARS',
      p_credit_note ->> 'reason',
      p_credit_note ->> 'pdf_path'
    );
  END IF;

  DELETE FROM public.credit_note_projects
   WHERE credit_note_id = target_credit_note_id;

  INSERT INTO public.credit_note_projects (
    credit_note_id, invoice_id, project_id, amount
  )
  SELECT target_credit_note_id, target_invoice_id, item.project_id, item.amount
    FROM jsonb_to_recordset(p_projects) AS item(project_id uuid, amount numeric(14,2));

  RETURN target_credit_note_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_credit_note(p_credit_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_invoice_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede anular notas de crédito'
      USING ERRCODE = '42501';
  END IF;

  SELECT invoice_id INTO target_invoice_id
    FROM public.credit_notes WHERE id = p_credit_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito inexistente' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.invoices WHERE id = target_invoice_id FOR UPDATE;
  PERFORM 1 FROM public.credit_notes WHERE id = p_credit_note_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito inexistente' USING ERRCODE = '23503';
  END IF;

  UPDATE public.credit_notes
     SET status = 'cancelled'
   WHERE id = p_credit_note_id;
END;
$$;

-- Keep every existing column in its original position for compatibility and
-- append the new accounting values at the end of each view.
CREATE OR REPLACE VIEW public.invoice_balances
WITH (security_invoker = true, security_barrier = true)
AS
SELECT invoice.*,
       allocation.allocated_amount,
       greatest(
         invoice.total_amount - credit.credit_note_amount - allocation.allocated_amount,
         0
       )::numeric(14,2) AS balance_due,
       CASE
         WHEN invoice.total_amount - credit.credit_note_amount <= 0 THEN 'credited'
         WHEN allocation.allocated_amount <= 0 THEN 'pending'
         WHEN allocation.allocated_amount < invoice.total_amount - credit.credit_note_amount
           THEN 'partial'
         ELSE 'paid'
       END AS payment_status,
       projects.project_ids,
       cardinality(projects.project_ids) AS project_count,
       invoice.total_amount::numeric(14,2) AS gross_amount,
       credit.credit_note_amount,
       greatest(invoice.total_amount - credit.credit_note_amount, 0)::numeric(14,2)
         AS net_billed_amount,
       greatest(
         allocation.allocated_amount - (invoice.total_amount - credit.credit_note_amount),
         0
       )::numeric(14,2) AS credit_balance
  FROM public.invoices invoice
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.invoice_id = invoice.id
  ) allocation
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(note.amount), 0)::numeric(14,2) AS credit_note_amount
      FROM public.credit_notes note
     WHERE note.invoice_id = invoice.id
       AND note.status = 'active'
  ) credit
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(item.project_id ORDER BY item.project_id), ARRAY[]::uuid[])
             AS project_ids
      FROM public.invoice_projects item
     WHERE item.invoice_id = invoice.id
  ) projects;

CREATE OR REPLACE VIEW public.invoice_project_balances
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
       greatest(
         line.amount - credit.credit_note_amount - allocation.allocated_amount,
         0
       )::numeric(14,2) AS balance_due,
       CASE
         WHEN line.amount - credit.credit_note_amount <= 0 THEN 'credited'
         WHEN allocation.allocated_amount <= 0 THEN 'pending'
         WHEN allocation.allocated_amount < line.amount - credit.credit_note_amount THEN 'partial'
         ELSE 'paid'
       END AS payment_status,
       line.amount::numeric(14,2) AS project_gross_amount,
       credit.credit_note_amount,
       greatest(line.amount - credit.credit_note_amount, 0)::numeric(14,2)
         AS net_billed_amount,
       greatest(
         allocation.allocated_amount - (line.amount - credit.credit_note_amount),
         0
       )::numeric(14,2) AS credit_balance
  FROM public.invoice_projects line
  JOIN public.invoices invoice ON invoice.id = line.invoice_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(item.amount), 0)::numeric(14,2) AS allocated_amount
      FROM public.invoice_allocations item
     WHERE item.invoice_id = line.invoice_id
       AND item.project_id = line.project_id
  ) allocation
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(note_line.amount), 0)::numeric(14,2) AS credit_note_amount
      FROM public.credit_note_projects note_line
      JOIN public.credit_notes note ON note.id = note_line.credit_note_id
     WHERE note_line.invoice_id = line.invoice_id
       AND note_line.project_id = line.project_id
       AND note.status = 'active'
  ) credit;

REVOKE ALL ON public.credit_notes FROM PUBLIC, anon;
REVOKE ALL ON public.credit_note_projects FROM PUBLIC, anon;
-- Direct note writes would take a row lock before the invoice lock.
-- Financial writes must use the admin-checked RPCs in invoice -> note order.
REVOKE ALL ON public.credit_notes, public.credit_note_projects FROM authenticated, service_role;
GRANT SELECT ON public.credit_notes, public.credit_note_projects TO authenticated, service_role;

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_notes select auth"
  ON public.credit_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "credit_notes insert admin"
  ON public.credit_notes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "credit_notes update admin"
  ON public.credit_notes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "credit_note_projects select auth"
  ON public.credit_note_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "credit_note_projects insert admin"
  ON public.credit_note_projects FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "credit_note_projects update admin"
  ON public.credit_note_projects FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "credit_note_projects delete admin"
  ON public.credit_note_projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.validate_credit_note() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_credit_note_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_credit_note_project() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_credit_note_project_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_credit_note_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_invoice_credit_notes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_invoice_project_credit_totals()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_net_invoice_allocation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_credit_note_with_projects(jsonb, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_credit_note(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_credit_note_with_projects(jsonb, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_credit_note(uuid) TO authenticated;

-- Reuse the existing private PDF bucket and signed-URL flow. Referenced note
-- PDFs become visible to authenticated users; orphaned objects remain hidden.
DROP POLICY IF EXISTS "invoice_documents select auth" ON storage.objects;
CREATE POLICY "invoice_documents select auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND (
      EXISTS (
        SELECT 1
          FROM public.invoices invoice
         WHERE invoice.pdf_path = storage.objects.name
      )
      OR EXISTS (
        SELECT 1
          FROM public.credit_notes note
         WHERE note.pdf_path = storage.objects.name
      )
    )
  );

COMMENT ON TABLE public.credit_notes IS
  'Manual registry of externally issued credit notes; it adjusts receivables without issuing fiscal documents or changing cash.';
COMMENT ON TABLE public.credit_note_projects IS
  'Exact distribution of a credit note between project portions of its original invoice.';
COMMENT ON COLUMN public.credit_notes.currency IS
  'Credit notes are currently restricted to ARS because no FX conversion model exists.';

COMMIT;
