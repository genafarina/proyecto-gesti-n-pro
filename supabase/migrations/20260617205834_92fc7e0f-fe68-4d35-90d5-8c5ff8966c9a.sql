CREATE OR REPLACE FUNCTION public.create_project_with_code(
  _client_id uuid,
  _name text,
  _description text DEFAULT NULL,
  _status public.project_status DEFAULT 'quoted',
  _planned_start_date date DEFAULT NULL,
  _planned_end_date date DEFAULT NULL,
  _actual_start_date date DEFAULT NULL,
  _actual_end_date date DEFAULT NULL,
  _estimated_amount numeric DEFAULT 0,
  _contracted_amount numeric DEFAULT 0,
  _estimated_cost numeric DEFAULT 0,
  _currency public.currency_code DEFAULT 'ARS',
  _notes text DEFAULT NULL
)
RETURNS public.projects
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_client record;
  next_number integer;
  new_code text;
  created_project public.projects;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  SELECT id, code, next_project_number
  INTO selected_client
  FROM public.clients
  WHERE id = _client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  next_number := greatest(coalesce(selected_client.next_project_number, 1), 1);
  new_code := selected_client.code || '-' || lpad(next_number::text, 2, '0');

  INSERT INTO public.projects (
    client_id,
    name,
    code,
    project_number,
    description,
    status,
    planned_start_date,
    planned_end_date,
    actual_start_date,
    actual_end_date,
    estimated_amount,
    contracted_amount,
    estimated_cost,
    currency,
    notes
  ) VALUES (
    _client_id,
    trim(_name),
    new_code,
    next_number,
    _description,
    coalesce(_status, 'quoted'),
    _planned_start_date,
    _planned_end_date,
    _actual_start_date,
    _actual_end_date,
    greatest(coalesce(_estimated_amount, 0), 0),
    greatest(coalesce(_contracted_amount, 0), 0),
    greatest(coalesce(_estimated_cost, 0), 0),
    coalesce(_currency, 'ARS'),
    _notes
  )
  RETURNING * INTO created_project;

  UPDATE public.clients
  SET next_project_number = next_number + 1
  WHERE id = _client_id;

  RETURN created_project;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_project_with_code(uuid, text, text, public.project_status, date, date, date, date, numeric, numeric, numeric, public.currency_code, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_with_code(uuid, text, text, public.project_status, date, date, date, date, numeric, numeric, numeric, public.currency_code, text) TO service_role;