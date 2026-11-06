BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(32);

SELECT has_table('public', 'invoice_projects', 'existe el desglose de facturas por proyecto');
SELECT has_column(
  'public',
  'invoice_allocations',
  'project_id',
  'cada imputación identifica su distribución contable por proyecto'
);
SELECT has_view(
  'public',
  'invoice_project_balances',
  'existe el resumen facturado, cobrado y pendiente por proyecto'
);
SELECT is(
  (
    SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']
      FROM pg_class
     WHERE oid = 'public.invoice_project_balances'::regclass
  ),
  true,
  'la vista por proyecto respeta RLS del usuario invocante'
);
SELECT is(
  has_table_privilege('anon', 'public.invoice_project_balances', 'SELECT'),
  false,
  'anon no puede consultar el desglose financiero'
);
SELECT is(
  position(
    'FOR UPDATE' IN upper(pg_get_functiondef('public.validate_invoice_allocation()'::regprocedure))
  ) > 0,
  true,
  'las imputaciones bloquean filas antes de validar concurrencia'
);
SELECT is(
  position(
    'PG_ADVISORY_XACT_LOCK' IN upper(
      pg_get_functiondef('public.save_invoice_with_projects(jsonb,jsonb)'::regprocedure)
    )
  ) > 0,
  true,
  'la edición del desglose comparte el bloqueo transaccional de proyectos'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'multi-invoice-admin@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

INSERT INTO public.clients (id, name, code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'Cliente Multi', 'CM'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa20', 'Cliente Ajeno', 'CA');

INSERT INTO public.projects (
  id, client_id, name, code, project_number, contracted_amount, currency
) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'Obra Norte', 'CM-01', 1, 3000, 'ARS'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'Obra Sur', 'CM-02', 2, 2000, 'ARS'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb12', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'Obra USD', 'CM-03', 3, 1000, 'USD'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa20', 'Obra Ajena', 'CA-01', 1, 1000, 'ARS');

INSERT INTO public.project_collections (
  id, project_id, client_id, collection_date, amount, payment_method, description
) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc10', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', current_date, 1000, 'bank_transfer', 'Transferencia única'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', current_date, 500, 'bank_transfer', 'Segundo cobro');

INSERT INTO public.invoices (
  id, client_id, project_id, document_type, point_of_sale, invoice_number,
  issue_date, concept, total_amount, currency
) VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddd10',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10',
  'C', '00002', '00000010', current_date, 'Factura compatible existente', 250, 'ARS'
);

SELECT is(
  (
    SELECT amount::numeric
      FROM public.invoice_projects
     WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd10'
       AND project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10'
  ),
  250::numeric,
  'una factura de un proyecto conserva el flujo histórico sencillo'
);

SELECT lives_ok(
  $$
    SELECT public.save_invoice_with_projects(
      '{
        "id":"dddddddd-dddd-dddd-dddd-dddddddddd11",
        "client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10",
        "document_type":"C",
        "point_of_sale":"00002",
        "invoice_number":"00000011",
        "issue_date":"2026-11-05",
        "due_date":null,
        "concept":"Factura de dos obras",
        "net_amount":null,
        "vat_amount":null,
        "total_amount":1500,
        "currency":"ARS",
        "pdf_path":null,
        "notes":null,
        "status":"issued"
      }'::jsonb,
      '[
        {"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10","amount":900},
        {"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":600}
      ]'::jsonb
    )
  $$,
  'crea atómicamente una factura distribuida entre dos proyectos'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT is(
  (SELECT project_count FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'),
  2,
  'el resumen de factura informa ambos proyectos sin duplicar la cabecera'
);
SELECT is(
  (SELECT sum(project_amount)::numeric FROM public.invoice_project_balances WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'),
  1500::numeric,
  'el total se distribuye exactamente entre las obras'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'),
  1,
  'la vista global conserva una sola fila por factura'
);

SELECT throws_matching(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd12","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10","document_type":"C","point_of_sale":"00002","invoice_number":"00000012","issue_date":"2026-11-05","concept":"Suma inválida","total_amount":1000,"currency":"ARS","status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10","amount":999.99}]'::jsonb
    )
  $$,
  'coincidir exactamente',
  'rechaza un desglose cuya suma no coincide con el total'
);
SELECT throws_matching(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd12","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10","document_type":"C","point_of_sale":"00002","invoice_number":"00000012","issue_date":"2026-11-05","concept":"Cliente inválido","total_amount":1000,"currency":"ARS","status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20","amount":1000}]'::jsonb
    )
  $$,
  'mismo cliente y moneda',
  'rechaza proyectos de otro cliente'
);
SELECT throws_matching(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd12","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10","document_type":"C","point_of_sale":"00002","invoice_number":"00000012","issue_date":"2026-11-05","concept":"Moneda inválida","total_amount":1000,"currency":"ARS","status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb12","amount":1000}]'::jsonb
    )
  $$,
  'mismo cliente y moneda',
  'rechaza proyectos de otra moneda'
);

