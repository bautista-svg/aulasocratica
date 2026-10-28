# Aula Socrática — Arquitectura y convenciones

App web para docentes (sin cuenta obligatoria) y alumnos (entran por enlace con su nombre).
Un tutor socrático de IA (Claude Haiku) conversa con cada alumno; el docente sigue el trabajo en vivo.

## Stack

| Capa | Elección | Por qué |
|---|---|---|
| Cliente | React 19 + Vite 8 + TanStack Router (archivos, code-splitting automático) + TanStack Query + Tailwind v4 | SPA liviana, rutas tipadas, cache de datos con reintentos |
| Servidor | Node 22 + Hono 4 (`src/server`) | Rápido, pequeño, tipado; un solo proceso sirve API y estáticos |
| Base de datos | PostgreSQL 17 + Drizzle ORM (`src/server/db/schema.ts`, migraciones SQL en `drizzle/`) | Integridad referencial, migraciones versionadas |
| IA | `@anthropic-ai/sdk`, modelo `claude-haiku-5-5` (`src/server/ai/client.ts`) | Pedido del usuario |
| Archivos | Volumen persistente (`DATA_DIR/uploads`), claves generadas por el servidor (`src/server/lib/storage.ts`) | Sin proveedores externos |
| Voz | Web Speech API del navegador (dictado y lectura en voz alta) | Sin otra key; se oculta si el navegador no la soporta |
| PDF | PDFKit en el servidor (`src/server/lib/pdf.ts`) | Archivos PDF reales, no `window.print()` |

Un solo contenedor (Dockerfile) + base Postgres gestionada por Coolify. **Una sola instancia**: el rate limiting y el
bus de eventos en vivo son en memoria (documentado; si se escala, mover a Postgres/Redis).

## Estructura

```
src/
  shared/            Código puro, sin dependencias de servidor ni DOM (lo usan ambos lados)
    domain/          Reglas pedagógicas y de negocio (testeadas): pedagogy, tutors, alerts, live-monitor,
                     thinking-xray, session-summary, activity-design, files, material-select, names, …
    contracts/       Esquemas zod de los cuerpos de request + tipos de respuesta de la API
  server/
    env.ts           Configuración validada (falla al arrancar si falta algo)
    app.ts           Monta middlewares y routers bajo /api; sirve el cliente compilado
    db/              schema.ts, client.ts, migrate.ts
    auth/teacher.ts  Sesión del docente (cookie httpOnly `as_t`, token hasheado en DB)
    ai/client.ts     Único punto de acceso a Claude: generateStructured / generateText / presupuesto / uso
    lib/             errors, logger, rate-limit, security (CSRF/CSP), storage, events (SSE), pdf, crypto, request
    services/        Lógica reutilizable: access (autorización), workspace, extract (lectura de archivos),
                     file-jobs (cola en segundo plano), retention, audit
    routes/          Un router Hono por módulo
    jobs.ts          Tareas periódicas en proceso
  client/
    routes/          Pantallas (TanStack Router, un archivo por ruta; delgadas)
    features/<mod>/  Hooks de datos (api.ts) y componentes de cada módulo
    components/ui/   Sistema de diseño (Button, Field/Input/Textarea/Select, Dialog/ConfirmDialog, Tabs, Switch,
                     Checkbox, Menu, CopyButton, Badge, Card, PageHeader, EmptyState, ErrorState, Skeleton, Notice, Stat)
    components/app/  Shell (navegación), estados de ruta, banner de IA
    lib/             api.ts (fetch tipado + ApiError), query.ts, format.ts, session.ts, cn.ts
drizzle/             Migraciones SQL versionadas (drizzle-kit generate)
tests/               e2e (Playwright) y tests de integración
docs/                Arquitectura, auditoría, informes
```

## Reglas para todo el código

1. **Autorización**: toda ruta de docente usa `requireTeacher` + un helper de `services/access.ts`
   (`ownedClassroom`, `ownedActivity`, `ownedSession`, `ownedStudent`, …). Un aula se abre por su dueño **o** por
   un miembro (`classroom_members`, «Compartir aula»): el helper devuelve la fila con el `role` efectivo
   (`owner` | `admin` | `editor` | `reader`). Un recurso sin relación con el docente responde 404, nunca 403.
   **Toda ruta que cambia algo** de un aula o de lo que cuelga de ella llama `requireRole(fila, acción)` antes de leer el
   cuerpo (403 con el mensaje de `deniedMessage`): `"edit"` (editor+: actividades —crear, editar, publicar, duplicar,
   archivar—, enlace, archivos, IA de diseño y el trabajo de los alumnos: alertas, evaluación, terminar trabajos),
   `"manage"` (admin+: datos del aula, alertas configuradas, alumnos, a quién se comparte, y lo destructivo: papelera,
   reiniciar, eliminar actividades o trabajos) y `"own"` (solo el dueño: eliminar el aula). Las reglas viven en
   `shared/domain/sharing.ts` (`can`) y el cliente usa las mismas (`features/sharing/role.tsx`: `RoleProvider`,
   `useCan`) para ocultar lo que el rol no permite. Los listados entre aulas (Inicio, Alertas, Radiografía) usan
   `visibleClassroomIds`; los informes, solo aulas propias. Las actividades de un aula compartida pertenecen siempre al
   espacio del dueño (`activities.teacher_id` = dueño del aula, también si las crea un miembro): la IA (`teacherId`),
   el almacenamiento y las habilidades configuradas son los del dueño. Tutores y materiales se **copian** a la actividad,
   así que un miembro usa los suyos; `activities.tutor_id` («Basada en») apunta solo a tutores del mismo espacio.
   Las rutas de alumno resuelven el token del alumno en el servidor; el alumno nunca manda ids de otros.
