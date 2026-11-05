BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(42);

SELECT has_table('public', 'invoices', 'invoices existe');
SELECT has_table('public', 'invoice_allocations', 'invoice_allocations existe');
SELECT col_type_is('public', 'projects', 'legacy_code', 'text', 'projects conserva un código histórico');
SELECT is(
  (SELECT public::text FROM storage.buckets WHERE id = 'invoice-documents'),
  'false',
  'el bucket de facturas es privado'
);
SELECT is(
  (
    SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']
      FROM pg_class
     WHERE oid = 'public.invoice_balances'::regclass
  ),
  true,
  'invoice_balances aplica RLS como usuario invocante y actúa como barrera de seguridad'
);
SELECT is(
  (
    SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']
      FROM pg_class
     WHERE oid = 'public.collection_allocation_summary'::regclass
  ),
  true,
  'collection_allocation_summary aplica RLS como usuario invocante y actúa como barrera de seguridad'
);
SELECT is(
  has_table_privilege('anon', 'public.invoice_balances', 'SELECT'),
  false,
  'anon no puede consultar la vista de facturas'
);
SELECT is(
  position(
    'PG_ADVISORY_XACT_LOCK' IN upper(pg_get_functiondef('public.validate_invoice()'::regprocedure))
  ) > 0,
  true,
  'la validación de factura bloquea el proyecto durante operaciones concurrentes'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'invoice-admin@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

SELECT is(
  (SELECT count(*)::integer FROM public.user_roles WHERE user_id = '11111111-1111-1111-1111-111111111111' AND role = 'admin'),
  1,
  'el primer usuario de prueba es administrador'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

INSERT INTO public.clients (id, name, code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Cliente Uno', 'CU'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Cliente Dos', 'CD');

INSERT INTO public.projects (
  id, client_id, name, code, project_number, contracted_amount, currency
) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Obra Uno', 'CU-01', 1, 5000, 'ARS'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Obra Dos', 'CD-01', 1, 2000, 'ARS');

INSERT INTO public.project_collections (
  id, project_id, client_id, collection_date, amount, payment_method, description
) VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', current_date, 1500, 'bank_transfer', 'Cobro principal'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', current_date, 400, 'bank_transfer', 'Segundo cobro'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc3', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', current_date, 250, 'bank_transfer', 'Anticipo');

SELECT lives_ok(
  $$
    INSERT INTO public.invoices (
      id, client_id, project_id, document_type, point_of_sale, invoice_number,
      issue_date, concept, total_amount, currency
    ) VALUES (
      'dddddddd-dddd-dddd-dddd-ddddddddddd1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'C', '00001', '00000001', current_date, 'Factura sin PDF', 1000, 'ARS'
    )
  $$,
  'crea una factura sin PDF'
);

SELECT lives_ok(
  $$
    INSERT INTO public.invoices (
      id, client_id, project_id, document_type, point_of_sale, invoice_number,
      issue_date, concept, total_amount, currency, pdf_path
    ) VALUES (
      'dddddddd-dddd-dddd-dddd-ddddddddddd2',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'C', '00001', '00000002', current_date, 'Factura con PDF', 800, 'ARS',
      '11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddd2/factura.pdf'
    )
  $$,
  'crea una factura con ruta privada de PDF'
);

SELECT lives_ok(
  $$UPDATE public.invoices SET concept = 'Factura editada' WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'$$,
  'edita una factura'
);

SELECT is((SELECT count(*)::integer FROM public.invoices), 2, 'se guardaron las dos facturas');

SELECT lives_ok(
  $$
    INSERT INTO public.invoice_allocations (id, invoice_id, collection_id, amount)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 600)
  $$,
  'imputa el primer cobro parcialmente a una factura'
);

SELECT lives_ok(
  $$
    INSERT INTO public.invoice_allocations (id, invoice_id, collection_id, amount)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 400)
  $$,
  'una factura admite varios cobros'
);

SELECT lives_ok(
  $$
    INSERT INTO public.invoice_allocations (id, invoice_id, collection_id, amount)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 400)
  $$,
  'un cobro se reparte entre varias facturas'
);

