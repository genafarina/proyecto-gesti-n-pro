
-- projects.client_id: RESTRICT -> CASCADE
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_client_id_fkey;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- project_collections.client_id: RESTRICT -> CASCADE
ALTER TABLE public.project_collections DROP CONSTRAINT IF EXISTS project_collections_client_id_fkey;
ALTER TABLE public.project_collections
  ADD CONSTRAINT project_collections_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