2. **Validación**: todo cuerpo se lee con `readJson(c, schemaZod)` (400 con `fields` por campo). Los esquemas
   viven en `src/shared/contracts/<modulo>.ts` y el cliente reusa los mismos tipos.
3. **Errores**: lanzar `HttpError` (o `notFound`, `badRequest`, `conflict`, `forbidden`, `tooMany`) con un mensaje
   en castellano rioplatense, accionable y sin detalles internos. Nunca devolver stack traces.
4. **IA**: siempre por `generateStructured` (salida JSON validada con zod) o `generateText`, con `purpose`,
   `teacherId` y `activityId`. El resultado pasa por los sanitizadores de `shared/domain` antes de guardarse.
   Toda salida de IA se presenta como **sugerencia** y la confirma el docente. Las citas textuales de un alumno
   se verifican con `quoteAppears`. Si la IA no está disponible, el error 503 llega a la UI con su mensaje.
   En los esquemas, **nada de `z.enum`**: `zodOutputFormat` pasa el enum a la descripción y la API no lo hace
   cumplir, así que un valor inesperado rompería todo el pedido. Se pide `z.string()` y se normaliza al guardar
   (ver `toAspectKey`).
6. **Caché de prompts** (medido con la API real, `npx tsx --env-file=.env scripts/dev/ai-cache-check.ts`):
   - Tutor (`tutorRequest`): el system es solo la parte estable y va cacheado; la respuesta anterior del tutor lleva
     la marca de caché, así cada turno lee de la caché toda la charla previa; lo que cambia en cada turno (estado del
     alumno, fragmentos del material) va al final, dentro del último mensaje. En 6 turnos: 15–16 % más barato que el
     diseño anterior y cada turno avanzado ~40 % menos. Los tests de `tutor-prompt.test.ts` fijan este orden.
   - Detección de alertas: instrucciones + lista de alertas del aula (iguales para toda la clase) van cacheadas; el
     texto del alumno, después.
   - **Cambiar el formato de salida (el esquema) invalida la caché**: dos análisis distintos del mismo trabajo
     (resumen, rúbrica, fortalezas) no comparten caché aunque el prefijo sea idéntico. No vale la pena reordenarlos.
   - Nada que cambie por turno (fechas, contadores) puede ir antes de una marca de caché.
   - `/admin` muestra, por función, qué parte de la entrada salió de la caché y el costo con esos precios.
5. **Sin simulaciones**: nada de datos falsos, timeouts artificiales ni botones decorativos. Si algo no se puede
   hacer, no se muestra o se explica por qué.
6. **Fechas**: la API devuelve ISO strings. **Ids**: uuid v4.
7. **Logs**: `log.info/warn/error` con ids y conteos; nunca contenido de alumnos, contraseñas ni tokens.
8. **Archivos**: subir con `multipart/form-data` a rutas que terminen en `/files`, `/upload` o `/import`
   (límite 60 MB). Clasificar con `validateUpload` de `shared/domain/files.ts`. Guardar con `storage.newKey` +
   `saveFile`; procesar con `enqueueFile` (no bloquear el request). **Sin límite de páginas.**
9. **Eventos en vivo**: después de cambiar algo de una sesión de alumno, llamar `publish(activityId, tipo, sessionId)`.

## Reglas del cliente

- Mobile first: probar a 320/375/390/430/768/1024/1440 px. Áreas táctiles ≥ 44 px. Nada depende de hover.
- Cada pantalla contempla: cargando (Skeleton/PageSpinner), error con reintento (`ErrorState`), vacío con acción
  (`EmptyState`), éxito (toast `sonner` con el mismo verbo del botón: "Guardar" → "Cambios guardados").
- Formularios: `Field` (label + hint + error) con los `fields` del `ApiError`; deshabilitar el botón mientras
  se envía; nunca perder lo escrito ante un error. Ediciones largas: avisar si hay cambios sin guardar.
- `Tabs` del sistema de diseño mantiene los paneles montados (no se pierden ediciones al cambiar de pestaña).
- Acciones destructivas: `ConfirmDialog` explicando qué se borra; las irreversibles grandes piden escribir BORRAR.
- Accesibilidad WCAG 2.2 AA: labels reales, foco visible, `aria-live` para resultados asíncronos, contraste ≥ 4.5:1
  (usar los tokens de color; `lilac` es decorativo, para texto usar `lilac-ink`).
