
-- 1) Tighten RLS on business tables: read for any authenticated, write for admins only

-- clients
DROP POLICY IF EXISTS "clients all auth" ON public.clients;
CREATE POLICY "clients select auth" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients write admin" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "clients update admin" ON public.clients FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "clients delete admin" ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- projects
DROP POLICY IF EXISTS "projects all auth" ON public.projects;
CREATE POLICY "projects select auth" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects insert admin" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "projects update admin" ON public.projects FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "projects delete admin" ON public.projects FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- project_expenses
DROP POLICY IF EXISTS "expenses all auth" ON public.project_expenses;
CREATE POLICY "expenses select auth" ON public.project_expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "expenses insert admin" ON public.project_expenses FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "expenses update admin" ON public.project_expenses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "expenses delete admin" ON public.project_expenses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- project_collections
DROP POLICY IF EXISTS "collections all auth" ON public.project_collections;
CREATE POLICY "collections select auth" ON public.project_collections FOR SELECT TO authenticated USING (true);
CREATE POLICY "collections insert admin" ON public.project_collections FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "collections update admin" ON public.project_collections FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "collections delete admin" ON public.project_collections FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- project_stages
DROP POLICY IF EXISTS "stages all auth" ON public.project_stages;
CREATE POLICY "stages select auth" ON public.project_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "stages insert admin" ON public.project_stages FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "stages update admin" ON public.project_stages FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "stages delete admin" ON public.project_stages FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- project_tasks
DROP POLICY IF EXISTS "tasks all auth" ON public.project_tasks;
CREATE POLICY "tasks select auth" ON public.project_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks insert admin" ON public.project_tasks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tasks update admin" ON public.project_tasks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tasks delete admin" ON public.project_tasks FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 2) user_roles: only own rows visible (admins can read all via separate policy)
DROP POLICY IF EXISTS "user_roles read own or admin" ON public.user_roles;
CREATE POLICY "user_roles read own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_roles read admin" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 3) Lock down SECURITY DEFINER functions: revoke from public/anon; grant only what's needed
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- generate_client_code_base is a pure helper: switch to SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.generate_client_code_base(_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE s text; parts text[]; result text; w text;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RETURN 'XX'; END IF;
  s := upper(_name);
  s := translate(s,'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõúùüûñç','AAAAAAEEEEIIIIOOOOOUUUUNCAAAAAAEEEEIIIIOOOOOUUUUNC');
  s := regexp_replace(s, '[^A-Z0-9 ]', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := trim(s);
  IF s = '' THEN RETURN 'XX'; END IF;
  parts := string_to_array(s, ' ');
  IF array_length(parts, 1) = 1 THEN
    w := parts[1];
    IF length(w) >= 2 THEN RETURN substring(w,1,2); END IF;
    RETURN rpad(w,2,'X');
  END IF;
  result := '';
  FOR i IN 1..array_length(parts,1) LOOP
    IF length(parts[i])>0 THEN result := result || substring(parts[i],1,1); END IF;
  END LOOP;
  IF length(result)<2 THEN result := rpad(result,2,'X'); END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.generate_client_code_base(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_client_code_base(text) TO authenticated;

-- create_project_with_code: keep SECURITY DEFINER (needs to bump counter atomically),
-- but enforce admin inside and restrict EXECUTE to authenticated.
CREATE OR REPLACE FUNCTION public.create_project_with_code(
  _client_id uuid, _name text, _description text DEFAULT NULL, _status project_status DEFAULT 'quoted',
  _planned_start_date date DEFAULT NULL, _planned_end_date date DEFAULT NULL,
  _actual_start_date date DEFAULT NULL, _actual_end_date date DEFAULT NULL,
  _estimated_amount numeric DEFAULT 0, _contracted_amount numeric DEFAULT 0,
  _estimated_cost numeric DEFAULT 0, _currency currency_code DEFAULT 'ARS', _notes text DEFAULT NULL
) RETURNS projects LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE selected_client record; next_number integer; new_code text; created_project public.projects;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  SELECT id, code, next_project_number INTO selected_client FROM public.clients WHERE id=_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  next_number := greatest(coalesce(selected_client.next_project_number,1),1);
  new_code := selected_client.code || '-' || lpad(next_number::text, 2, '0');
  INSERT INTO public.projects (client_id,name,code,project_number,description,status,planned_start_date,planned_end_date,actual_start_date,actual_end_date,estimated_amount,contracted_amount,estimated_cost,currency,notes)
  VALUES (_client_id,trim(_name),new_code,next_number,_description,coalesce(_status,'quoted'),_planned_start_date,_planned_end_date,_actual_start_date,_actual_end_date,greatest(coalesce(_estimated_amount,0),0),greatest(coalesce(_contracted_amount,0),0),greatest(coalesce(_estimated_cost,0),0),coalesce(_currency,'ARS'),_notes)
  RETURNING * INTO created_project;
  UPDATE public.clients SET next_project_number = next_number + 1 WHERE id = _client_id;
  RETURN created_project;
END; $$;
REVOKE ALL ON FUNCTION public.create_project_with_code(uuid,text,text,project_status,date,date,date,date,numeric,numeric,numeric,currency_code,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_code(uuid,text,text,project_status,date,date,date,date,numeric,numeric,numeric,currency_code,text) TO authenticated;

-- 4) Bootstrap: if no admin exists, promote the first existing user, and auto-promote first user going forward
DO $$
DECLARE first_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role='admin') THEN
    SELECT id INTO first_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
    IF first_user IS NOT NULL THEN
      INSERT INTO public.user_roles(user_id, role) VALUES (first_user, 'admin')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role='admin') THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