SELECT is(
  (SELECT payment_status FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'),
  'paid',
  'la primera factura queda pagada'
);
SELECT is(
  (SELECT payment_status FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'),
  'partial',
  'la segunda factura queda parcialmente cobrada'
);
SELECT is(
  (SELECT allocated_amount::numeric FROM public.collection_allocation_summary WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'),
  1000::numeric,
  'el cobro compartido suma ambas imputaciones'
);
SELECT is(
  (SELECT unallocated_amount::numeric FROM public.collection_allocation_summary WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc3'),
  250::numeric,
  'un anticipo puede quedar completamente sin imputar'
);
SELECT is(
  (SELECT sum(amount)::numeric FROM public.project_collections),
  2150::numeric,
  'imputar cobros no duplica ni modifica el ingreso de caja'
);

SELECT throws_matching(
  $$INSERT INTO public.invoice_allocations (invoice_id, collection_id, amount) VALUES ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc3', 1)$$,
  'supera el saldo pendiente de la factura',
  'impide sobreasignar una factura'
);

SELECT throws_matching(
  $$
    INSERT INTO public.invoices (
      id, client_id, project_id, document_type, point_of_sale, invoice_number,
      issue_date, concept, total_amount, currency
    ) VALUES (
      'dddddddd-dddd-dddd-dddd-ddddddddddd3',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'C', '00001', '00000003', current_date, 'Factura USD', 1000, 'USD'
    )
  $$,
  'misma moneda',
  'impide crear una factura en una moneda distinta de la del proyecto'
);

INSERT INTO public.invoices (
  id, client_id, project_id, document_type, point_of_sale, invoice_number,
  issue_date, concept, total_amount, currency
) VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'C', '00001', '00000004', current_date, 'Otra obra', 1000, 'ARS'),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'C', '00001', '00000005', current_date, 'Control de disponible', 1000, 'ARS');

SELECT throws_matching(
  $$INSERT INTO public.invoice_allocations (invoice_id, collection_id, amount) VALUES ('dddddddd-dddd-dddd-dddd-ddddddddddd4', 'cccccccc-cccc-cccc-cccc-ccccccccccc3', 10)$$,
  'mismo proyecto y cliente',
  'impide asociaciones con otro proyecto o cliente'
);

SELECT throws_matching(
  $$INSERT INTO public.invoice_allocations (invoice_id, collection_id, amount) VALUES ('dddddddd-dddd-dddd-dddd-ddddddddddd5', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 600)$$,
  'supera el importe disponible del cobro',
  'impide sobreasignar un cobro'
);

SELECT throws_matching(
  $$UPDATE public.project_collections SET amount = 900 WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'$$,
  'no puede ser menor al total ya imputado',
  'impide reducir un cobro por debajo de sus imputaciones'
);

SELECT lives_ok(
  $$UPDATE public.project_collections SET description = 'Cobro principal auditado' WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'$$,
  'permite corregir metadatos no financieros de un cobro imputado'
);

SELECT throws_matching(
  $$UPDATE public.project_collections SET project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2' WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'$$,
  'No se puede cambiar proyecto o cliente de un cobro imputado',
  'impide mover un cobro imputado a otro proyecto o cliente'
);

SELECT throws_matching(
  $$UPDATE public.invoices SET total_amount = 999 WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'$$,
  'no puede ser menor al importe ya cobrado',
  'impide reducir una factura por debajo de sus cobros imputados'
);

SELECT throws_matching(
  $$DELETE FROM public.project_collections WHERE id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'$$,
  'Desvinculá las facturas antes de eliminar el cobro',
  'impide eliminar un cobro vinculado'
);

SELECT throws_matching(
  $$UPDATE public.invoices SET status = 'cancelled' WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'$$,
  'Desvinculá los cobros antes de anular la factura',
  'impide anular una factura con cobros imputados'
);

SELECT lives_ok(
  $$DELETE FROM public.invoice_allocations WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3'$$,
  'permite desvincular un cobro'
);
SELECT lives_ok(
  $$UPDATE public.invoices SET status = 'cancelled' WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'$$,
  'permite anular una factura sin imputaciones'
);
SELECT is(
  (SELECT status FROM public.invoices WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'),
  'cancelled',
  'conserva el estado administrativo anulado'
);

SELECT throws_matching(
  $$DELETE FROM public.invoices WHERE id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'$$,
  'invoice_allocations_invoice_id_fkey',
  'impide eliminar una factura con historial de imputaciones'
);

RESET ROLE;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'invoice-viewer@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
INSERT INTO public.user_roles (user_id, role)
VALUES ('22222222-2222-2222-2222-222222222222', 'viewer');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

SELECT lives_ok(
  $$SELECT count(*) FROM public.invoice_balances$$,
  'un usuario autenticado puede consultar facturas'
);
SELECT throws_matching(
  $$
    INSERT INTO public.invoices (
      client_id, project_id, document_type, point_of_sale, invoice_number,
      issue_date, concept, total_amount, currency
    ) VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'C', '00001', '00000999', current_date, 'No autorizado', 10, 'ARS'
    )
  $$,
  'row-level security',
  'un usuario sin rol admin no puede crear facturas'
);

RESET ROLE;

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'invoice-documents',
    '11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddd2/factura.pdf'
  ),
  ('invoice-documents', 'orphan/no-referenciado.pdf');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

SELECT is(
  (
    SELECT count(*)::integer
      FROM storage.objects
     WHERE name = '11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-ddddddddddd2/factura.pdf'
  ),
  1,
  'un usuario autenticado puede consultar el PDF referenciado por una factura visible'
);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects WHERE name = 'orphan/no-referenciado.pdf'),
  0,
  'un PDF huérfano no queda accesible aunque su objeto permanezca en Storage'
);

RESET ROLE;

SELECT is(
  (SELECT allowed_mime_types[1] FROM storage.buckets WHERE id = 'invoice-documents'),
  'application/pdf',
  'el bucket solo admite PDF'
);

SELECT lives_ok(
  $$UPDATE public.projects SET legacy_code = 'OB-001' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'$$,
  'permite conservar el código histórico de una obra'
);
SELECT throws_matching(
  $$UPDATE public.projects SET legacy_code = 'ob-001' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'$$,
  'projects_legacy_code_unique_idx',
  'el código histórico es único sin distinguir mayúsculas'
);

SELECT * FROM finish();
ROLLBACK;