- Textos: castellano rioplatense (voseo), frases cortas, verbos concretos, sin marketing ni afirmaciones que el
  producto no cumpla.
- Firma visual: las preguntas del tutor se muestran con la clase `.q-hang` (signo "?" lila colgando en el margen),
  y los recorridos con `.thread`. Fraunces (`font-display`) solo para títulos y preguntas del tutor.

## Modelo de datos (resumen)

- `teachers` (espacio; cuenta opcional) → `classrooms` → `activities` → `learning_sessions` (una por alumno y
  actividad) → `messages`, `pedagogical_events`, `rubric_assessments`, `thinking_analyses`, `session_summaries`,
  `student_alerts`, `session_deliverables` (el archivo o enlace que entrega el alumno al terminar; el archivo se guarda en
  la carpeta de la actividad, así que se borra con ella, y se borra del disco al eliminar el trabajo, al alumno o al
  reiniciar la actividad; un enlace no guarda nada: `url` + `storage_key` nulo, y si es un documento público de Google
  `services/link-reader.ts` lo lee **solo desde dominios de Google**, sin seguir redirecciones a otros, para no hacer
  pedidos a direcciones arbitrarias o internas),
  `aspect_analyses` (habilidades de un trabajo, `skills`: un nivel por habilidad con cita verificada del alumno, o «sin
  evidencia»; las habilidades y sus indicadores están en `shared/domain/skills.ts` y cada espacio elige cuáles evalúa y
  suma las suyas en `teachers.skill_settings`. Un nivel sin cita real del alumno pasa a «sin evidencia». El nivel que
  corrige la docente sobrevive a un nuevo análisis. `items` guarda las antiguas «fortalezas y aspectos a reforzar»; claves fijas para
  poder contarlas por actividad y por alumno; las que marca el docente sobreviven a un nuevo análisis).
- `teachers.news_seen`: id del último aviso de «Novedades» mostrado (`shared/domain/news.ts`). Se marca apenas se abre,
  así aparece una sola vez en cualquier dispositivo; un aviso nuevo es un id nuevo.
- `change_requests` («Pedidos de cambios», solo si `teachers.can_request_changes`, que habilita el admin por correo):
  conversación con la IA (`services/requests/prompt.ts` tiene el mapa de la app: actualizalo cuando cambien pantallas),
  resumen, capturas en `requests/<teacher>/` y estado + nota del equipo. El mensaje se guarda y la IA responde en un
  segundo pedido (`/reply`), así un error de la IA no pierde lo que escribió. Se leen desde la terminal con
  `node scripts/dev/pedidos.mjs` (y `estado <id> done "nota"` para responder).
- `classroom_members` (aula, docente, rol `admin`|`editor`|`reader`, quién invitó; único por par) y `classroom_invites`
  («Compartir aula»): enlace `/invitacion/<token>` de un solo uso que vence a los 7 días; el token (256 bits) se guarda
  como SHA-256 y solo se muestra al crearlo. Aceptar exige cuenta (correo+contraseña o Google); el dueño no puede
  aceptar su propia invitación y un miembro que acepta otra cambia de rol. Borrar un espacio borra sus membresías (no
  las aulas ajenas); `mergeWorkspaces` las mueve a la cuenta. Invitar, aceptar, cambiar rol, quitar y salir quedan en
  `audit_logs`.
- `students` pertenecen a un aula (`name_key` único por aula). Se crean solos al entrar a una actividad o los carga
  el docente. **Los participantes de una actividad son sus `learning_sessions`**, nunca "todos los del aula".
- `tutors` (presets copiados a cada espacio con `preset_key` + tutores propios), `materials` (biblioteca),
  `activity_files`, `reports`, `classroom_alerts`, `audit_logs`, `ai_usage`.

## Seguridad

- Cookies `httpOnly`, `SameSite=Lax`, `Secure` en producción. Tokens aleatorios de 256 bits guardados como SHA-256.
- CSRF: toda mutación exige `Origin` propio (o el header `x-aula-client` que agrega `lib/api.ts`).
- CSP estricta (`script-src 'self'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy.
- Rate limits por IP/clave (`lib/rate-limit.ts`) y presupuesto diario de tokens de IA por espacio.
- Contraseñas con scrypt. Código de recuperación de un solo uso (no hay correo saliente).
- Datos de alumnos: solo el nombre. Retención documentada en `services/retention.ts` y `/privacidad`.

## Notas de implementación

- Drizzle emite columnas sin calificar (`"id"`) en selects de una sola tabla: en subconsultas con `sql\`\`` usá
  nombres calificados a mano (`activities.id`) y pasá fechas como ISO + `::timestamptz`.
- Tests de integración: `tests/integration/helpers.ts` (`call`, `newTeacher`, `newClassroom`) y `ai-mock.ts`
  (`aiMock.json(obj)`, `aiMock.text(str)`, `aiMock.error(status)`, `aiMock.lastRequest()`); la base se vacía antes de
  cada test.
