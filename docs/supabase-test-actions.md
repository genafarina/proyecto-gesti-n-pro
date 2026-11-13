# Migraciones manuales de Supabase TEST

Workflow: **Supabase TEST - migrate and validate**.
Archivo: .github/workflows/supabase-test-migrations.yml.
CLI fijada: 2.54.11. Destino único: ovtahpbcpifsrlrpapkx.

## Configuración manual en GitHub

1. Settings → Environments → New environment → **supabase-test**.
2. Restringir deployment branches a **feature/credit-notes**. Agregar required
   reviewers si el plan de GitHub lo permite.
3. En ese environment, agregar el secreto **SUPABASE_TEST_DB_URL**. No es una
   variable pública ni una clave service_role. No pegarlo en issues, PRs o logs.
4. Copiar la conexión de Supabase TEST → Connect. Usar conexión directa o Session
   Pooler, base postgres, puerto 5432; contraseña percent-encoded. El host directo
   debe ser db.ovtahpbcpifsrlrpapkx.supabase.co y el usuario postgres. En Session
   Pooler el host debe ser el aws-…pooler.supabase.com indicado por Supabase y el
   usuario postgres.ovtahpbcpifsrlrpapkx. Se exige TLS y se rechaza Production.

No se necesita SUPABASE_ACCESS_TOKEN: la conexión es explícita y no se usa link.
Si la base tiene restricciones IP, autorizar una salida de runner controlada;
no ampliar acceso globalmente por comodidad. Session Pooler facilita IPv4.

## Condición de GitHub antes de ejecutar

GitHub exige que un workflow_dispatch exista en la rama predeterminada para
permitir dispatch. Un archivo nuevo solamente en feature/credit-notes puede
devolver 404 aunque se indique --ref. Este PR no se fusiona ni ejecuta workflows
de migración. Para habilitarlo posteriormente, revisar y aprobar por separado
la incorporación de la definición del workflow a la rama predeterminada. No es
necesario fusionar toda la funcionalidad para ese bootstrap; cualquier bootstrap
debe incluir o referenciar también el runner que usa la definición.

No cambiar la rama predeterminada para eludir esta condición. La ejecución
permitida seguirá limitada a feature/credit-notes y su código auditado.

## Ejecución posterior, solamente con autorización

La base debe ser nueva, sin usuarios reales ni registros de negocio. El preflight
es de solo lectura y detiene el workflow antes de migrar si encuentra usuarios o
datos: los fixtures pgTAP actuales esperan ese estado. No elimina ni reinicia
información. Si no está vacía, usar otro proyecto de pruebas vacío.

Cuando la definición ya esté registrada en la rama predeterminada:

```bash
gh workflow run supabase-test-migrations.yml \
  --repo genafarina/proyecto-gesti-n-pro \
  --ref feature/credit-notes \
  -f confirmation=ovtahpbcpifsrlrpapkx
```

Alternativa: Actions → Supabase TEST - migrate and validate → Run workflow →
seleccionar feature/credit-notes → escribir el Project Reference → confirmar.
Revisar/aprobar el environment supabase-test si tiene revisores configurados.

El push y los PR no disparan este workflow. El CI existente sí puede ejecutar
pruebas locales sobre un PR, sin utilizar este secreto. Las integraciones de
Vercel existentes pueden crear un Preview al publicar una rama; este workflow
no configura ni despliega Vercel.

## Qué ejecuta y qué informa

- Valida la URI offline, rechaza Production y destinos ambiguos u overrides.
- Comprueba que 5e4b6ff es antecesor de la rama ejecutada.
- Comprueba que TEST está vacío, consulta historial y realiza db push --dry-run.
- Aplica solamente migraciones pendientes con db push y verifica sus versiones.
- Ejecuta db lint y las tres suites SQL con pgTAP real y ROLLBACK. Comprueba el
  plan TAP y todas las aserciones; un código de salida cero por sí solo no basta.
- Publica etapas, nombres de migraciones y cantidades de aserciones en el resumen.
  No publica URIs, credenciales, salida SQL, stderr de CLI ni artefactos con logs.

Ante un fallo se detiene; las migraciones anteriores que ya confirmaron no se
revierten automáticamente. No ejecutar reparaciones, resets o limpiezas de datos
para reintentar. Investigar el estado de TEST y corregir la causa.

Las pruebas SQL escriben solamente fixtures transaccionales en TEST. No prueban
sesiones Auth reales, expiración de URLs firmadas por HTTP, navegación de Preview
ni concurrencia HTTP: esas validaciones siguen pendientes antes de publicar.

## Verificación local del guard, sin secretos ni red

```bash
python3 -m unittest discover -s scripts -p 'test_supabase_test_migrations.py'
```
