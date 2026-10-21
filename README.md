# Aula Socrática

Un tutor de IA que pregunta en vez de responder. Los docentes arman actividades con su material, comparten un
enlace y sus alumnos las resuelven conversando con un tutor socrático; el docente sigue en vivo cómo piensa cada uno.

- Producción: <https://aulasocratica.becode.com.ar>
- Se usa **sin crear cuenta**: el espacio del docente queda en su dispositivo; la cuenta (correo + contraseña) es
  opcional para abrirlo desde otros. Los alumnos entran solo con su nombre.

## Desarrollo

Requisitos: Node 22, Docker (para Postgres).

```bash
docker run -d --name aulasocratica-pg -e POSTGRES_USER=aula -e POSTGRES_PASSWORD=aula_dev_pw -e POSTGRES_DB=aula -p 127.0.0.1:54390:5432 postgres:17-alpine
cp .env.example .env        # completar ANTHROPIC_API_KEY (y ANTHROPIC_WORKSPACE_ID si la key no es de un workspace)
npm install
npm run dev                 # API en :3000, web en http://localhost:5173 (las migraciones se aplican solas)
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | API (recarga sola) + Vite |
| `npm run build` | Cliente (Vite) + portada prerenderizada + servidor (esbuild) en `dist/` |
| `npm start` | Sirve `dist/` (API + estáticos) |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Tests unitarios + integración (Postgres real, IA simulada) |
| `npm run test:e2e` | Playwright (móvil 375 px y escritorio 1440 px) |
| `npm run db:generate` | Genera una migración SQL a partir de `src/server/db/schema.ts` |

## Documentación

- [Arquitectura y convenciones](docs/ARQUITECTURA.md)
- [Operación: despliegue, variables, backups, restauración, rollback](docs/OPERACION.md)
- [Auditoría del prototipo original](docs/audit/)
- Informes finales (funcionalidades, diseño, QA, rendimiento, seguridad): `docs/informes/`
