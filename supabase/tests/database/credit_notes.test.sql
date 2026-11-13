BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(56);

SELECT has_table('public', 'credit_notes', 'credit_notes existe');
SELECT has_table('public', 'credit_note_projects', 'credit_note_projects existe');
SELECT col_type_is('public', 'credit_notes', 'amount', 'numeric(14,2)', 'el importe usa precisión monetaria');
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'credit_notes_document_unique_idx'
  ),
  1,
  'existe la restricción de numeración fiscal única'
);
SELECT is(
  (
    SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']
      FROM pg_class
     WHERE oid = 'public.invoice_balances'::regclass
  ),
  true,
  'invoice_balances conserva RLS como invocante'
);
SELECT is(
  has_table_privilege('anon', 'public.credit_notes', 'SELECT'),
  false,
  'anon no puede consultar notas de crédito'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.credit_notes'::regclass),
  true,
  'credit_notes tiene RLS habilitado'
);
SELECT is(
  position(
    'FOR UPDATE' IN upper(pg_get_functiondef('public.validate_credit_note()'::regprocedure))
  ) > 0,
  true,
  'la validación serializa operaciones concurrentes por factura'
);
SELECT is(
  (SELECT public::text FROM storage.buckets WHERE id = 'invoice-documents'),
  'false',
  'los PDF permanecen en un bucket privado'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-5555-5555-555555555555',
  'authenticated', 'authenticated', 'credit-note-admin@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.user_roles
     WHERE user_id = '55555555-5555-5555-5555-555555555555'
       AND role = 'admin'
  ),
  1,
  'el primer usuario de prueba es administrador'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

INSERT INTO public.clients (id, name, code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51', 'Cliente Crédito', 'CC'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa52', 'Otro Cliente', 'OC');

INSERT INTO public.projects (
  id, client_id, name, code, project_number, contracted_amount, currency
) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51', 'Proyecto Norte', 'CC-01', 1, 5000, 'ARS'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51', 'Proyecto Sur', 'CC-02', 2, 5000, 'ARS'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb53', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa52', 'Proyecto Ajeno', 'OC-01', 1, 5000, 'ARS');

SELECT lives_ok(
  $$
    SELECT public.save_invoice_with_projects(
      '{"id":"dddddddd-dddd-dddd-dddd-dddddddddd51","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51","document_type":"C","point_of_sale":"00005","invoice_number":"00000051","issue_date":"2026-11-10","due_date":null,"concept":"Factura multiproyecto","net_amount":null,"vat_amount":null,"total_amount":1000,"currency":"ARS","pdf_path":null,"notes":null,"status":"issued"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":600},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52","amount":400}]'::jsonb
    )
  $$,
  'crea la factura distribuida entre dos proyectos'
);

SELECT lives_ok(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000001","issue_date":"2026-11-10","amount":250,"reason":"Ajuste parcial","pdf_path":"55555555-5555-5555-5555-555555555555/credit-notes/eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51/nota.pdf"}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":150},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52","amount":100}]'::jsonb
    )
  $$,
  'registra una nota parcial multiproyecto'
);
SELECT is((SELECT amount FROM public.credit_notes WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51'), 250::numeric, 'conserva el importe positivo de la nota parcial');
SELECT is((SELECT net_billed_amount FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 750::numeric, 'calcula la facturación neta después de la primera nota');
SELECT is((SELECT credit_note_amount FROM public.invoice_project_balances WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd51' AND project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51'), 150::numeric, 'distribuye el crédito al primer proyecto');

SELECT lives_ok(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee52","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000002","issue_date":"2026-11-10","amount":100,"reason":"Segundo ajuste","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":50},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52","amount":50}]'::jsonb
    )
  $$,
  'admite varias notas parciales sobre la misma factura'
);
SELECT is((SELECT credit_note_amount FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 350::numeric, 'acumula únicamente las notas activas');
SELECT is((SELECT net_billed_amount FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 650::numeric, 'resta todas las notas activas de la facturación bruta');

SELECT throws_matching(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee53","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000003","issue_date":"2026-11-10","amount":651,"reason":"Exceso","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":451},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52","amount":200}]'::jsonb
    )
  $$,
  'supera el importe original',
  'impide acreditar más que el importe original de la factura'
);
SELECT throws_matching(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee54","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"5","credit_note_number":"1","issue_date":"2026-11-10","amount":10,"reason":"Duplicada","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":10}]'::jsonb
    )
  $$,
  'credit_notes_document_unique_idx',
  'evita duplicados aunque cambien los ceros iniciales'
);
RESET ROLE;
SELECT throws_matching(
  $$
    INSERT INTO public.credit_notes (
      invoice_id, client_id, document_type, point_of_sale, credit_note_number,
      issue_date, amount, currency, reason
    ) VALUES (
      'dddddddd-dddd-dddd-dddd-dddddddddd51',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa52',
      'C', '00005', '00000099', '2026-11-10', 10, 'ARS', 'Cliente inválido'
    )
  $$,
  'mismo cliente',
  'impide vincular una nota con otro cliente'
);
SET LOCAL ROLE authenticated;

