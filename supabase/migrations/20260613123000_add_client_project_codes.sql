-- Automatic, unique codes for clients and projects.
-- Existing records are backfilled before the new NOT NULL constraints are applied.

CREATE OR REPLACE FUNCTION public.normalize_entity_code(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    upper(
      translate(
        coalesce(value, ''),
        'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç',
        'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc'
      )
    ),
    '[^A-Z0-9]',
    '',
    'g'
  )
$$;

CREATE OR REPLACE FUNCTION public.client_code_base(client_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  normalized_name text;
  words text[];
  generated_code text;
BEGIN
  normalized_name := trim(
    regexp_replace(
      upper(
        translate(
          coalesce(client_name, ''),
          'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç',
          'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc'
        )
      ),
      '[^A-Z0-9]+',
      ' ',
      'g'
    )
  );

  IF normalized_name = '' THEN
    RETURN 'CL';
  END IF;

  words := regexp_split_to_array(normalized_name, '\s+');

  IF array_length(words, 1) = 1 THEN
    generated_code := left(words[1], 2);
  ELSE
    SELECT string_agg(left(word, 1), '' ORDER BY position)
    INTO generated_code
    FROM unnest(words) WITH ORDINALITY AS parts(word, position);
  END IF;

  RETURN coalesce(nullif(generated_code, ''), 'CL');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_available_client_code(
  client_name text,
  excluded_client_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_code text;
  candidate text;
  suffix integer := 1;
BEGIN
  base_code := public.client_code_base(client_name);
  PERFORM pg_advisory_xact_lock(hashtextextended('client-code:' || base_code, 0));
  candidate := base_code;

  WHILE EXISTS (
    SELECT 1
    FROM public.clients
    WHERE code = candidate
      AND (excluded_client_id IS NULL OR id <> excluded_client_id)
  ) LOOP
    suffix := suffix + 1;
    candidate := base_code || suffix::text;
  END LOOP;

  RETURN candidate;
END;
$$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS code text;

DO $$
DECLARE
  client_record record;
BEGIN
  FOR client_record IN
    SELECT id, name
    FROM public.clients
    WHERE code IS NULL OR btrim(code) = ''
    ORDER BY created_at, id
  LOOP
    UPDATE public.clients
    SET code = public.next_available_client_code(client_record.name, client_record.id)
    WHERE id = client_record.id;
  END LOOP;
END;
$$;

UPDATE public.clients
SET code = public.normalize_entity_code(code)
WHERE code IS DISTINCT FROM public.normalize_entity_code(code);

ALTER TABLE public.clients
  ALTER COLUMN code SET NOT NULL,
  ADD CONSTRAINT clients_code_not_blank CHECK (btrim(code) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS clients_code_unique_idx
  ON public.clients (code);

CREATE OR REPLACE FUNCTION public.set_client_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := public.next_available_client_code(NEW.name, NEW.id);
  ELSE
    NEW.code := public.normalize_entity_code(NEW.code);
  END IF;

  IF NEW.code = '' THEN
    RAISE EXCEPTION 'El código del cliente no puede estar vacío.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_code ON public.clients;
CREATE TRIGGER trg_clients_code
BEFORE INSERT OR UPDATE OF code ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.set_client_code();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_number integer;

WITH numbered_projects AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY client_id
      ORDER BY created_at, id
    )::integer AS assigned_number
  FROM public.projects
)
UPDATE public.projects AS projects
SET project_number = numbered_projects.assigned_number
FROM numbered_projects
WHERE projects.id = numbered_projects.id;

UPDATE public.projects AS projects
SET code = clients.code || '-' || lpad(projects.project_number::text, 2, '0')
FROM public.clients AS clients
WHERE clients.id = projects.client_id;

ALTER TABLE public.projects
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN project_number SET NOT NULL,
  ADD CONSTRAINT projects_code_not_blank CHECK (btrim(code) <> ''),
  ADD CONSTRAINT projects_project_number_positive CHECK (project_number > 0);

CREATE UNIQUE INDEX IF NOT EXISTS projects_code_unique_idx
  ON public.projects (code);

CREATE UNIQUE INDEX IF NOT EXISTS projects_client_number_unique_idx
  ON public.projects (client_id, project_number);

CREATE OR REPLACE FUNCTION public.format_project_code(client_code text, project_number integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.normalize_entity_code(client_code) || '-' || lpad(project_number::text, 2, '0')
$$;

CREATE OR REPLACE FUNCTION public.set_project_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_client_code text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    NEW.project_number := OLD.project_number;
    NEW.code := OLD.code;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('project-number:' || NEW.client_id::text, 0));

  SELECT code
  INTO selected_client_code
  FROM public.clients
  WHERE id = NEW.client_id;

  IF selected_client_code IS NULL THEN
    RAISE EXCEPTION 'El cliente seleccionado no existe o no tiene código.'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(project_number), 0) + 1
    INTO NEW.project_number
    FROM public.projects
    WHERE client_id = NEW.client_id;
  ELSE
    SELECT coalesce(max(project_number), 0) + 1
    INTO NEW.project_number
    FROM public.projects
    WHERE client_id = NEW.client_id
      AND id <> OLD.id;
  END IF;

  NEW.code := public.format_project_code(selected_client_code, NEW.project_number);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_code ON public.projects;
CREATE TRIGGER trg_projects_code
BEFORE INSERT OR UPDATE OF client_id, code, project_number ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_code();
