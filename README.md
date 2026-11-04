# Proyecto Gestión Pro

Aplicación personal de gestión de proyectos y finanzas construida con React, TypeScript,
TanStack Start, Vite, Nitro y Supabase.

## Flujo de desarrollo

- `main`: versión estable.
- `feature/general-expenses`: rama histórica de la Fase 2; se conserva sin modificaciones.
- `codex/platform-migration`: integración y migración de plataforma hacia GitHub, Vercel y un
  proyecto Supabase propio.

Los cambios se validan en una rama y mediante un pull request antes de llegar a `main`. Vercel
debe usar despliegues Preview para las ramas; producción queda asociada a `main` cuando la
migración haya sido aprobada.

## Desarrollo local

Requisitos:

- Bun 1.4.4 o compatible.
- Docker Desktop y Supabase CLI sólo para validar la base localmente.

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev
```

Comprobaciones de la aplicación:

```bash
bun run typecheck
bun run lint
bun run build
```

El build usa Nitro con el preset de Vercel y genera `.vercel/output`.

## Supabase

Las migraciones versionadas en `supabase/migrations` reconstruyen una base vacía. La migración
canónica de la Fase 2 es
`20260618185957_add_payment_accounts_and_general_expenses.sql`; la copia posterior duplicada no
forma parte de esta rama.

Validación local, sin conectarse a ninguna base remota:

```bash
supabase db start
supabase db lint --local --fail-on error
```

El workflow de CI ejecuta la misma validación sobre una base efímera y también comprueba
TypeScript, lint y build.

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar los valores públicos del nuevo proyecto.
`VITE_*` se incluye en el bundle del navegador y nunca debe contener secretos. No se necesita una
clave `service_role` para las funciones actuales.

## Autenticación inicial

La pantalla pública permite únicamente iniciar sesión. Después de aplicar las migraciones, crear
manualmente un único usuario desde Supabase Authentication. El trigger existente crea su perfil y
convierte al primer usuario en administrador. Mantener deshabilitado el registro público de nuevos
usuarios.