INSERT INTO public.invoices (
  id, client_id, project_id, document_type, point_of_sale, invoice_number,
  issue_date, concept, total_amount, currency
) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddd52', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51', 'C', '00005', '00000052', '2026-11-10', 'Factura a acreditar totalmente', 500, 'ARS'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd53', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51', 'C', '00005', '00000053', '2026-11-10', 'Factura ya cobrada', 1000, 'ARS');

SELECT lives_ok(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee55","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd52","document_type":"C","point_of_sale":"00005","credit_note_number":"00000004","issue_date":"2026-11-10","amount":500,"reason":"Crédito total","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":500}]'::jsonb
    )
  $$,
  'registra una nota de crédito total'
);
SELECT is((SELECT payment_status FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd52'), 'credited', 'la factura totalmente acreditada tiene estado acreditado');
SELECT is((SELECT balance_due FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd52'), 0::numeric, 'una nota total deja saldo pendiente cero');

INSERT INTO public.project_collections (
  id, project_id, client_id, collection_date, amount, payment_method, description
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc51',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51',
  '2026-11-10', 1000, 'bank_transfer', 'Cobro previo completo'
);
SELECT lives_ok(
  $$
    INSERT INTO public.invoice_allocations (invoice_id, collection_id, amount)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddd53', 'cccccccc-cccc-cccc-cccc-cccccccccc51', 1000)
  $$,
  'imputa completamente el cobro previo'
);
SELECT lives_ok(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee56","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd53","document_type":"C","point_of_sale":"00005","credit_note_number":"00000005","issue_date":"2026-11-10","amount":300,"reason":"Devolución pendiente","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":300}]'::jsonb
    )
  $$,
  'admite una nota sobre una factura previamente cobrada'
);
SELECT is((SELECT balance_due FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd53'), 0::numeric, 'el excedente no aparece como deuda negativa');
SELECT is((SELECT credit_balance FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd53'), 300::numeric, 'expone el excedente como crédito a favor o importe a devolver');
SELECT is((SELECT sum(amount) FROM public.project_collections WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccc51'), 1000::numeric, 'la nota no modifica ni duplica el cobro existente');
SELECT is((SELECT count(*)::integer FROM public.project_expenses), 0, 'la nota no se contabiliza como gasto del proyecto');
SELECT is((SELECT sum(credit_note_amount) FROM public.invoice_project_balances WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 350::numeric, 'la conciliación por proyectos coincide con el total acreditado');
SELECT is((SELECT issue_date::text FROM public.credit_notes WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51'), '2026-11-10', 'la fecha civil se conserva sin conversión UTC');

RESET ROLE;

INSERT INTO storage.objects (bucket_id, name)
VALUES
  ('invoice-documents', '55555555-5555-5555-5555-555555555555/credit-notes/eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51/nota.pdf'),
  ('invoice-documents', 'orphan/nota-no-referenciada.pdf');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '66666666-6666-6666-6666-666666666666',
  'authenticated', 'authenticated', 'credit-note-viewer@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
INSERT INTO public.user_roles (user_id, role)
VALUES ('66666666-6666-6666-6666-666666666666', 'viewer');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

SELECT lives_ok($$SELECT count(*) FROM public.credit_notes$$, 'un usuario autenticado puede consultar notas');
SELECT throws_matching(
  $$
    INSERT INTO public.credit_notes (
      invoice_id, client_id, document_type, point_of_sale, credit_note_number,
      issue_date, amount, currency, reason
    ) VALUES (
      'dddddddd-dddd-dddd-dddd-dddddddddd51',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51',
      'C', '00005', '00000100', '2026-11-10', 10, 'ARS', 'Sin permiso'
    )
  $$,
  'permission denied',
  'un usuario sin rol admin no puede crear notas'
);
SELECT throws_matching(
  $$
    SELECT public.save_credit_note_with_projects(
      '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee57","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000006","issue_date":"2026-11-10","amount":10,"reason":"Sin permiso","pdf_path":null}'::jsonb,
      '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":10}]'::jsonb
    )
  $$,
  'Solo un administrador',
  'el RPC también valida permisos administrativos'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM storage.objects
     WHERE name = '55555555-5555-5555-5555-555555555555/credit-notes/eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51/nota.pdf'
  ),
  1,
  'un usuario autenticado puede consultar el PDF referenciado por una nota'
);
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE name = 'orphan/nota-no-referenciada.pdf'), 0, 'un PDF huérfano permanece inaccesible');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

SELECT lives_ok($$SELECT public.cancel_credit_note('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee52')$$, 'un administrador puede anular una nota');
SELECT is((SELECT credit_note_amount FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 250::numeric, 'una nota anulada deja de afectar la facturación neta');
RESET ROLE;
SELECT throws_matching($$DELETE FROM public.credit_notes WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee52'$$, 'se anulan y no se eliminan', 'conserva la trazabilidad e impide borrar notas');
SELECT throws_matching($$UPDATE public.credit_notes SET reason = 'Cambio inválido' WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee52'$$, 'anulada es inmutable', 'una nota anulada es inmutable');

RESET ROLE;


-- Force pending checks: ROLLBACK alone never runs deferred constraint triggers.
SELECT lives_ok($$SET CONSTRAINTS ALL IMMEDIATE$$, 'ejecuta las restricciones diferidas acumuladas');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

SELECT lives_ok($$
  SELECT public.save_invoice_with_projects(
    (SELECT to_jsonb(i) || '{"notes":"Observaciones con notas activas"}'::jsonb
       FROM public.invoices i WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'),
    (SELECT jsonb_agg(jsonb_build_object('project_id',project_id,'amount',amount))
       FROM public.invoice_projects WHERE invoice_id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'));
  SET CONSTRAINTS ALL IMMEDIATE;
$$, 'edita observaciones de factura con notas activas y anuladas');
SET CONSTRAINTS ALL DEFERRED;

SELECT lives_ok($$
  SELECT public.save_credit_note_with_projects(
    '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee58","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000008","issue_date":"2026-11-10","amount":300.30,"reason":"Decimales","pdf_path":null}',
    '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":100.10},{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb52","amount":200.20}]');
  SET CONSTRAINTS ALL IMMEDIATE;
$$, 'acepta 100.10 + 200.20 = 300.30 con restricciones reales');
SET CONSTRAINTS ALL DEFERRED;

SELECT lives_ok($$
  SELECT public.save_credit_note_with_projects(
    '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee58","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000008","issue_date":"2026-11-10","amount":300.30,"reason":"Solo un proyecto","pdf_path":null}',
    '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":300.30}]');
  SET CONSTRAINTS ALL IMMEDIATE;
$$, 'edita la nota retirando un proyecto afectado');
SET CONSTRAINTS ALL DEFERRED;

SELECT is((SELECT net_billed_amount FROM public.invoice_balances WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51'), 449.70::numeric, 'conserva el saldo decimal acumulado');

SELECT throws_matching($$
  SELECT public.save_credit_note_with_projects(
    '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee59","invoice_id":"dddddddd-dddd-dddd-dddd-dddddddddd51","document_type":"C","point_of_sale":"00005","credit_note_number":"00000009","issue_date":"2026-11-10","amount":200,"reason":"Exceso por proyecto","pdf_path":null}',
    '[{"project_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb51","amount":200}]');
  SET CONSTRAINTS ALL IMMEDIATE;
$$, 'superan el importe original de un proyecto', 'la restricción diferida impide exceder un proyecto aunque haya saldo global');

SELECT throws_matching($$
  DO $test$
  BEGIN
    INSERT INTO public.credit_notes (id,invoice_id,client_id,document_type,point_of_sale,credit_note_number,issue_date,amount,reason)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee59','dddddddd-dddd-dddd-dddd-dddddddddd51','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51','C','5','9','2026-11-10',10,'Sin desglose');
    SET CONSTRAINTS ALL IMMEDIATE;
  END $test$;
$$, 'permission denied', 'incluso admin debe usar la RPC para escribir notas');

RESET ROLE;
SELECT throws_matching($$
  DO $test$
  BEGIN
    INSERT INTO public.credit_notes (id,invoice_id,client_id,document_type,point_of_sale,credit_note_number,issue_date,amount,reason)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee59','dddddddd-dddd-dddd-dddd-dddddddddd51','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa51','C','5','9','2026-11-10',10,'Sin desglose');
    SET CONSTRAINTS ALL IMMEDIATE;
  END $test$;
$$, 'al menos en un proyecto', 'el trigger diferido impide confirmar una nota sin distribución');
SELECT is((SELECT sum(amount) FROM public.project_collections), 1000::numeric, 'los cobros históricos no cambian con las ediciones');

SELECT lives_ok($$
  UPDATE public.invoices SET pdf_path =
    '55555555-5555-5555-5555-555555555555/credit-notes/eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51/nota.pdf'
   WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddd51';
  SELECT public.save_credit_note_with_projects(
    (SELECT to_jsonb(n) || '{"pdf_path":null}'::jsonb FROM public.credit_notes n
      WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51'),
    (SELECT jsonb_agg(jsonb_build_object('project_id',project_id,'amount',amount))
       FROM public.credit_note_projects WHERE credit_note_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51'));
  SET CONSTRAINTS ALL IMMEDIATE;
$$, 'desvincula PDF de nota compartido con una factura sin borrar el objeto');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE name =
  '55555555-5555-5555-5555-555555555555/credit-notes/eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51/nota.pdf'),
  1, 'el PDF compartido sigue accesible para la factura');
SELECT is(has_function_privilege('anon','public.save_credit_note_with_projects(jsonb,jsonb)','EXECUTE'),
  false, 'anon no puede ejecutar la RPC financiera');
SELECT is(has_table_privilege('authenticated','public.credit_note_projects','UPDATE'),
  false, 'las distribuciones no pueden escribirse por fuera de la RPC');
SELECT throws_matching($$SELECT public.cancel_credit_note('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51')$$,
  'Solo un administrador', 'viewer no puede anular por RPC');
SELECT is((SELECT jsonb_array_length(previous_projects) FROM public.credit_note_revisions
  WHERE credit_note_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee58'),
  2, 'conserva los dos proyectos del desglose anterior de la nota editada');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
