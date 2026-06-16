
-- Códigos automáticos para clientes y proyectos

-- 1. Columnas
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_number INTEGER;

-- 2. Función generadora de código base de cliente
CREATE OR REPLACE FUNCTION public.generate_client_code_base(_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s TEXT;
  parts TEXT[];
  result TEXT;
  w TEXT;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN 'XX';
  END IF;
  -- normalizar: quitar acentos básicos, mayúsculas, sólo letras/números/espacios
  s := upper(_name);
  s := translate(s,
    'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõúùüûñç',
    'AAAAAAEEEEIIIIOOOOOUUUUNCAAAAAAEEEEIIIIOOOOOUUUUNC');
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
    ELSE
      RETURN rpad(w, 2, 'X');
    END IF;
  ELSE
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
  END IF;
END;
$$;

-- 3. Backfill clientes
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN SELECT id, name FROM public.clients WHERE code IS NULL OR code = '' ORDER BY created_at LOOP
    base := public.generate_client_code_base(r.name);
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.clients WHERE code = candidate) LOOP
      n := n + 1;
      candidate := base || n::text;
    END LOOP;
    UPDATE public.clients SET code = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Backfill proyectos (project_number + code)
DO $$
DECLARE
  r RECORD;
  num INT;
  client_code TEXT;
BEGIN
  FOR r IN
    SELECT p.id, p.client_id, p.created_at,
           row_number() OVER (PARTITION BY p.client_id ORDER BY p.created_at, p.id) as rn
    FROM public.projects p
    WHERE p.project_number IS NULL OR p.code IS NULL
  LOOP
    SELECT code INTO client_code FROM public.clients WHERE id = r.client_id;
    UPDATE public.projects
      SET project_number = r.rn,
          code = client_code || '-' || lpad(r.rn::text, 2, '0')
      WHERE id = r.id;
  END LOOP;
END $$;

-- 5. Constraints
ALTER TABLE public.clients ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN project_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_code_unique ON public.clients (code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_unique ON public.projects (code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_client_number_unique ON public.projects (client_id, project_number);
