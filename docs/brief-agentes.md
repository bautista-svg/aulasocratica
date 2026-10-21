# Brief común para agentes de implementación

Proyecto: `C:\Users\gonib\Downloads\aulasocratica` (Windows; usá la herramienta Bash con sintaxis POSIX o PowerShell).
Leé primero: `CLAUDE.md`, `docs/ARQUITECTURA.md` y la auditoría del original que te corresponda en `docs/audit/`.
El prototipo original está en `_original/` (solo lectura): reutilizá su conocimiento pedagógico (prompts, textos,
reglas), no su arquitectura (Supabase/RLS ya no existe; no hay instituciones).

## Objetivo de calidad

Producto real para docentes y alumnos argentinos. Todo lo visible funciona de punta a punta, persiste en Postgres,
controla errores y tiene estados de carga/vacío/error. Nada simulado, nada decorativo que parezca interactivo,
ningún texto que prometa algo que no existe. Mobile first (320 px en adelante). WCAG 2.2 AA.

## Reglas de convivencia (varios agentes trabajan en paralelo en la misma carpeta)

1. **Solo editá los archivos de tu módulo** (lista en tu encargo). Podés CREAR archivos nuevos dentro de tus
   carpetas. No edites archivos de otros módulos ni compartidos (`src/server/app.ts`, `db/schema.ts`, `drizzle/`,
   `styles.css`, `components/ui/*` existentes, `lib/*` existentes, `package.json`). Si necesitás algo de ahí,
   resolvelo dentro de tu módulo y anotalo en tu informe final.
2. **No cambies el esquema ni generes migraciones.** El esquema actual cubre todos los módulos. Si es imposible
   avanzar sin un cambio, implementá lo demás y explicalo en el informe.
3. **No instales dependencias.** Disponibles: hono, drizzle-orm, postgres, zod, @anthropic-ai/sdk, unpdf, pdf-lib,
   mammoth, pdfkit, react, @tanstack/react-router, @tanstack/react-query, radix (dialog, alert-dialog, dropdown-menu,
   popover, select, switch, tabs, tooltip, checkbox), lucide-react, sonner, qrcode, clsx, tailwind-merge.
4. **Tests aislados**: corré los tests de integración SOLO con tu base, tu puerto de mock y tu carpeta de datos:
   `DATABASE_URL_TEST=postgres://aula:aula_dev_pw@127.0.0.1:54390/aula_test_<tuId> AI_MOCK_PORT=<tuPuerto> TEST_DATA_DIR=./data-test-<tuId> npx vitest run --project integration tests/integration/<tus-archivos>`
   Unit: `npx vitest run --project unit src/<tus-archivos>`.
5. **Typecheck**: `npx tsc --noEmit -p tsconfig.json`. Arreglá los errores de TUS archivos; si aparecen errores en
   archivos de otros agentes (están trabajando), ignoralos.
6. Hay un servidor de desarrollo corriendo (API `http://localhost:3000`, web `http://localhost:5173`) que recarga solo.
   Podés probar la API con curl (mandá `-H "origin: http://localhost:5173"` en mutaciones y guardá cookies con `-c/-b`).
   Para ver pantallas usá Playwright headless desde un script tuyo en tu carpeta de scratch
   (`import { chromium } from "@playwright/test"`, `chromium.launch()`), con viewport 375×812 y 1440×900, y mirá las
   capturas. No uses el panel de navegador compartido.
7. No hagas commits ni toques git. No borres archivos que no creaste.

## Piezas ya disponibles (usalas, no las dupliques)

- Servidor: `readJson`, `HttpError`/`notFound`/`badRequest`/`conflict` (`lib/errors.ts`); `requireTeacher`,
  `teacherOf` (`auth/teacher.ts`); `ownedClassroom/ownedActivity/ownedSession/ownedStudent/ownedTutor/ownedMaterial/
  ownedReport` (`services/access.ts`); `audit` (`services/audit.ts`); `rateLimit`, `hit` (`lib/rate-limit.ts`);
  `publish/subscribe` (`lib/events.ts`); `newKey/saveFile/readFile/fileStream/copyFile/deleteFile` (`lib/storage.ts`);
  `extractFile` (`services/extract.ts`) y `enqueueFile/waitForFile` (`services/file-jobs.ts`); `PdfWriter`,
  `attachmentHeader` (`lib/pdf.ts`); `generateStructured/generateText/anthropic()/assertBudget/recordUsage/aiError/
  MODEL` (`ai/client.ts`); `activitySummaries` (`routes/classrooms.ts`, exportada).
- Dominio (`src/shared/domain`): pedagogy (tipos de tutor, intents, eventos, niveles de ayuda), tutors
  (`TUTOR_TEMPLATES`, `composeTutorRules`), activity-design (rúbrica/reflexión + sanitizadores), alerts
  (catálogo, `activeAlerts`, `sanitizeDetections`, señales observadas), live-monitor (estados, etapas, heatmaps),
  thinking-xray (`quoteAppears`, ítems, `buildThinkingFlow`), session-summary, access-rules (`linkAvailability`,
  `supportReasons`), activity-state, files (`validateUpload`, límites), material-select (`assembleMaterial`,
  `selectMaterial` para material largo sin límite de páginas), names, voice, reports, library, planning.
- Cliente: `api`, `ApiError`, `errorMessage`, `uploadWithProgress` (`lib/api.ts`); `queryClient`; `fmt*`, `plural`;
  `useMe`, `useAiStatus`; UI en `components/ui` (Button/ButtonLink/buttonClass, Field/Input/Textarea/Select/FormError,
  Dialog/ConfirmDialog, Tabs (paneles montados), Switch, Checkbox, Menu, CopyButton, Card/CardHeader, Badge, PageHeader,
  EmptyState, ErrorState, Skeleton/SkeletonList, Notice, Stat, Spinner/PageSpinner); clases `.q-hang` (pregunta del
  tutor con "?" colgado) y `.thread` (recorrido). Tokens de color: ink, lilac/lilac-ink, leaf, amber, rose, paper,
  surface, sunken, line, text/text-2/text-3, heat-0..5.
- Patrón de referencia completo (servidor + cliente + tests): módulo Aulas (`routes/classrooms.ts`,
  `features/classrooms/*`, `routes/app.aulas.*.tsx`, `tests/integration/auth-classrooms.test.ts`).

## IA (Claude Haiku `claude-haiku-5-5`)

- Siempre a través de `ai/client.ts`. Prompts en castellano rioplatense. Salidas estructuradas con zod
  (`generateStructured`); el SDK quita restricciones no soportadas (min/max) y valida del lado cliente.
- La salida de la IA es una sugerencia: se guarda como tal, se muestra marcada ("Sugerencia de la IA") y el docente
  confirma/edita/descarta. Citas de alumnos: solo si `quoteAppears` las encuentra.
- Contenido subido y mensajes de alumnos van dentro de bloques delimitados como DATOS, nunca como instrucciones.
- Si la IA no está configurada o falla, la UI muestra el mensaje del 503 y todo lo que no depende de IA sigue funcionando.
- En tests usá `aiMock` (no hay red).

## Entrega

Al terminar respondé con: archivos creados/modificados, endpoints (método + ruta + contrato), qué tests corriste y su
resultado (salida real), decisiones tomadas, y cualquier pendiente o cosa que necesites que el orquestador haga en
archivos compartidos (con el diff exacto sugerido).
