## Plan: Códigos automáticos para clientes y proyectos

### 1. Migración de base de datos
Una sola migración SQL que:
- Agrega `code TEXT` a `clients`.
- Agrega `code TEXT` y `project_number INT` a `projects`.
- Crea función PL/pgSQL `generate_client_code(name)` que normaliza (mayúsculas, sin acentos vía `unaccent` o replace manual, sin caracteres especiales) y devuelve iniciales según las reglas (1 palabra → 2 letras, 2+ palabras → iniciales).
- Backfill clientes existentes: asigna código generado, resolviendo colisiones con sufijo numérico (`PD`, `PD2`, `PD3`…).
- Backfill proyectos existentes: por cliente, ordena por `created_at` y asigna `project_number` 1..N y `code = CLIENTE-NN`.
- Añade `NOT NULL`, `UNIQUE` en `clients.code` y `projects.code`, índice único compuesto `(client_id, project_number)`.
- No toca RLS existente (ya permite a usuarios autenticados leer/escribir).

### 2. Lógica centralizada — `src/lib/codes.ts`
Nuevo archivo con:
- `normalizeClientName(name)` — uppercase, sin acentos, sin caracteres especiales, colapsa espacios.
- `generateClientCode(name)` — aplica reglas (1 palabra → 2 primeras letras; 2+ → iniciales).
- `resolveUniqueClientCode(baseCode, existingCodes)` — agrega sufijo si está repetido.
- `getNextProjectNumber(clientId)` — consulta Supabase: `max(project_number) + 1` o `1`.
- `formatProjectCode(clientCode, projectNumber)` — `CLIENTE-NN` con padding 2 dígitos.

### 3. Cambios en UI (sin alterar diseño)

**Clientes (`clientes.tsx`)**
- Columna nueva "Código" al inicio de la tabla.
- Formulario: campo `code` editable, autogenerado al tipear el nombre (solo en creación, o en edición si el cliente no tiene proyectos).
- Validación: requerido, único, mayúsculas, sin espacios. Mensaje claro si está duplicado.
- Si se edita el nombre y el cliente ya tiene proyectos, el código queda bloqueado (read-only con tooltip).

**Proyectos (`proyectos.tsx`)**
- Columna nueva "Código" al inicio.
- Formulario de creación: al elegir cliente, mostrar preview "Próximo código: PD-03" (read-only).
- Al guardar: calcular `project_number` y `code` automáticamente (se hace en cliente con `getNextProjectNumber`).
- El campo `code` no es editable.

**Detalle de proyecto (`proyectos.$id.tsx`)**
- Mostrar `code` junto al nombre en el header.

**Dashboard (`dashboard.tsx`)**
- En la tabla de proyectos en curso, agregar columna "Código" al inicio.

**Gastos (`gastos.tsx`) y Cobros (`cobros.tsx`)**
- En selectores y listados, mostrar el proyecto como `PD-01 — Nombre del proyecto`.

### 4. Validaciones
- Cliente: code requerido, único, uppercase, sin espacios/caracteres especiales — validación en formulario antes de submit y manejo de error de unicidad de Postgres.
- Proyecto: code generado siempre; chequeo de colisión por race condition con reintento.

### 5. Lo que NO se toca
- `src/lib/finance.ts`, cálculos, dashboards (solo se añade columna visual).
- RLS, auth, tablas existentes (solo columnas nuevas), diseño general, otros módulos.

### Archivos a modificar
- `supabase/migrations/<nueva>.sql` (nueva)
- `src/lib/codes.ts` (nuevo)
- `src/routes/_authenticated/clientes.tsx`
- `src/routes/_authenticated/proyectos.tsx`
- `src/routes/_authenticated/proyectos.$id.tsx`
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/gastos.tsx`
- `src/routes/_authenticated/cobros.tsx`