SELECT lives_ok(
  $$
    SELECT public.allocate_collection_to_invoice_projects(
      'dddddddd-dddd-dddd-dddd-dddddddddd11',
      'cccccccc-cccc-cccc-cccc-cccccccccc10',
      '[
        {"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10","amount":600},
        {"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":300}
      ]'::jsonb
    )
  $$,
  'distribuye un único cobro real entre dos proyectos de la factura'
);
SELECT is(
  (SELECT count(*)::integer FROM public.project_collections),
  2,
  'la distribución no crea cobros ficticios'
);
SELECT is(
  (SELECT sum(amount)::numeric FROM public.project_collections),
  1500::numeric,
  'el ingreso real permanece contabilizado una sola vez'
);
SELECT is(
  (SELECT allocated_amount::numeric FROM public.collection_allocation_summary WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccc10'),
  900::numeric,
  'el cobro real resume todas sus distribuciones contables'
);
SELECT is(
  (SELECT allocated_amount::numeric FROM public.invoice_project_balances WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd11' AND project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10'),
  600::numeric,
  'muestra el importe cobrado para la primera obra'
);
SELECT is(
  (SELECT allocated_amount::numeric FROM public.invoice_project_balances WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd11' AND project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11'),
  300::numeric,
  'muestra la distribución cobrada para la segunda obra'
);
SELECT is(
  (SELECT payment_status FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'),
  'partial',
  'la factura queda parcialmente cobrada'
);

SELECT lives_ok(
  $$
    SELECT public.allocate_collection_to_invoice_projects(
      'dddddddd-dddd-dddd-dddd-dddddddddd11',
      'cccccccc-cccc-cccc-cccc-cccccccccc11',
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":300}]'::jsonb
    )
  $$,
  'admite varios cobros aplicados a una misma factura'
);
SELECT is(
  (SELECT allocated_amount::numeric FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'),
  1200::numeric,
  'la factura suma todos los cobros sin superar su total'
);
SELECT throws_matching(
  $$
    SELECT public.allocate_collection_to_invoice_projects(
      'dddddddd-dddd-dddd-dddd-dddddddddd11',
      'cccccccc-cccc-cccc-cccc-cccccccccc11',
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":1}]'::jsonb
    )
  $$,
  'saldo pendiente del proyecto',
  'impide sobreasignar una obra dentro de la factura'
);
SELECT is(
  (SELECT unallocated_amount::numeric FROM public.collection_allocation_summary WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccc11'),
  200::numeric,
  'un cobro puede conservar un anticipo no imputado'
);

SELECT lives_ok(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd11","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10","document_type":"C","point_of_sale":"00002","invoice_number":"00000011","issue_date":"2026-11-05","due_date":null,"concept":"Factura editada","net_amount":null,"vat_amount":null,"total_amount":1500,"currency":"ARS","pdf_path":null,"notes":null,"status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10","amount":700},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":800}]'::jsonb
    )
  $$,
  'permite editar un desglose compatible con lo ya cobrado'
);
SELECT throws_matching(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd11","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10","document_type":"C","point_of_sale":"00002","invoice_number":"00000011","issue_date":"2026-11-05","due_date":null,"concept":"Factura incompatible","net_amount":null,"vat_amount":null,"total_amount":1500,"currency":"ARS","pdf_path":null,"notes":null,"status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10","amount":500},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11","amount":1000}]'::jsonb
    )
  $$,
  'incompatible con los cobros ya imputados',
  'impide reducir una obra por debajo de sus cobros imputados'
);
SELECT throws_matching(
  $$DELETE FROM public.invoices WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd11'$$,
  'invoice_allocations_invoice_id_fkey',
  'impide eliminar una factura con cobros asociados'
);

RESET ROLE;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'multi-invoice-viewer@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
INSERT INTO public.user_roles (user_id, role)
VALUES ('44444444-4444-4444-4444-444444444444', 'viewer');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

SELECT lives_ok(
  $$SELECT count(*) FROM public.invoice_project_balances$$,
  'un usuario autenticado puede consultar el desglose visible'
);
SELECT throws_matching(
  $$
    INSERT INTO public.invoice_projects (invoice_id, project_id, amount)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddd10', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 1)
  $$,
  'row-level security',
  'un usuario sin rol admin no puede alterar el desglose'
);

RESET ROLE;

SELECT is(
  (
    SELECT position('invoices' IN lower(qual)) > 0
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'invoice_documents select auth'
  ),
  true,
  'los PDF privados siguen exigiendo una factura visible y referenciada'
);

SELECT * FROM finish();
ROLLBACK;
