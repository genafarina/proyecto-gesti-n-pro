# Correcciones de auditoría de notas de crédito

La migración 20261110120000 todavía no fue aplicada al proyecto remoto.
Las correcciones se incorporan en ese mismo archivo. No contiene cambios de
registros históricos.

1. La RPC de facturas actualiza el desglose con upsert y elimina solamente las
   líneas retiradas. Los proyectos referenciados por notas activas o anuladas
   siguen protegidos por la FK. Editar observaciones conserva las líneas.
2. Las escrituras de notas y distribuciones requieren las RPC administrativas.
   Guardar y anular bloquean primero factura y después nota; los triggers operan
   dentro de ese bloqueo. Se retiran permisos de escritura directa para evitar
   que una actualización REST adquiera primero el bloqueo de la nota.
3. Se omiten distribuciones vacías o cero. Editar puede incorporar o retirar
   proyectos; las revisiones guardan cabecera y desglose anteriores con usuario
   y timestamp. Las sumas y límites se validan también al finalizar la transacción.
4. La interfaz calcula en centavos enteros, incluyendo disponibilidad, límites,
   distribución e indicadores. PostgreSQL conserva NUMERIC(14,2).
5. Una consulta explícita comprueba tablas y columnas incluso cuando no hay
   filas. Se bloquea el formulario mientras falta el esquema o hay errores de
   carga. Las vistas anteriores se normalizan usando los importes originales;
   los indicadores de notas se ocultan hasta que el esquema esté disponible.
6. Se conserva el PDF al reemplazarlo, quitarlo o fallar una solicitud. También
   se retira el borrado automático de PDF de facturas, porque comparten bucket.
   Desvincular un archivo conserva sus otras referencias. No se implementa
   limpieza automática: los objetos huérfanos permanecen privados.
7. Se agregan regresiones monetarias y de esquema antiguo, pgTAP con
   SET CONSTRAINTS ALL IMMEDIATE, y un ensayo con dos conexiones PostgreSQL
   independientes para edición/anulación y sobreacreditación concurrente.

## Verificación local

- Tests de aplicación: 30 aprobados.
- pgTAP real 1.2.0, PostgreSQL 17.6: 130 comprobaciones aprobadas
  (56 de notas, 42 de facturación y 32 multiproyecto).
- Dos escenarios de concurrencia aprobados.
- TypeScript y build aprobados; ESLint aprobado con 0 errores y 6 advertencias
  preexistentes de Fast Refresh.

La imagen de Supabase oficial pudo descargarse desde su registro Docker Hub,
pero su extracción agotó el espacio del entorno. Se usó PostgreSQL 17.6 con
pgTAP auténtico; Auth y Storage se representaron mediante el scaffolding local
incluido en scripts/fixtures/local-supabase-scaffolding.sql. No se sustituyeron
funciones de pgTAP.

Para reproducir las pruebas de base sobre un contenedor nuevo y descartable:
aplicar el scaffolding, todas las migraciones en orden y luego cada archivo
supabase/tests/database/\*.sql usando psql con ON_ERROR_STOP. Revisar también la
salida TAP: un fallo de aserción puede no producir un código de salida distinto
de cero. El scaffolding no debe aplicarse en Supabase ni en una base existente.

El ensayo concurrente requiere una base local vacía llamada app con el esquema
aplicado; crea una copia de prueba independiente y la conserva para inspección:

```sh
CREDIT_NOTES_TEST_CONTAINER=nombre-contenedor-local node scripts/test-credit-note-concurrency.mjs
```

## Antes de publicar

Quedan pendientes las pruebas contra el stack completo de Supabase, la
generación/expiración de URLs firmadas mediante Storage HTTP y db lint oficial.
Las políticas SQL de lectura de PDF compartido, permisos de RPC y RLS sí fueron
ejecutadas sobre PostgreSQL local. La navegación completa de formularios no se
probó en un navegador con una sesión de staging.

El despliegue requiere revisar/aplicar la migración con autorización. Las notas
siguen restringidas a facturas ARS; no se introducen conversiones de moneda ni
devoluciones automáticas de caja.
