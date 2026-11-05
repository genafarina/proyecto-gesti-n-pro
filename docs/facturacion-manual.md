# Facturación manual

Este módulo registra comprobantes que ya fueron emitidos. No emite facturas electrónicas, no se
conecta con ARCA y no reemplaza los movimientos de caja existentes.

## Modelo e integridad

- `invoices` conserva los datos administrativos y fiscales informados manualmente. Neto e IVA son
  opcionales; el total es obligatorio. Punto de venta y número son texto numérico para conservar
  los ceros iniciales. Se admiten facturas A/B/C/E/M y un tipo genérico; las notas de crédito o
  débito requieren reglas contables de signo y quedan fuera de esta fase.
- `invoice_allocations` distribuye importes de `project_collections` entre facturas. Es una relación
  muchos a muchos: admite pagos parciales, varios cobros por factura y un cobro repartido entre
  varias facturas. Cada fila identifica además la obra de la factura a la que corresponde la
  distribución contable.
- `invoice_projects` distribuye exactamente el total de una factura entre una o más obras del mismo
  cliente y moneda. La suma de sus líneas debe coincidir con el total del comprobante.
- `invoice_balances` calcula importe imputado, saldo y estado de cobranza. El estado administrativo
  (`issued` o `cancelled`) permanece separado.
- `invoice_project_balances` muestra facturado, cobrado y pendiente por cada obra sin duplicar la
  cabecera de la factura.
- `collection_allocation_summary` calcula cuánto queda disponible en cada cobro. Un cobro sin
  imputaciones funciona como anticipo.
- Los triggers bloquean sobreasignaciones, combinaciones de cliente/proyecto/moneda inválidas,
  cambios incompatibles en cobros vinculados y la anulación de facturas con imputaciones activas.
- Todos los proyectos de una factura usan la moneda de la factura. No se mezclan ARS y USD porque
  todavía no existe una conversión registrada y auditable.
- Las imputaciones bloquean las filas de factura y cobro antes de sumar saldos. La creación de
  facturas y los cambios de cliente/moneda del proyecto comparten además un bloqueo transaccional,
  por lo que operaciones simultáneas se serializan antes de validar.
- Las facturas anuladas no suman en los indicadores. Facturación y caja nunca se suman como si
  fueran el mismo hecho financiero, y ARS/USD siempre se presentan por separado.
- `project_collections` sigue siendo el único hecho de caja. Distribuir un cobro entre obras crea
  imputaciones contables, nunca cobros ficticios; por eso el Dashboard cuenta el ingreso real una
  sola vez.
- El bucket privado `invoice-documents` admite únicamente PDF de hasta 10 MB. La base guarda una
  ruta de objeto; la aplicación genera una URL firmada de corta duración al abrirlo. La política
  de lectura exige que el objeto siga referenciado por una factura visible, por lo que un PDF
  huérfano no queda accesible aunque falle su eliminación física.

Las tablas tienen lectura para usuarios autenticados y escritura sólo para administradores,
coherente con el resto de la aplicación. El registro público continúa deshabilitado y esta fase no
modifica la configuración de Authentication.

## Prueba local sin afectar Supabase remoto

No vincular la CLI a un proyecto remoto ni ejecutar `supabase db push`. Desde una copia local y con
Docker disponible:

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run lint
bun run build
supabase db start
supabase db lint --local --fail-on error
supabase test db
```

`supabase db start` crea contenedores locales y aplica todas las migraciones a una base vacía. Las
pruebas pgTAP se ejecutan dentro de una transacción y terminan con `ROLLBACK`, por lo que no dejan
datos de prueba. Para probar la interfaz, usar las credenciales públicas de la instancia local en
un `.env.local` no versionado y ejecutar `bun run dev`.

El build válido para Vercel debe contener `.vercel/output/config.json`, `.vercel/output/static` y la
función del servidor generada por Nitro. Ninguno de estos pasos publica en GitHub, Vercel o
Supabase.

La rama `feature/facturacion-manual` está incluida en el workflow de GitHub Actions. Toda migración
nueva debe validarse en CI y aplicarse al entorno correspondiente antes de publicar un Preview que
dependa de ella.

## Monedas en el Dashboard

Los movimientos de proyecto se agrupan por la moneda del proyecto. El resultado periódico ARS y
el resultado de proyectos USD se muestran por separado; no existe conversión implícita. Los gastos
generales históricos no tienen columna de moneda, por lo que se conservan en el resumen ARS hasta
que una fase futura defina una moneda por movimiento o un mecanismo de conversión auditable.

## Aplicación y reversión futura de la migración

La migración `20261105090000_add_manual_invoicing.sql` es aditiva. Antes de aplicarla a un entorno
compartido se debe realizar respaldo y ejecutar primero CI sobre una base limpia. La aplicación
remota requiere una autorización separada.

La extensión para facturas de varias obras vive exclusivamente en
`20261105160000_extend_invoicing_multi_project.sql`; no modifica la migración histórica ya aplicada.
Al ejecutarse, crea una línea `invoice_projects` por cada factura existente y agrega el proyecto a
cada imputación existente antes de activar las nuevas restricciones. La operación conserva IDs,
importes, PDF y relaciones previas.

Si fuese necesario revertirla después de haberla aplicado, primero se deben exportar los PDF y los
registros creados. Luego, en una migración de reversión revisada, se eliminan las políticas y el
bucket `invoice-documents`, las vistas, triggers y funciones de esta fase, las tablas
`invoice_allocations` e `invoices`, el índice de código histórico y finalmente
`projects.legacy_code`. Esa reversión es destructiva para datos de facturación y no debe ejecutarse
automáticamente.

## Preparación de la importación histórica

`projects.legacy_code` permite mapear códigos como `OB-001` sin alterar la numeración automática.
No hace falta ampliar ahora las tablas operativas con datos del Excel.

La importación posterior debería usar tablas de _staging_ aisladas y un proceso en dos pasos:

1. Cargar filas crudas con identificador de archivo, hoja, número de fila y valores originales,
   sin insertar todavía en las tablas operativas.
2. Ejecutar una previsualización idempotente que resuelva clientes/proyectos por código histórico,
   detecte comprobantes o movimientos duplicados y produzca incidencias para revisión humana.
3. Confirmar explícitamente sólo las filas válidas y conservar la relación entre cada registro
   creado y su fila de origen.

Las imputaciones ambiguas —por ejemplo, dos cobros del mismo importe asociados a una única
factura— deben quedar marcadas como conflicto. No se deben redistribuir, anular ni considerar
pagadas automáticamente. Como mejora de la fase de importación se recomienda agregar un
`import_batch_id` y una referencia de origen únicamente en las tablas de _staging_; sólo después de
probar el flujo se evaluará si alguna referencia externa merece persistir en las tablas operativas.

La conciliación bancaria queda fuera de esta fase. `project_collections.payment_account_id` se
conserva al editar cobros, de modo que una conciliación futura pueda asociar extractos sin duplicar
ingresos.
