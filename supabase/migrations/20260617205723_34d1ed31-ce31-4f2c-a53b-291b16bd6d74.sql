DROP INDEX IF EXISTS public.projects_client_number_unique;
DROP INDEX IF EXISTS public.projects_code_unique;
DROP INDEX IF EXISTS public.clients_code_unique;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_project_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_number integer;

CREATE OR REPLACE FUNCTION public.generate_client_code_base(_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text;
  parts text[];
  result text;
  w text;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN 'XX';
  END IF;

  s := upper(_name);
  s := translate(
    s,
    'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõúùüûñç',
    'AAAAAAEEEEIIIIOOOOOUUUUNCAAAAAAEEEEIIIIOOOOOUUUUNC'
  );
  s := regexp_replace(s, '[^A-Z0-9 ]', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := trim(s);

  IF s = '' THEN
    RETURN 'XX';
  END IF;

  parts := string_to_array(s, ' ');

  IF array_length(parts, 1) = 1 THEN
    w := parts[1];
    IF length(w) >= 2 THEN
      RETURN substring(w, 1, 2);
    END IF;
    RETURN rpad(w, 2, 'X');
  END IF;

  result := '';
  FOR i IN 1..array_length(parts, 1) LOOP
    IF length(parts[i]) > 0 THEN
      result := result || substring(parts[i], 1, 1);
    END IF;
  END LOOP;

  IF length(result) < 2 THEN
    result := rpad(result, 2, 'X');
  END IF;

  RETURN result;
END;
$$;

UPDATE public.clients
SET code = '__TMP__' || replace(id::text, '-', '');

DO $$
DECLARE
  r record;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR r IN SELECT id, name FROM public.clients ORDER BY created_at, id LOOP
    base := public.generate_client_code_base(r.name);
    candidate := base;
    suffix := 1;

    WHILE EXISTS (SELECT 1 FROM public.clients WHERE code = candidate) LOOP
      suffix := suffix + 1;
      candidate := base || suffix::text;
    END LOOP;

    UPDATE public.clients SET code = candidate WHERE id = r.id;
  END LOOP;
END $$;

WITH numbered AS (
  SELECT
    p.id,
    row_number() OVER (PARTITION BY p.client_id ORDER BY p.created_at, p.id)::integer AS new_number,
    c.code AS client_code
  FROM public.projects p
  JOIN public.clients c ON c.id = p.client_id
)
UPDATE public.projects p
SET
  project_number = numbered.new_number,
  code = numbered.client_code || '-' || lpad(numbered.new_number::text, 2, '0')
FROM numbered
WHERE p.id = numbered.id;

UPDATE public.clients c
SET next_project_number = COALESCE(project_max.max_number, 0) + 1
FROM (
  SELECT client_id, max(project_number) AS max_number
  FROM public.projects
  GROUP BY client_id
) AS project_max
WHERE c.id = project_max.client_id;

UPDATE public.clients c
SET next_project_number = 1
WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.client_id = c.id);

ALTER TABLE public.clients ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.clients ALTER COLUMN next_project_number SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN project_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_code_unique ON public.clients (code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_unique ON public.projects (code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_client_number_unique ON public.projects (client_id, project_number);