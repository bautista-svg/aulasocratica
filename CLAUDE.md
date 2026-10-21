# Aula Socrática

Leé `docs/ARQUITECTURA.md` antes de tocar código: stack, estructura, reglas de autorización, validación, IA,
accesibilidad y textos. Auditoría del prototipo original (Lovable) en `docs/audit/`. El original está en
`_original/` (solo lectura, no se versiona).

- Dev: `npm run dev` (API en :3000 vía `API_PORT`, web en :5173). Postgres local: contenedor `aulasocratica-pg` (:54390).
- Tests: `npm test` (unit + integración contra `aula_test`; la IA se simula con `tests/integration/ai-mock.ts`).
- Typecheck: `npm run typecheck`. Migraciones: editar `src/server/db/schema.ts` y `npm run db:generate`.
- En SQL crudo dentro de selects de Drizzle, calificá las columnas con el nombre de la tabla (`activities.id`):
  Drizzle las emite sin calificar y dentro de subconsultas quedan ambiguas.
