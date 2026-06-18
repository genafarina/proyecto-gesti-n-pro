# Auditoría de sincronización local vs origin/main

## Nota importante sobre Git en Lovable

En el sandbox de Lovable el estado de Git está **gestionado internamente** por la plataforma: los comandos como `git fetch`, `git status`, `git checkout`, `git reset`, `git pull`, `git push` están bloqueados para el agente. La sincronización bidireccional con GitHub `genafarina/proyecto-gesti-n-pro` la maneja Lovable automáticamente cada vez que se hace un cambio en la app o se pushea a `main`. Por eso esta tarea se limita a **auditar el contenido actual del workspace** (que refleja lo que Lovable tiene sincronizado con `origin/main`) y reportar.

## 1. Estado de la migración vieja

`supabase/migrations/20260613123000_add_client_project_codes.sql` **no existe** en el workspace. No hay nada que eliminar.

## 2. Migraciones actuales relacionadas al sistema de códigos

Presentes en `supabase/migrations/`:

- `20260616230043_544818f9-…sql` — agrega `clients.code` (UNIQUE), `projects.code` (UNIQUE), `projects.project_number`, índice único `(client_id, project_number)`, función `generate_client_code_base`, backfill inicial.
- `20260617205723_34d1ed31-…sql` — agrega `clients.next_project_number` (NOT NULL DEFAULT 1), backfill al máximo `project_number + 1`, corrige códigos de cliente mal generados (sufijos `X`).
- `20260617205834_92fc7e0f-…sql` — crea/actualiza `create_project_with_code(...)` con bloqueo `FOR UPDATE` sobre el cliente, inserta el proyecto e incrementa `next_project_number` en una sola transacción.
- `20260617210226_0d68bcd7-…sql` — `REVOKE`/`GRANT EXECUTE` de `create_project_with_code` a `authenticated` y `service_role`.
- `20260618181418_5f5deb24-…sql` — migración de endurecimiento de seguridad (RLS por rol admin, etc.). Reescribe `create_project_with_code` manteniendo `FOR UPDATE` y agrega chequeo interno `has_role(...,'admin')`. Esta es la última y es la que está activa en la base.

Migraciones no relacionadas a códigos (no se tocan): `20260611155423_…sql`, `20260612165754_…sql`.

## 3. Confirmaciones funcionales

- `src/lib/codes.ts` está presente. `generateClientCode` cumple los casos pedidos: una palabra ≥2 letras → primeras 2 letras (AVA → AV); varias palabras → iniciales (Patagonia Drilling → PD, Bodega Los Andes → BLA, Constructora Mendoza → CM); solo rellena con `X` cuando hay 1 sola letra (A → AX).
- `clients.code`, `projects.code`, `projects.project_number` y `clients.next_project_number` existen (vistos también en `src/integrations/supabase/types.ts`).
- `proyectos.tsx` crea proyectos vía `supabase.rpc("create_project_with_code", …)`; no usa `count()`.
- Restricciones únicas garantizadas por las migraciones: `clients.code`, `projects.code`, `(client_id, project_number)`.
- Gastos y cobros muestran `CODE - Nombre` (`gastos.tsx`, `cobros.tsx`, `dashboard.tsx`).

## 4. Reporte de código potencialmente muerto (sin tocar)

- `getNextProjectNumber(clientId)` en `src/lib/codes.ts` solo está **exportada**; ningún archivo bajo `src/` la importa. Es código muerto candidato a remoción **en otra tarea**.
- La función SQL `create_project_with_code` ya **usa `FOR UPDATE`** sobre `public.clients` para serializar el incremento del contador; no hace falta mejora.

## 5. Resultado

- Sincronización local: el workspace ya refleja `origin/main` (sumado a la última migración de seguridad aplicada en Lovable).
- Archivos obsoletos eliminados: ninguno necesario.
- Migración vieja `20260613123000_add_client_project_codes.sql`: ya no existe localmente.
- Lógica funcional: no se tocó.

## 6. Recomendación para la próxima tarea

Tarea separada y acotada: eliminar `getNextProjectNumber` de `src/lib/codes.ts` (más cualquier import si apareciera) y, opcionalmente, agregar tests mínimos a `generateClientCode` / `resolveUniqueClientCode`. Sin cambios en la base de datos.

## Acción de este plan

Ninguna modificación de archivos. Aprobar este plan cierra la auditoría sin tocar nada; si querés que avance directamente con la limpieza de `getNextProjectNumber`, indicámelo y armo un plan separado para eso.
