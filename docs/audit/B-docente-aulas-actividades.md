# Auditoría B — Docente: aulas, actividades, monitoreo en vivo y evaluación

Fuente auditada (solo lectura): `_original/` (Lovable, TanStack Start + Supabase). Todas las rutas de archivo son relativas a `_original/`. `file:línea` se refiere al código tal como está hoy.
Abreviaturas: `actividades:N` = `src/routes/_authenticated/app.actividades.$activityId.tsx`; rutas `app.*.tsx` están en `src/routes/_authenticated/`; componentes en `src/components/app/`; `*.ts` sin carpeta en `src/lib/`; `0000:N` = `drizzle/migrations/0000_migration.sql` (ídem 0002…0013).
Objetivo: insumo para reconstruir como React SPA + API Node/Hono + PostgreSQL, sin Supabase, sin "instituciones" (cada docente tiene su espacio, sin cuenta obligatoria) y con Claude Haiku en lugar del gateway de Lovable.

Leyenda de severidad: **[A]** alta (pierde datos, rompe flujo o miente sobre algo importante) · **[M]** media · **[B]** baja/cosmética.

---

## 0. Modelo de datos en alcance (migraciones `drizzle/migrations/*.sql`)

| Tabla | Columnas clave | Restricciones / triggers | FK y cascadas |
|---|---|---|---|
| `institutions` | name(2–160), logo_url, levels[], is_active, is_demo, created_by | trigger `handle_new_institution` → creador = `institution_admin` + `teacher` (0000:106-115) | — (desaparece en la reconstrucción) |
| `institution_memberships` | institution_id, user_id, role | unique(inst,user,role) | inst ON DELETE CASCADE |
| `profiles` | id(=auth.users), full_name | trigger al crear usuario | auth.users CASCADE |
| `classrooms` | institution_id, teacher_id, name(1–120), subject, grade, division, description, is_archived | touch updated_at | institutions CASCADE |
| `students` | institution_id, full_name(1–120), student_identifier(3–40), email(3–160, 0003), self_registered, is_active, is_demo, created_by | unique(inst, lower(identifier)); unique(inst, lower(email)) where email not null (0003:3) | institutions CASCADE |
| `student_credentials` | code_hash, code_salt, failed_attempts, locked_until | **deprecado** (0003:4) | students CASCADE |
| `enrollments` | institution_id, classroom_id, student_id | unique(classroom,student); trigger misma institución (0000:241-254) | classrooms CASCADE, students CASCADE |
| `activities` | classroom_id, teacher_id, title(1–160), subject, objectives, instructions, material, tutor_type (def `pensamiento_critico`), help_level enum(autonomous/moderate/intensive), tutor_rules, status enum(draft/published/**archived**), published_at, is_demo, rubric jsonb `[]` (0004), reflection_questions jsonb (2 por defecto, 0004:3), tutor_id (0005:103), voice_language off/es/en (0013) | trigger `enforce_activity_tenant` pone published_at la 1.ª vez (0000:284-295); trigger `ensure_activity_link` crea el link al publicar (0000:338-349) | classrooms CASCADE; tutors SET NULL |
| `activity_links` | activity_id **unique**, token (22 hex, default 0000:320), is_active, starts_at, expires_at | 1 link por actividad | activities CASCADE |
| `activity_files` | activity_id, storage_path unique `<activity_id>/<uuid>.<ext>`, file_name(1–200), mime_type, kind pdf/image/audio, size_bytes **≤ 26 214 400 (25 MB)** (0002:10), extracted_text, processing_status pending/processing/ready/failed, processing_error, uploaded_by | trigger path debe empezar con activity_id (0002:26-39) | activities CASCADE (el objeto en Storage NO se borra solo) |
| `learning_sessions` | activity_id, student_id, status in_progress/completed, initial_answer, final_answer, reflection jsonb, hint_count, started_at, last_activity_at, completed_at, is_demo | **unique(activity_id, student_id)** (0000:366) → 1 trabajo por alumno y actividad | activities CASCADE, students CASCADE |
| `student_access_tokens` | token_hash, student/activity/session, expires_at (12 h), revoked_at | solo service role | sessions/activities/students CASCADE |
| `messages` | session_id, role user/assistant, content, intent, is_partial (0010) | realtime (0009) | sessions CASCADE |
| `pedagogical_events` | session_id, event_type, source observed/inferred, message_id, details | índices por sesión/tipo | sessions CASCADE; messages SET NULL |
| `rubric_assessments` | session_id **unique**, rubric_snapshot, ai_suggestion, ai_generated_at, teacher_levels, teacher_comment, status suggested/confirmed, confirmed_by/at | trigger copia activity/institution de la sesión | sessions CASCADE, activities CASCADE |
| `session_summaries` | session_id unique, basis text[], content jsonb, generated_by | ídem | sessions/activities CASCADE |
| `thinking_analyses` | session_id unique, items jsonb | ídem | sessions/activities CASCADE |
| `classroom_alerts` | classroom_id, builtin_key, name, description, category academica/conducta/seguridad/integridad (0012), severity review/immediate, enabled | unique(classroom,builtin_key); trigger fuerza enabled en 3 claves de seguridad (0011:34-36); no se puede borrar un builtin (0011:52) | classrooms CASCADE |
| `student_alerts` | classroom/activity/session/student, message_id, classroom_alert_id, alert_key, name, category, severity, source, evidence, reason, status open/reviewed/dismissed | docente solo puede UPDATE status (0011:79) | classroom/activity/session/student CASCADE; message/classroom_alert SET NULL |
| `audit_logs` | actor, action, entity, details | — | institutions CASCADE (sobrevive a borrar aula/actividad/sesión) |
| `reports` | data jsonb (snapshot), narrative | — | **no** depende de activity/session: guarda copia de datos de alumnos |

---

## 1. Inventario pantalla por pantalla

### 1.1 Guardas y layout — `route.tsx`, `app.tsx`

| Elemento | Qué hace | Lee/Escribe | Estados / notas |
|---|---|---|---|
| Guard `/_authenticated` (route.tsx:4-11) | `supabase.auth.getUser()` en cada navegación; si no hay usuario → `/auth` | auth | ssr:false; llamada de red en cada `beforeLoad` |
| Sidebar NAV (app.tsx:35-44) | 8 links: Inicio, Mis aulas, Mis materiales, Crear clase con IA, Mis tutores, Radiografía, Informes, Institución | — | En mobile es fila con scroll horizontal (app.tsx:68) |
| Pie con nombre/email + "Cerrar sesión" (app.tsx:81-90) | `queryClient.clear()` + `signOut()` | auth | **`hidden md:block` → en mobile no se puede cerrar sesión** |
| Contenido (app.tsx:93-101) | `meQuery` (profiles + memberships); si 0 instituciones → `Onboarding` | profiles, institution_memberships | "Cargando…" sin error state |
| Onboarding (app.tsx:106-143) | Form "Nombre de la institución" (2–160) → INSERT institutions | institutions (+trigger memberships) | Obligatorio para usar la app → eliminar en rebuild |

### 1.2 Inicio — `app.index.tsx` (`dashboardQuery`, queries.ts:172-201)

| Elemento | Qué muestra / hace | Fuente real | Problema |
|---|---|---|---|
| Header eyebrow (l.29) | Nombres de instituciones | memberships | — |
| Botón "Ir a mis aulas" (l.33-35) | Link | — | — |
| StatCard "Aulas activas" (l.40) | count classrooms no archivadas del docente | classrooms | ok |
| "Estudiantes · Inscriptos en tus aulas" (l.41) | count de **enrollments** (incluye aulas archivadas; un alumno en 2 aulas cuenta 2) | enrollments | [M] número inflado |
| "Actividades en curso · N publicadas" (l.42) | count de **sesiones** in_progress dentro de las **últimas 50** sesiones | learning_sessions `.limit(50)` (queries.ts:188) | [A] etiqueta falsa (son trabajos de alumnos, no actividades) y tope 50 |
| "Actividades finalizadas" (l.43) | count sesiones completed en las últimas 50 | ídem | [A] ídem |
| "Podrían necesitar acompañamiento" (l.47-77) | `supportReasons` sobre las 50 sesiones; muestra 8; botón "Ver" → sesión | sessions | `clarification_count` nunca se carga acá → la razón "no entendió" nunca aparece (access-rules.ts:68) |
| "Últimas interacciones" (l.79-110) | 8 sesiones más recientes, pill En curso/Finalizó, "hace X" | sessions | — |
| Estados | "–" mientras carga; vacíos con texto | — | errores de las 4 consultas se ignoran (queries.ts:194-199) |

### 1.3 Mis aulas — `app.aulas.index.tsx` (`classroomsQuery`, queries.ts:53-71)

| Elemento | Qué hace | Escribe | Validación / estados |
|---|---|---|---|
| Descripción (l.27) | Texto de claim (ver §8) | — | — |
| Grid de tarjetas (l.38-83) | Link a aula; muestra institución, `subject||name` en grande, nombre docente, `name·grado división`, n.º alumnos (enrollments count), n.º actividades | — | Lógica rara `c.name !== c.teacher_name` (l.54) [B]; sin error state |
| Botón lápiz en tarjeta (l.68-81) | Abre `EditClassroomDialog` | ver 1.4.4 | aria-label ok |
| Vacío (l.32-37) | "Todavía no tenés aulas" | — | — |
| "Nueva aula" (l.89-179) | Dialog: Institución (Select si >1), **Materia*** (≤80), **Nombre de la docente*** (≤120), Grado/año (≤40), División (≤20) → INSERT classrooms con `name = materia+grado+división` | classrooms; **UPDATE profiles.full_name** si el nombre difiere (l.105-108) | [M] cambiar "nombre de la docente" acá reescribe el nombre global del perfil; botón deshabilitado sin explicación si no hay institución elegible (l.128); Label "Institución" sin `htmlFor` |

### 1.4 Aula — `app.aulas.$classroomId.tsx`

Header: eyebrow "Mis aulas"; título `InlineTitle` (clic→input, Enter/blur guarda, Esc cancela; ≤120; UPDATE classrooms.name) (l.51-65); descripción institución·materia·grado; botón "Editar aula" (l.75-83). Tabs con `?tab=` en URL: Actividades / Estudiantes / Alertas (l.23-30, 86-104). Loading "Cargando…", not-found "No encontramos esta aula o no tenés acceso." (l.39-40).

#### 1.4.1 Tab Actividades (`classroomActivitiesQuery`, queries.ts:104-116)

| Elemento | Qué hace | Escribe / fn | Notas |
|---|---|---|---|
| "Nueva actividad" (l.118-129, 134-136) | INSERT inmediato `{title:"Nueva actividad", subject: aula.subject}` status draft → navega a la actividad | activities | [M] crea borradores fantasma si el docente se arrepiente; sin formulario |
| Fila de actividad (l.144-163) | Título, "N ingresaron · M finalizaron" (de `learning_sessions(status)`), pill Publicada/Borrador/Archivada | — | — |
| Tacho (l.164-189) | `ConfirmDelete` → `deleteActivity` | delete.functions.ts:99-132 | Texto distingue 0 vs N alumnos |
| Vacío (l.138-142) | "Creá una actividad, configurá al tutor y publicala para obtener el enlace." | — | Sin loading ni error state |

#### 1.4.2 Tab Estudiantes (`classroomStudentsQuery`, queries.ts:87-102)

| Elemento | Qué hace | Escribe / fn | Validación / notas |
|---|---|---|---|
| Texto (l.252) | Claim: se suman solos por el enlace | — | — |
| "Agregar alumnos" (dialog l.254-285) | Textarea "Nombre, correo" por línea; "Importar CSV" (.csv/.txt, lee a texto) (l.241-245, 276-279); botón "Agregar N" | `addStudentsToClassroom` (staff.functions.ts:15-120) | `parseStudentLines` (l.198-210): separa por `; , \t`, salta encabezado "nombre/name", **descarta en silencio correos mal escritos** → alumno sin email ⇒ al entrar por link se crea **otro** alumno [M]. Server: 1–200 alumnos, nombre 1–120, identificador regex `[A-Za-z0-9.-]{3,40}`, email ≤160; si el email ya existe solo inscribe; si no, crea alumno + **genera código de acceso PBKDF2 que nunca se muestra** (l.101-103, deprecado) |
| Toasts (l.228-229) | "N alumnos agregados" (cuenta también reinscriptos) / "N no se agregaron (ya existían en la institución)" | — | razón genérica aunque el motivo sea otro |
| Tabla (l.288-344) | Nombre (link a `/app/alumnos/$id`), pill "Demostrativo", "(ingresó por enlace)", correo o identificador | — | [M] `overflow-hidden` → no scrollea en mobile; sin loading/error |
| Tacho "Quitar" (l.316-338) | `removeStudentFromClassroom` | delete.functions.ts:134-174 | borra trabajo en todas las actividades del aula |

#### 1.4.3 Tab Alertas — `classroom-alerts.tsx`

| Elemento | Qué hace | Escribe | Notas |
|---|---|---|---|
| Toggle "Alertas heredadas (9) / Alertas del aula (n)" (l.53-72) | botones simples (no tabs ARIA) | — | — |
| Lista heredadas (l.79-107) | 9 `BUILTIN_ALERTS` (alerts.ts:33-43) con badge categoría/severidad y Switch; 3 de seguridad bloqueadas (candado) | UPSERT classroom_alerts(builtin_key, enabled) (l.29-35) | trigger fuerza on (0011:34) |
| Lista propias (l.117-142) | nombre, badges, descripción, tacho (window.confirm), Switch | UPDATE/DELETE classroom_alerts | — |
| "Nueva alerta" dialog (l.153-225) | Nombre* ≤80, "Qué querés detectar"* ≤400, Tipo (4 categorías), Urgencia (2) | INSERT classroom_alerts | Labels "Tipo"/"Urgencia" sin `htmlFor` |
| Nota (l.146) | claim "Las alertas son una inferencia de la IA…" | — | contradice que `pasted_text`/`left_app` son observadas |

#### 1.4.4 `EditClassroomDialog` (edit-classroom-dialog.tsx)

| Elemento | Qué hace | Escribe / fn | Notas |
|---|---|---|---|
| Form (l.125-151): Nombre* ≤120, Materia ≤80, Grado ≤40, División ≤20, Descripción ≤1000 | UPDATE classrooms | classrooms | — |
| "Archivar aula" → confirmación → "Sí, archivar" (l.89-98, 170-183) | `is_archived=true`, navega a /app/aulas | classrooms | **[A] no existe ninguna pantalla para ver/desarchivar** (solo `classroomsQuery` filtra `is_archived=false`); los links de sus actividades **siguen abiertos** a alumnos |
| "Eliminar aula" → confirmación inline (l.100-115, 153-169) | `deleteClassroom` | delete.functions.ts:60-97 | Confirmación propia (no `ConfirmDelete`) |

### 1.5 Actividad — `app.actividades.$activityId.tsx` (`activityQuery`, queries.ts:118-130)

Header: eyebrow nombre del aula (link); `InlineTitle` (≤160, UPDATE activities.title) + pill **Publicada/Borrador** (archived se muestra como "Borrador", l.144-146).
Acciones (l.150-192):

| Botón | Qué hace | Escribe | Notas |
|---|---|---|---|
| "Editar actividad" (l.151-155) | cambia a tab config (oculto si ya estás en config/rúbrica/reflexión) | — | — |
| "Duplicar" (l.68-115, 156-158) | INSERT copia (título+" (copia)", objetivos, consigna, material, tutor_type, help_level, tutor_rules, rubric, reflection_questions, tutor_id, voice_language; status draft) + copia cada archivo en Storage y fila `activity_files` (`...f` incluye extracted_text; pending/processing pasan a failed) → navega | activities, activity_files, storage | [M] no transaccional (copias parciales); título >152 chars viola CHECK ≤160; solo misma aula; link nuevo recién al publicar |
| "Publicar" / "Volver a borrador" (l.60-66, 159-167) | UPDATE status. Publicar → trigger crea link → toast → tab "share". Borrador → link queda pero inutilizable | activities (+activity_links) | [A] **"Volver a borrador" expulsa al instante a todos los alumnos que están trabajando** (`resolveStudentToken` exige published, student-session.server.ts:43) sin advertencia; publicar no valida nada (consigna vacía, título "Nueva actividad") |
| "Eliminar" (l.168-191) | `ConfirmDelete` → `deleteActivity` → navega al aula | delete.functions.ts:99-132 | — |

Tabs (estado local, **no en URL**; default "live", se fuerza "config" si no está publicada, l.49-53): **En vivo · Compartir con alumnos · Consigna y tutor · Rúbrica · Reflexión** (l.196-222). Radix `TabsContent` desmonta el contenido inactivo (`components/ui/tabs.tsx` sin `forceMount`) ⇒ **cambiar de tab sin guardar pierde lo editado** en Config, Rúbrica y Reflexión, sin aviso [A].

#### 1.5.1 Tab "En vivo"
`LiveMonitor` + `Participation` (ver §3).

#### 1.5.2 Tab "Compartir con alumnos" — `ShareSection` (l.411-562)

| Elemento | Qué hace | Escribe | Notas |
|---|---|---|---|
| Estado borrador (l.429-442) | "La actividad todavía es un borrador" + "Publicar y generar enlace" | activities | — |
| Pill disponibilidad (l.477-485) | `linkAvailability` (access-rules.ts:26-36): Disponible / Desactivado / Aún no comienza / Vencido | — | `unpublished` caería en "Vencido" |
| Input URL readonly + botón copiar (l.487-492), "Copiar enlace" (l.494-496) | `navigator.clipboard.writeText` | — | [B] sin try/catch ni fallback (http/no permisos) |
| "Compartir actividad" (l.458-469, 497-499) | `navigator.share` o WhatsApp en ventana nueva; texto "…: ingresá con tu nombre y tu correo." | — | — |
| "Classroom" / "WhatsApp" (l.500-509) | links `classroom.google.com/share?url=` y `wa.me/?text=` | — | — |
| Texto (l.511-514) | claim de ingreso sin verificación (ver §8) | — | — |
| Fecha de inicio / vencimiento (`datetime-local`) + "Guardar fechas" (l.516-541) | UPDATE activity_links.starts_at/expires_at (hora local→ISO) | activity_links | [M] sin validar vencimiento > inicio; estado inicializado una sola vez; **no afecta a alumnos ya dentro** (ver §7) |
| Switch "Enlace activo / desactivado" (l.525-528) | UPDATE is_active inmediato | activity_links | [A] **no corta a alumnos con token vigente** (12 h) |
| QR (l.545-557) | `QRCode.toDataURL(url, 480px)`; "Descargar QR" (`<a download>`) | — | `disabled` sobre `<a asChild>` no tiene efecto (l.552) |
| Falta | regenerar/rotar token, cerrar actividad para todos, reiniciar | — | ver §2, §7 |

#### 1.5.3 Tab "Consigna y tutor" — `ConfigForm` (l.228-402)

| Campo | Columna | Límite UI | Límite real que usa el tutor |
|---|---|---|---|
| Título (l.301-302) | title | 160 | — (duplicado con InlineTitle; sincronizado por efecto l.251-253) |
| Asignatura (l.305-306) | subject | 80 | — |
| Objetivos de aprendizaje (l.310-311) | objectives | **sin tope** | completo |
| "Consigna inicial (la ve el alumno)" (l.314-315) | instructions | sin tope | completo |
| "Material autorizado" (l.318-320) | material | sin tope | **12 000 chars** (tutor-prompt.ts:53); 8 000 en IA de diseño |
| Archivos adjuntos (l.322) | `ActivityFiles` (ver §5) | — | 15 000 chars/archivo |
| "Usar un tutor guardado" Select (l.327-351) | tutor_id; `applyTutor` copia tutor_type, help_level y `composeTutorRules` en tutor_rules y deja `pendingMaterials` para adjuntar al guardar (l.258-269, 280-290) | — | Label sin `htmlFor` |
| "Tipo de tutor" (`TutorTypeSelect`, l.352-355) | tutor_type (18 tipos, pedagogy.ts:36-61) | — | dialog con tarjetas, ver 1.8 |
| "Nivel de ayuda" (l.356-371) | help_level | 3 opciones | Label sin `htmlFor` |
| "Conversación por audio" (l.372-390) | voice_language off/es/en | — | Label sin `htmlFor` |
| "Indicaciones para el tutor" (l.391-395) | tutor_rules | sin tope | **3 000 chars** (tutor-prompt.ts:64) |
| "Guardar cambios" (l.271-294, 396-398) | UPDATE activities con todo el form; luego `attachLibraryMaterials` si hay pendientes | activities, activity_files | solo valida título no vacío |

Bugs propios: efecto que sincroniza `material` (l.254-256) **pisa ediciones no guardadas** cuando se adjunta algo de "Mis materiales" (el server agrega texto a `activities.material`, library.functions.ts:125-131) [A]; ningún aviso de truncamiento a 12 000/3 000 [M].

#### 1.5.4 Tab "Rúbrica" — `rubric-editor.tsx`

| Elemento | Qué hace | fn / Escribe | Validación |
|---|---|---|---|
| "Guardar rúbrica / Guardada" (l.46-60, 142-144) | `sanitizeRubric` y UPDATE activities.rubric | activities | si algún criterio no tiene nombre o <2 niveles con etiqueta → error (no guarda nada) |
| "Subir rúbrica" (l.70-130, 145-167) | PDF/JPG/PNG/WEBP/DOCX/TXT/CSV ≤ 8 MB; DOCX se lee en el navegador (mammoth); PDF/imagen se manda en base64 | `importRubricFromFile` | reemplaza todo con toast "Deshacer" 10 s; nada se guarda hasta tocar Guardar |
| `AiDraftPanel` "Proponer con IA" (l.168-176) | Pedido opcional ≤600 + Cantidad (1–**6**, aunque MAX_CRITERIA=8) → "Proponer" / "Agregar a las que tengo" / "Reemplazar todo" | `draftRubricWithAI` | no guarda |
| Criterio (l.185-255) | Nombre ≤120, Descripción ≤500, ↑ ↓ tacho; niveles: etiqueta ≤40, descripción ≤500; "+ Nivel"/"– Nivel" (2–5) | — | grid `repeat(n, minmax(150px,1fr))` sin overflow → rompe en mobile (l.212) |
| "Agregar criterio" (l.257-259) | `emptyCriterion` (4 niveles por defecto: En inicio/En proceso/Logrado/Destacado) | — | máx 8 |
| Vacío (l.179-183) | texto | — | — |

#### 1.5.5 Tab "Reflexión" — `reflection-editor.tsx`

Lista de 0–6 preguntas (≤300) con ↑ ↓ tacho (l.68-94); "Agregar pregunta"; "Volver a las 2 sugeridas" (l.96-108); `AiDraftPanel` (1–6, default 2) → `draftReflectionWithAI` (l.49-56, 109-115); preview "Así lo ve el alumno" (l.118-134); "Guardar reflexión" → UPDATE activities.reflection_questions (l.37-47). Al terminar, el alumno guarda snapshot pregunta+respuesta (student.functions.ts:294-299), así que editar no altera trabajos viejos (texto l.136 es verdadero).

### 1.6 Sesión de un alumno — `app.sesiones.$sessionId.tsx`

Query `["session", id]` (l.25-42): learning_sessions + student + activity, messages, events. Además `useSessionMessages` en vivo si no está completada (l.50-51).

| Sección | Qué muestra / hace | fn / Escribe | Notas |
|---|---|---|---|
| Header (l.65-128) | eyebrow actividad; nombre; email o identificador; pill En curso/Finalizó; "Demostrativo" | — | — |
| "Todos sus trabajos" (l.85-93) | link a `/app/alumnos/$id` | — | — |
| "Ver radiografía del pensamiento" (l.94-100) | link a `/app/radiografia/$sessionId` (ahí está el "Recorrido del pensamiento", §3.5) | — | — |
| "Borrar trabajo" (l.101-125) | `ConfirmDelete` → `deleteSession` → navega a la actividad | delete.functions.ts:176-201 | — |
| 3 fases (l.131-148) | "Antes de la IA" = respuesta inicial; "Durante" = n.º mensajes del tutor (incluye borradores parciales), pistas, "no entendí", ideas alternativas; "Después" = respuesta final | — | — |
| `SessionSummaryCard` (l.150-156) | §4 | `summarizeSession` | — |
| "Conversación completa con la IA" (l.158-171) | `ChatTranscript` con indicador "En vivo" | messages (realtime) | — |
| `SessionMaterial` (l.174) | "Material que tenía el alumno": consigna, material escrito, archivos (URL firmada 10 min, `window.open` tras await → bloqueadores de popups) | storage | [M] muestra el material **actual**, no el que tenía el alumno |
| `RubricAssessmentCard` (l.175) | §4 | `suggestRubricAssessment`, UPDATE rubric_assessments | — |
| "Eventos registrados" (l.176-191) | lista de `pedagogical_events` con `EVENT_LABELS` y "Dato observado"/"Inferencia de IA" | — | — |
| "Reflexión metacognitiva" (l.193-209) | pregunta→respuesta (`readReflection`) | — | — |
| No hay | reabrir sesión, mensaje del docente al alumno, editar respuesta | — | — |

### 1.7 Alumno — `app.alumnos.$studentId.tsx`

Una query (l.25-43): alumno + sesiones en aulas del docente (`activities!inner(classrooms!inner(teacher_id = uid))`). Tarjetas por trabajo: título, aula·grado·fecha, pill, respuesta inicial (3 líneas), "N mensajes · N pistas · con resumen", botón "Ver chat y resumen". Vacío "Todavía no empezó ninguna de tus actividades." Es la **única** vista "por alumno"; no existe "por actividad → quién la hizo" fuera del live monitor.

### 1.8 Componentes transversales

| Componente | Comportamiento |
|---|---|
| `InlineTitle` (inline-title.tsx) | Botón→input; Enter/blur guarda, Esc cancela; vacío → toast y revierte; lápiz solo visible en hover/focus (l.104) |
| `ConfirmDelete` (confirm-delete.tsx) | AlertDialog; "Esto no se puede deshacer."; bloquea cierre mientras borra; errores → toast |
| `StatusPill/PageHeader/StatCard` (status-pill.tsx) | presentacional |
| `AlertBadges` | badge categoría + severidad (color + texto) |
| `TutorTypeSelect` (tutor-type-select.tsx:137-186) | botón → Dialog con 10 "formatos" + 8 "enfoques"; tarjeta con descripción, "Cuándo elegirla" y desplegable "Cómo trabaja el tutor" (`TUTOR_TYPE_GUIDANCE`); `aria-pressed` ok |
| `AiDraftPanel` (ai-draft-panel.tsx) | ver 1.5.4; "Cantidad" sin `htmlFor` (l.66) |
| `CredentialsDialog` (credentials-dialog.tsx) | **Código muerto**: no se usa en ninguna parte (grep). Igual que `regenerateStudentCode` (staff.functions.ts:122-170) |
| `LiveChatButton/ChatTranscript/useSessionMessages` | §3.4 |

---

## 2. Ciclo de vida de una actividad

```
[crear "Nueva actividad"] → draft ──Publicar──▶ published ──Volver a borrador──▶ draft (link congelado, alumnos expulsados)
                              │                     │
                              │                     ├─ link: token fijo, is_active, starts_at, expires_at
                              │                     ├─ alumnos entran → learning_session (1 por alumno) → in_progress → completed
                              │                     └─ docente "Terminar" (por alumno) → completed
                              └─ Duplicar (siempre a draft, mismo aula) / Eliminar (cualquier estado)
"archived": existe en el enum (0000:4) pero ninguna UI lo setea.
```

| Paso | Detalle exacto |
|---|---|
| Crear | INSERT con título "Nueva actividad", `subject` del aula, 2 preguntas de reflexión por defecto (0004:3), rúbrica vacía (app.aulas.$classroomId.tsx:118-129) |
| Publicar | UPDATE status → trigger `enforce_activity_tenant` setea `published_at` solo si es null (0000:291) → trigger `ensure_activity_link` inserta `activity_links` con token `substr(uuid+uuid sin guiones,1,22)` (0000:320, 338-349) `on conflict do nothing` ⇒ **el token nunca cambia**, aunque vuelvas a borrador y republiques. No hay validaciones previas ni otros efectos (no notifica, no genera IA). |
| Link | URL `${origin}/clase/${token}` (actividades:422). Alumno: `getActivityPublicInfo` → `studentLogin` (nombre ≥2 palabras + email con regex, sin verificación; access-rules.ts:8-21) → busca/crea alumno por (institución, email) → **upsert inscripción en el aula** (student.functions.ts:122-129) → busca/crea sesión → token opaco 64 hex, hash SHA-256, TTL 12 h (student-session.server.ts:8). `linkAvailability` se chequea **solo al ingresar**. |
| Activo / fechas | Switch y fechas en `activity_links`. `resolveStudentToken` (student-session.server.ts:37-43) verifica solo que la actividad siga `published` — **no mira `is_active`, `starts_at` ni `expires_at`** pese al comentario "link active". |
| QR / copiar / compartir | ver 1.5.2 |
| Duplicar | ver 1.5 (copia config + archivos; no copia sesiones ni link) |
| Sesión del alumno | Paso 1 respuesta inicial **obligatoria** (≥3, inmutable; student.functions.ts:239-269) → chat (tutor-chat exige initial_answer, tutor-chat.ts:56) → "Finalizar actividad" emite `closing_started` (student.functions.ts:332-344) → `finishActivity`: respuesta final **obligatoria** (≥3) + reflexión → `completed`, eventos `final_answer_saved`, `reformulated` (si cambió), `reflection_submitted`, `activity_completed` (l.271-330) |
| "Terminar" (docente) | Botón por fila en el live monitor (live-monitor.tsx:266-304) → `endStudentSession` (activity-ai.functions.ts:310-346): status=completed, completed_at=now **sin** final_answer/reflexión, revoca tokens de esa sesión, evento `ended_by_teacher` (observed), audit_log. Irreversible (no hay "reabrir"). Si el alumno vuelve a entrar, obtiene token nuevo y ve la pantalla de completado. No existe "Terminar para todos" ni "cerrar actividad". |
| Fin de la actividad | No hay estado "finalizada" a nivel actividad: se cierra de hecho volviendo a borrador (expulsa) o desactivando el link (no expulsa). |
| Reiniciar | **No existe.** Solo borrar trabajo por alumno (`deleteSession`) o eliminar la actividad entera. |

---

## 3. Monitor en vivo (tab "En vivo")

### 3.1 Fuentes y refresco

| Bloque | Query | Refresco | Costo |
|---|---|---|---|
| `LiveMonitor` | `activityLiveQuery` (queries.ts:218-269): **inscriptos del aula** + sesiones de la actividad + `rubric_assessments` (status, no usado) + **todos** los `pedagogical_events` de la actividad paginados de a 1000 hasta 20 000 | polling 10 s (live-monitor.tsx:78) + canal realtime `learning_sessions` filtrado por activity_id con debounce 400 ms que invalida live y participation (l.81-101); reloj `useNow` 15 s (l.108) | Re-descarga todos los eventos cada 10 s |
| `LiveAlerts` | `activityAlertsQuery` (≤200, queries.ts:322-335) | polling 15 s + realtime `student_alerts` (live-alerts.tsx:30-46); toast para alertas nuevas (`immediate` → toast.error 15 s) | — |
| `Participation` | `activityParticipationQuery` (inscriptos + sesiones + eventos `clarification_requested`) | polling 10 s (participation-table.tsx:14) | duplica la tabla del monitor |
| Chat por alumno | `useSessionMessages` | realtime INSERT/UPDATE `messages` + polling 5 s (live-chat.tsx:39-71) | el tutor escribe borradores `is_partial` cada 300 ms (tutor-chat.ts:181-188) |

### 3.2 Estados, etapas y umbrales (`src/lib/live-monitor.ts`, solo eventos observados)

| Regla | Definición |
|---|---|
| Última señal | `max(last_activity_at, started_at, created_at de TODOS los eventos)` (l.30-34) — incluye `left_app`, `pasted_text`, `ended_by_teacher`, `session_entered` |
| Estado | completed → "Finalizó"; `<2 min` "Activo"; `<15 min` "Sin actividad"; si no "Abandonada" (l.5-6, 36-42) |
| Etapa actual | completed → "Terminó"; sin initial_answer → "Respuesta inicial"; si último `closing_started` ≥ último mensaje/ayuda → "Respuesta final y reflexión"; si no "Charla con el tutor" (l.63-70) |
| Progreso | 0/3, 1/3, 2/3, 3/3 (l.73-77) |
| Duración por etapa | inicial = start→`initial_answer_saved`; tutor = eso→`closing_started`/`final_answer_saved`; cierre = `closing_started`→final; etapas abiertas cuentan hasta la última señal (l.80-93) |
| Tiempo (columna) | última señal − started_at (incluye pausas, puede dar "2 d 3 h") (live-monitor.tsx:116-123) |

### 3.3 Pantalla

- StatCards (live-monitor.tsx:153-159): Activos ahora (2 min) · Sin actividad (2–15 min) · Abandonadas (>15 min) · Finalizaron · **No ingresaron** (= inscriptos del aula sin sesión en esta actividad).
- `LiveAlerts` (live-alerts.tsx): lista abiertas/revisadas, borde rojo si inmediata, link al alumno, cita «evidencia», motivo, "Inferencia de IA · escribió en…" o "Dato observado", botones "Ver chat", "Revisada", "Descartar", "Reabrir"; "Configurar alertas" → tab alertas del aula.
- Tabla "Seguimiento en vivo" (l.163-259): Alumno (link a sesión si ingresó) · Va por · Progreso (barra n/3) · Tiempo · Última señal (pill + "hace X") · acciones "Ver chat" / "Terminar". Orden: activo, sin actividad, abandonado, finalizó, sin sesión; luego nombre.
- Mapas de calor (l.312-540), tabs:

| Mapa | Filas | Columnas | Celdas / buckets | Escala |
|---|---|---|---|---|
| "Tipo de ayuda" | alumnos con sesión + fila "Total del grupo" | Mensajes, Pistas, No entendí, Ejemplos, Revisar, Otra idea, Explicó (`HELP_EVENT_TYPES`, live-monitor.ts:95-113) | conteo de eventos | "alert": más = rojo; intensidad 1–5 relativa al máximo de la grilla (`intensity`, l.135-138) |
| "Actividad por minuto" | alumnos | Select: últimos 30 min (15 cols = 2 min), última hora (20 cols = 3 min), toda la actividad (24 cols de duración variable) (live-monitor.tsx:435-439) | `activityBuckets`: cantidad de **cualquier** evento en el bucket | "good": más = verde |
| "Tiempo por etapa" | alumnos | Respuesta inicial, Charla con el tutor, Respuesta final y reflexión, Total | duración formateada | "alert": más tiempo = rojo, relativo al máximo |

Detalle por celda solo con atributo `title` (hover) — inaccesible en touch/teclado.

### 3.4 Drill-down por alumno
- "Ver chat" → `Sheet` lateral con `ChatTranscript` en tiempo real ("Escribiendo…" en borradores parciales, "El tutor está pensando…" si el último mensaje es del alumno y tiene <90 s) (live-chat.tsx:76-179). Solo lectura.
- Nombre → `/app/sesiones/$sessionId` (§1.6) con fases Antes/Durante/Después, transcript en vivo, eventos, reflexión, rúbrica, resumen.
- "Evidencias" en la tabla de participación → misma página.

### 3.5 "Recorrido del pensamiento" (en `app.radiografia.$sessionId.tsx`, fuera de mi lista de rutas pero enlazado desde la sesión)
- Bloque "Recorrido del pensamiento · Datos observados" (l.128-161): **Respuesta inicial → Preguntas del tutor (N)** (última oración con "?" de cada mensaje del tutor vía regex `tutorQuestion`, thinking-xray.ts:112-117; muestra 4 y "y N más") **→ Reformulación (N)** (solo mensajes del alumno enviados con los botones "Quiero revisar mi respuesta"/"Tengo otra idea"/"Quiero explicar lo que aprendí"; reformulaciones escritas libremente no cuentan, thinking-xray.ts:109,125-127) **→ Respuesta final**.
- Columnas Antes/Durante/Después con datos observados + "Interpretación de IA" (`analyzeThinking`) validable/editable/descartable; reflexión en "Después".
- Placeholder: "Actividad de transferencia sin ayuda: todavía no está disponible en la plataforma." (l.193-195).
- Sin realtime ni polling (se ve una foto al cargar).

---

## 4. Llamadas a IA en alcance

Todas pasan por `generateStructured` (ai/structured.server.ts:12-80): gateway Lovable `openai/gpt-6-astra` (Responses API, `forceReasoning`, effort low/medium, `Output.object(zod)`), errores mapeados a "La IA no está configurada", 429/402/403, "no devolvió una propuesta válida". Lectura de archivos usa `streamText` directo sin schema. Ninguna tiene tope de tokens de salida explícito.

| Llamada (archivo:línea) | Propósito | Disparador | Entradas | Schema zod de salida | Post-proceso | ¿Rotulado como inferencia / validación docente? |
|---|---|---|---|---|---|---|
| `draftRubricWithAI` (activity-ai.functions.ts:59-101) | Proponer N criterios | AiDraftPanel en Rúbrica | activityId, request ≤600, existing ≤8×120, count 1–8; contexto `activityContext` (título, asignatura, curso, objetivos, consigna, material+archivos: **3 000 chars/archivo, 8 000 total**, l.27-53) | `{criteria:[{name,description,levels:[{label,description}]}]}` | `sanitizeRubric`, recorta a count | "La IA propone, vos revisás y editás antes de guardar"; no se guarda hasta "Guardar rúbrica" ✔ |
| `importRubricFromFile` (l.104-166) | Transcribir rúbrica existente | "Subir rúbrica" | fileName, kind pdf/image/text, mediaType, content base64 ≤11.5 MB (≈8 MB) o texto (Word leído en navegador), fence 40 000 | `{found:boolean, criteria:[…]}` | `sanitizeRubric`; `truncated` si >8 | Toast "revisala y tocá Guardar"; con Deshacer ✔ |
| `draftReflectionWithAI` (l.168-200) | Proponer preguntas de reflexión (≤15 palabras, voseo) | AiDraftPanel en Reflexión | igual que rúbrica; existing ≤6×300 | `{questions:string[]}` | `sanitizeReflectionQuestions` | ✔ requiere guardar |
| `suggestRubricAssessment` (l.203-307) | Sugerir nivel por criterio para un alumno | **Automático** al abrir la sesión completada si hay rúbrica y no hay evaluación (rubric-assessment.tsx:72-79); "Pedir sugerencia a la IA"; "Volver a sugerir" | sesión (inicial/final 3 000, transcript ≤80 mensajes × 1 200, total 20 000; reflexión 3 000; pistas), rúbrica, objetivos, consigna; effort medium | `{criteria:[{criterionIndex:int, levelIndex:int, evidence, rationale}]}` | clamp de índices; faltantes → **nivel 0** + "Sin evidencia suficiente"; guarda `ai_suggestion`, `rubric_snapshot` y **sobrescribe `teacher_levels`** (l.285-298) | Pill "Sugerencia de la IA · falta tu confirmación", "Inferencia de IA · sugirió…", botón "Confirmar evaluación" (status confirmed), "Editar evaluación" ✔ — pero **la cita "textual" no se verifica** (a diferencia de resumen/radiografía/alertas) |
| `summarizeSession` (session-summary.functions.ts:12-129) | Resumen pedagógico de un trabajo | "Resumir" / "Volver a resumir" con checkboxes Rúbrica / Objetivos | basis; activity (consigna 3 000, material + archivos **6 000/archivo, 20 000 total**), ≤200 mensajes × 1 500 (fence 24 000), inicial/final/reflexión 3 000; effort medium | `{overview, criteria:[{title,observation,evidence[]}], objectives:[…], nextSteps[]}` | `sanitizeSummary` descarta citas que no aparecen literalmente en lo que escribió el alumno (`quoteAppears`) | Pill "Inferencia de IA", "Es una lectura de la IA: revisala"; **no editable ni validable** (solo regenerar) |
| `analyzeThinking` (thinking.functions.ts:12-111) — radiografía | Interpretaciones Antes/Durante/Después | "Analizar con IA" | ≤100 mensajes × 1 200, 20 000 | `{items:[{moment,category,interpretation,evidence}]}` | `quoteAppears` + merge conserva validadas/editadas | Validar / Editar / Descartar ✔ |
| `detectAlerts` (alerts.server.ts:25-103) — alertas | Clasificar texto del alumno | cada mensaje de chat (salvo botones preset), respuesta inicial y final | alertas activas del aula + 5 mensajes previos (600) + texto (3 000) | `{detections:[{key,evidence,reason}]} max 8` | `sanitizeDetections`: dedup 10 min, cita verificada o reemplazada por el último texto | "Inferencia de IA", revisar/descartar ✔ |
| `extractMaterialText` → `readVisual` (material-extract.server.ts:22-60) | Transcribir PDF/imagen para el tutor | automático tras subir archivo (desde el navegador, activity-files.tsx:101) y "Reintentar lectura" | archivo completo en base64, prompt `READ_PROMPT` (l.16-20), effort low | texto libre (sin schema) | `slice(0, 60000)` al guardar | Solo pill "Listo para el tutor"; el docente **no ve** el texto extraído |
| `transcribeAudio` (l.62-99) | Transcribir audio | ídem | `openai/gpt-transcribe`, `languages=es` fijo (aunque la actividad sea en inglés) | texto | prefijo "[Transcripción del audio]" | ídem |

---

## 5. Manejo de archivos

### 5.1 Reglas (`material-files.ts`)
- Tipos: PDF; imágenes JPEG/PNG/WEBP; audio MP3/M4A(mp4)/AAC/WAV/OGG/WEBM (l.10-43). El texto de UI menciona solo "JPG, PNG" y "MP3, M4A, WAV, OGG" (activity-files.tsx:134; material-files.ts:64).
- Tamaño: **20 MB** UI (l.3, 66) vs **25 MB** en el CHECK de la tabla (0002:10). No hay límite de bucket declarado en el repo.
- Máx **10 archivos por actividad** (l.4, 60-62).
- Storage privado `activity-materials/<activity_id>/<uuid>.<ext>` subido **desde el navegador** con el cliente Supabase (activity-files.tsx:69-73); fila `activity_files` (l.79-92); si falla la fila borra el objeto.

### 5.2 Pipeline de extracción
1. Navegador sube → inserta fila `pending` → llama `processActivityFile` (`void`, sin esperar) (activity-files.tsx:99-101).
2. Server (material.functions.ts:8-52): chequeo RLS → `processing` → descarga blob → `extractMaterialText`.
3. PDF/imagen: **todo el archivo en un único request** base64 (`bytesToBase64` arma un string binario completo, material-extract.server.ts:7-14) → modelo de chat con "Transcribí fielmente todo el texto visible… describí imágenes entre corchetes" → `result.text`.
4. Audio: `/audio/transcriptions` en streaming SSE, español fijo.
5. Guarda `extracted_text.slice(0, 60000)` y `ready`; error → `failed` + mensaje ≤300 (material.functions.ts:38-50).
6. UI: polling 4 s mientras haya pending/processing (activity-files.tsx:40-44); "Reintentar" **solo** si `failed` (l.170-176). Si el request se corta (pestaña cerrada, timeout del Worker) el archivo queda **"Leyendo…" para siempre** sin botón de reintento [A].
7. Biblioteca: `attachLibraryMaterials` copia archivo + `extracted_text` ya leído (library.functions.ts:49-134); textos/enlaces se agregan a `activities.material` con tope total 20 000.

### 5.3 Por qué "los PDF tienen restricción de páginas" (hallazgo)
No hay ningún `maxPages` en el código. La restricción es la suma de estos cortes, ninguno comunicado al docente:

| # | Dónde | Límite | Equivalente aprox. (2 500–3 500 chars/página de texto) |
|---|---|---|---|
| 1 | `material-files.ts:6` `MAX_FILE_TEXT_FOR_TUTOR = 15000`, aplicado en `tutor-prompt.ts:46-48` | El tutor recibe solo los **primeros 15 000 caracteres de cada archivo** | **≈ 4–6 páginas** → causa más probable de "el tutor no sabe lo que está en la página 8" |
| 2 | `material.functions.ts:40` (y library.functions.ts:37) | Se guardan como máximo 60 000 chars extraídos | ≈ 17–24 páginas; el resto se pierde para siempre |
| 3 | `material-extract.server.ts:22-60` | Una sola respuesta del modelo para todo el PDF, sin `maxOutputTokens` ni troceo por páginas, effort low | Con PDFs largos la salida se corta o el modelo resume en lugar de transcribir; además el proveedor impone límites de PDF por request (páginas/MB) y un PDF que los supera falla entero → "El tutor no pudo leerlo" |
| 4 | Memoria del Worker (Cloudflare vía nitro) | 20 MB → string binario + base64 ~27 MB en memoria | riesgo de fallo en PDFs pesados (escaneados) |
| 5 | IA de diseño (activity-ai.functions.ts:42, 51) | 3 000 chars/archivo, 8 000 total | ≈ 1 página |
| 6 | Resumen de sesión (session-summary.functions.ts:82-86) | 6 000 chars/archivo, 20 000 total | ≈ 2 páginas |
| 7 | Material escrito (tutor-prompt.ts:53) | 12 000 chars | — |

El alumno sí ve el PDF completo (URL firmada 2 h, student.functions.ts:212-214); el tutor no. Para Claude en la reconstrucción: PDF base64 nativo admite hasta 32 MB por request y 600 páginas (100 en modelos de 200K de contexto); `claude-haiku-5-5` tiene 1M de contexto. Claude **no acepta audio** → la transcripción necesita un proveedor STT aparte.

---

## 6. Borrado: semántica y cascadas (`delete.functions.ts`)

| Acción (UI) | Permiso | Qué se borra explícitamente | Qué cae por cascada | Qué queda |
|---|---|---|---|---|
| Eliminar aula (edit-classroom-dialog.tsx:100-115 → l.60-97) | `can_manage_classroom` | fila classroom (como docente, RLS); luego objetos Storage de sus actividades; alumnos huérfanos (sin inscripción ni sesiones, `orphanStudentIds`, deletion.ts:8-15) | activities → links, files (filas), sessions → messages, events, tokens, rubric_assessments, summaries, thinking_analyses, student_alerts; enrollments; classroom_alerts | `audit_logs` (con nombre del aula); **snapshots en `reports.data`**; alumnos con trabajo en otras aulas |
| Eliminar actividad (aula l.164-189 / actividad l.168-191 → l.99-132) | `can_manage_activity` | fila activity; objetos Storage | link, files, sessions y todo lo derivado, student_alerts | inscripciones en el aula (los alumnos siguen listados como "No ingresó" en otras actividades), audit_logs, reports |
| Quitar alumno del aula (l.316-338 → l.134-174) | `can_manage_classroom` | sesiones del alumno en **todas** las actividades del aula (admin); inscripción; registro del alumno si quedó huérfano | derivados de esas sesiones | audit_logs, reports |
| Borrar trabajo (sesión) (sesiones l.101-125 → l.176-201) | `can_manage_activity` | la sesión | messages, events, tokens, rubric, summary, xray, student_alerts | inscripción; el alumno puede volver a entrar y empieza de cero |
| Quitar archivo (activity-files.tsx:115-125) | RLS | fila + objeto Storage | — | (`window.confirm`) |
| Borrar alerta propia (classroom-alerts.tsx:43-49) | RLS | fila | student_alerts.classroom_alert_id → null | alertas ya disparadas |

Notas: errores de borrado en Storage se ignoran (archivos huérfanos posibles, delete.functions.ts:27-31); nada es transaccional; no hay papelera ni "deshacer".

---

## 7. Problemas

### 7.1 Quejas explícitas del usuario

| Queja | Causa exacta | Archivos |
|---|---|---|
| **"Que los alumnos se dividan en cada actividad… para saber quién hizo la actividad seleccionada"** [A] | Ingresar por el link de **cualquier** actividad inscribe al alumno en el **aula** (student.functions.ts:122-129). Las vistas por actividad parten de `enrollments` del aula, no de las sesiones de la actividad: `activityLiveQuery` (queries.ts:222-223, 255-267) y `activityParticipationQuery` (queries.ts:138-141, 158-168). Resultado: cada actividad lista a todos los alumnos que alguna vez entraron a otra actividad del aula como "No ingresó"/"No ingresaron" y "Autorizados". La pestaña Estudiantes del aula (app.aulas.$classroomId.tsx:212-348) es una lista única sin columna por actividad. Además la vista se duplica (LiveMonitor + Participation en el mismo tab, actividades:204-209). | queries.ts, live-monitor.tsx:153-159, participation-table.tsx:16-36 |
| **"Reiniciar la actividad y borrar todos los datos"** [A] | No existe. Hay `deleteSession` por alumno y `deleteActivity` (borra también configuración, archivos y link). Ningún endpoint borra en bloque las `learning_sessions` de una actividad conservando consigna/rúbrica/archivos, ni regenera el token. | delete.functions.ts (ausencia) |
| **Respuesta inicial siempre obligatoria (que sea opcional por actividad)** [A] | No hay columna de configuración. Gates: workspace del alumno (workspace.tsx:112-119, botón deshabilitado <3 chars l.180); `saveInitialAnswer` min 3 (student.functions.ts:241); **endpoint del tutor rechaza con 400 "Primero escribí tu respuesta inicial."** (tutor-chat.ts:56); prompt del tutor pide la respuesta inicial si falta (tutor-prompt.ts:75-77); etapa/progreso del monitor asumen que existe (live-monitor.ts:65, 75); razón de acompañamiento "aún no escribió su respuesta inicial" (access-rules.ts:69); stat "Comenzaron = escribieron su respuesta inicial" (participation-table.tsx:21, 33); estado "Ingresó" vs "En curso" (participation-table.tsx:76-80); duración de etapa inicial (live-monitor.ts:83). La respuesta final también es obligatoria (student.functions.ts:276). | ver lista |
| **PDFs con restricción de páginas** [A] | §5.3 | material-files.ts:6, tutor-prompt.ts:47, material.functions.ts:40, material-extract.server.ts:22-60 |

### 7.2 Bugs y comportamientos rotos

| # | Sev | Problema | Dónde |
|---|---|---|---|
| 1 | A | Desactivar el enlace o vencerlo **no corta** a los alumnos que ya tienen token (12 h): `resolveStudentToken` no chequea `is_active/starts_at/expires_at` (comentario miente: "link active") | student-session.server.ts:37-43 |
| 2 | A | "Volver a borrador" expulsa a todos sin confirmación ni aviso al alumno (le aparece "Tu sesión terminó") | actividades:60-66, 159-162; student-session.server.ts:43 |
| 3 | A | Cambiar de pestaña pierde ediciones no guardadas (Radix desmonta) en Consigna y tutor, Rúbrica y Reflexión; sin indicador de cambios ni guard al salir | actividades:196-222; ui/tabs.tsx |
| 4 | A | Adjuntar "De Mis materiales" pisa el material escrito no guardado (efecto de sincronización) | actividades:254-256; library.functions.ts:125-131 |
| 5 | A | Aula archivada: no hay forma de verla ni desarchivarla; sus links siguen abiertos | edit-classroom-dialog.tsx:89-98; queries.ts:61 |
| 6 | A | Archivo queda en "Leyendo…" para siempre si el procesamiento (disparado desde el navegador) se corta; reintento solo para `failed` | activity-files.tsx:99-101, 168-181; material.functions.ts:28 |
| 7 | A | "Volver a sugerir" en la rúbrica sobrescribe los niveles que eligió el docente (`teacher_levels = sugerencia`) | activity-ai.functions.ts:285-298; rubric-assessment.tsx:237-239 |
| 8 | A | La IA de rúbrica se ejecuta **sola** al abrir la ficha de un alumno terminado (costo y sorpresa) y el texto dice que ocurre "cuando un alumno termina" | rubric-assessment.tsx:72-79; rubric-editor.tsx:138 |
| 9 | M | Evidencia de la rúbrica sin verificar contra el texto del alumno (puede inventar "citas textuales"); sin evidencia → nivel más bajo (sesgo) | activity-ai.functions.ts:244-246, 275-284 |
| 10 | M | Dashboard: "Actividades en curso/finalizadas" cuentan sesiones, tope 50; "Estudiantes" cuenta inscripciones; errores ignorados | queries.ts:172-201; app.index.tsx:40-43 |
| 11 | M | "Última señal" considera `left_app` (el alumno se fue) y `ended_by_teacher` como actividad → aparece "Activo" | live-monitor.ts:30-34; alerts.server.ts:137 |
| 12 | M | Mapa "Actividad por minuto" cuenta eventos no generados por el alumno (entró, salió, pegó, cierre del docente, completed) como "acciones del alumno" | live-monitor.tsx:450, 470 |
| 13 | M | Mapa "Tipo de ayuda" pinta de rojo ("Mucho (atención)") conductas positivas: Mensajes, Otra idea, Explicó | live-monitor.tsx:405-433; live-monitor.ts:95-113 |
| 14 | M | Escalas relativas al máximo del grupo → siempre hay alguien "rojo" aunque todos estén bien | live-monitor.ts:135-138 |
| 15 | M | "Tiempo" incluye pausas/días sin actividad | live-monitor.tsx:116-123 |
| 16 | M | "Nueva actividad" crea filas inmediatamente (borradores basura) | app.aulas.$classroomId.tsx:118-129 |
| 17 | M | Publicar sin validar consigna/título; sin preview del alumno | actividades:60-66 |
| 18 | M | Token del link no se puede regenerar (link filtrado = actividad comprometida) | 0000:320, 338-349 |
| 19 | M | Fechas del link sin validación (vence antes de empezar) y en hora local sin indicar zona | actividades:516-541 |
| 20 | M | Duplicar no es transaccional; título largo rompe el CHECK; solo misma aula | actividades:68-115 |
| 21 | M | `addStudentsToClassroom` genera y descarta códigos de acceso (lógica deprecada); toast de "omitidos" con motivo falso; correos mal escritos descartados en silencio → alumnos duplicados | staff.functions.ts:97-107; app.aulas.$classroomId.tsx:198-210, 228-229 |
| 22 | M | Crear aula sobrescribe `profiles.full_name` con el campo "Nombre de la docente" | app.aulas.index.tsx:105-108 |
| 23 | M | `SessionMaterial` dice "lo mismo que veía en pantalla" pero muestra el material actual | session-material.tsx:22-23 |
| 24 | M | Resumen: "lee la conversación completa" pero corta en 200 mensajes / 24 000 chars; resultado no editable ni validable | session-summary.functions.ts:30, 94; session-summary.tsx:88 |
| 25 | M | Ningún aviso de truncado de material (12 000), indicaciones (3 000), archivos (15 000) | tutor-prompt.ts:47, 53, 64 |
| 26 | M | Reportes guardan copia de datos de alumnos que sobrevive a "borrar trabajo/actividad/aula" | 0005:132-145; delete.functions.ts |
| 27 | B | Status `archived` de actividad nunca usado; pill lo mostraría como "Borrador" | 0000:4; actividades:144-146 |
| 28 | B | `rubricStatus` se descarga y no se usa | queries.ts:228, 264 |
| 29 | B | `LiveChatButton` en alertas siempre `live` → polling 5 s aunque la sesión esté cerrada | live-alerts.tsx:144 |
| 30 | B | Copiar al portapapeles sin manejo de error; "Descargar QR" `disabled` sin efecto | actividades:453-456, 552 |
| 31 | B | Transcripción de audio fija en español aunque la actividad sea "En inglés" | material-extract.server.ts:68 |
| 32 | B | Conteo "intervenciones del tutor" incluye borradores parciales | app.sesiones.$sessionId.tsx:35, 61 |
| 33 | B | `window.open` tras `await` (bloqueado por navegadores) para abrir archivos | activity-files.tsx:106-113; session-material.tsx:11-18 |
| 34 | B | Selector de cantidad de criterios IA llega a 6 pero el máximo es 8 | rubric-editor.tsx:171 |
| 35 | B | Tab activa de la actividad no está en la URL (recargar vuelve a "En vivo") | actividades:49 |

### 7.3 Funciones simuladas, a medias o muertas

| Qué | Estado | Dónde |
|---|---|---|
| `CredentialsDialog`, `regenerateStudentCode`, `student_credentials`, códigos PBKDF2 | Código muerto (modelo de ingreso por código abandonado) | credentials-dialog.tsx; staff.functions.ts:122-170; 0003:4 |
| Tipo "Escritura a mano": "Actividad de captura y análisis de escritura manuscrita" | No hay captura de fotos/manuscritos por parte del alumno: es solo chat | pedagogy.ts:97-100, 155-156 |
| Tipo "Selección múltiple": "opción múltiple, emparejamiento y completar espacios" | Solo texto en el chat, sin UI de opciones ni corrección | pedagogy.ts:89-92, 157-158 |
| Tipo "Expresión oral": "Práctica y evaluación de la expresión oral" | Depende de activar audio por separado; no hay evaluación oral | pedagogy.ts:101-104 |
| Tipo "Producción escrita": "con rúbrica de evaluación explícita" | La rúbrica no se vincula al tipo | pedagogy.ts:93-96 |
| "Actividad de transferencia sin ayuda" | Placeholder explícito | app.radiografia.$sessionId.tsx:193-195 |
| Estado `archived` de actividades | Nunca seteable | 0000:4 |
| Archivar aula | Ida sin vuelta | edit-classroom-dialog.tsx:89-98 |
| "Autorizados" | No hay lista de autorizados: entra cualquiera con el link | participation-table.tsx:29-31 |
| `source: inferred` en eventos | Ningún código escribe eventos inferidos; la etiqueta "Inferencia de IA" en eventos nunca aparece | app.sesiones.$sessionId.tsx:186 |
| Intervención del docente en el chat | No existe (solo lectura) | live-chat.tsx |

### 7.4 Accesibilidad y mobile

| Sev | Problema | Dónde |
|---|---|---|
| A | Sin "Cerrar sesión" en mobile | app.tsx:81 |
| M | Tabla de alumnos del aula sin scroll horizontal | app.aulas.$classroomId.tsx:288 |
| M | Editor de rúbrica: grilla de niveles desborda en mobile | rubric-editor.tsx:212 |
| M | Mapas de calor: info solo por color + `title` (hover); "Pasá el mouse" imposible en touch; sin `<caption>`/`scope` | live-monitor.tsx:318, 341-353 |
| M | "Importar CSV": `<input type=file class=hidden>` dentro de label → no operable con teclado | app.aulas.$classroomId.tsx:276-279 |
| M | `Label` sin `htmlFor` en Selects (tutor guardado, nivel de ayuda, audio, institución, cantidad IA, tipo/urgencia de alerta) → comboboxes sin nombre accesible | actividades:328, 357, 373; app.aulas.index.tsx:139; ai-draft-panel.tsx:66; classroom-alerts.tsx:199, 208 |
| M | Selector de niveles de rúbrica: sin `aria-pressed`; descripción del nivel solo en `title` | rubric-assessment.tsx:183-200 |
| B | Barra de progreso sin `role=progressbar`/texto alternativo (hay "n/3" visual) | live-monitor.tsx:221-224 |
| B | Lápiz del `InlineTitle` solo visible en hover; "Hacé clic" en touch | inline-title.tsx:96, 104 |
| B | Confirmaciones con `window.confirm` | activity-files.tsx:116; classroom-alerts.tsx:44 |
| B | Feedback solo por toast (errores no quedan en pantalla) | general |
| B | Header de actividad con 4–5 botones que se apilan; nav mobile de 8 ítems con scroll | actividades:150-192; app.tsx:68 |

---

## 8. Textos visibles que hacen afirmaciones sobre el producto

Veredicto: ✔ cierto · ≈ parcial · ✘ falso/engañoso.

| file:línea | Texto | Veredicto |
|---|---|---|
| app.aulas.index.tsx:27 | "Cada aula pertenece a una institución. Sus alumnos y actividades se mantienen separados." | ✘ Los alumnos son por institución (mismo email = mismo alumno en todas las aulas, 0003:3) y dentro del aula se mezclan todas las actividades |
| app.tsx:27 | "Aulas, actividades y seguimiento del pensamiento de tus alumnos." (meta) | ≈ |
| app.tsx:128-130 | "Todavía no pertenecés a ninguna institución… podés crear el espacio de tu institución: quedarás como administrador y docente." | ✔ (a eliminar) |
| app.index.tsx:31 | "Un vistazo a lo que está pasando en tus aulas." | ≈ (solo últimas 50 sesiones) |
| app.index.tsx:41 | "Estudiantes · Inscriptos en tus aulas" | ✘ cuenta inscripciones, no alumnos |
| app.index.tsx:42-43 | "Actividades en curso" / "Actividades finalizadas" | ✘ son trabajos de alumnos, tope 50 |
| app.index.tsx:50 | "Situaciones observables, no evaluaciones. Revisá la conversación antes de decidir." | ✔ |
| app.index.tsx:84 | "Cuando tus alumnos ingresen a una actividad, vas a verlos aquí." | ✔ |
| app.aulas.$classroomId.tsx:140 | "Creá una actividad, configurá al tutor y publicala para obtener el enlace." | ✔ |
| app.aulas.$classroomId.tsx:169-172 | "Se borran para siempre la actividad, su enlace y sus archivos… y el trabajo de N alumnos (chats, rúbricas, resúmenes y alertas)." | ≈ quedan copias en informes y audit_logs |
| app.aulas.$classroomId.tsx:252 | "Los alumnos se suman solos al abrir el enlace de una actividad con su nombre y correo. También podés agregarlos a mano." | ✔ (es justamente la causa de la mezcla) |
| app.aulas.$classroomId.tsx:264-266 | "Escribí un alumno por línea con su correo después de una coma… Cuando entre por el enlace con ese correo, su trabajo queda asociado a este alumno." | ≈ si el correo está mal escrito se descarta en silencio y se duplica |
| app.aulas.$classroomId.tsx:229 | "N alumnos no se agregaron (ya existían en la institución)." | ≈ motivo genérico |
| app.aulas.$classroomId.tsx:320-321 | "Se borra todo su trabajo en las actividades de esta aula… Si vuelve a entrar con el enlace, empieza de cero." | ✔ |
| edit-classroom-dialog.tsx:123 | "Los cambios se ven enseguida en tu panel y en el enlace que abren los alumnos." | ✔ |
| edit-classroom-dialog.tsx:157-158 | "Se borran para siempre el aula, todas sus actividades… Los alumnos que no estén en otra aula también se borran." | ≈ (informes) |
| edit-classroom-dialog.tsx:173 | "El aula deja de aparecer en "Mis aulas". Los alumnos, actividades y su trabajo se conservan." | ✘ omite que no se puede recuperar desde la UI y que los links siguen abiertos |
| actividades:63 | "Actividad publicada: ya tiene su enlace" | ✔ |
| actividades:113 | "Actividad duplicada como borrador" | ✔ (aunque fallen archivos) |
| actividades:172-173 | "Se borran para siempre la actividad, su enlace, sus archivos y todo el trabajo…" | ≈ |
| actividades:268 | "Cargamos la configuración de "X". Revisala y tocá Guardar cambios." | ✔ |
| actividades:314 | "Consigna inicial (la ve el alumno)" | ✔ |
| actividades:320 | "El alumno lo ve en su pantalla. El tutor lo usa como referencia y no sigue instrucciones escritas dentro del material." | ≈ el tutor solo ve 12 000 chars; "no sigue instrucciones" es una regla del prompt, no una garantía |
| actividades:388 | "Lo que dicen queda escrito en el chat, así lo ves en «En vivo»." | ✔ |
| actividades:394 | "No pueden desactivar las reglas de seguridad ni pedirle al tutor que dé la respuesta." | ≈ solo por prompt (tutor-prompt.ts:24-36, 64); no hay verificación |
| actividades:435 | "Al publicarla se genera automáticamente su enlace único." | ✔ (y nunca cambia) |
| actividades:459 | "…: ingresá con tu nombre y tu correo." | ✔ |
| actividades:512-513 | "Quien abra el enlace entra con su nombre y su correo, sin código ni verificación. Si vuelve a ingresar con el mismo correo, retoma su trabajo. Cada alumno ve solo lo suyo." | ≈ cualquiera que sepa el correo de otro alumno retoma su trabajo |
| actividades:527 | "Enlace activo" / "Enlace desactivado" | ✘ desactivado no corta a quien ya está dentro |
| activity-files.tsx:99 | ""X" subido. El tutor lo está leyendo…" | ≈ lo lee otro modelo, no el tutor |
| activity-files.tsx:134 | "PDF, imágenes (JPG, PNG) o audios (MP3, M4A, WAV, OGG). Hasta 20 MB cada uno." | ≈ acepta también WEBP/AAC/WEBM |
| activity-files.tsx:169 | "Listo para el tutor" | ✘ solo los primeros 15 000 caracteres |
| activity-files.tsx:200-201 | "Los archivos se guardan al instante. El alumno los ve en su pantalla y el tutor los usa como referencia (los audios se transcriben automáticamente)." | ≈ ídem |
| live-monitor.tsx:149 | "Se actualiza solo mientras los alumnos trabajan. Todo lo que ves son datos observados." | ✘ en la misma vista están las alertas de IA; se actualiza siempre (polling) |
| live-monitor.tsx:154-156 | "Señal en los últimos 2 min" / "Entre 2 y 15 min sin señal" / "Más de 15 min sin señal" | ≈ "señal" incluye haber salido de la app |
| live-monitor.tsx:190 | "Todavía no hay alumnos en esta aula. Aparecen acá cuando abren el enlace." | ✔ |
| live-monitor.tsx:294 | "Se guarda lo que hizo hasta ahora y ya no podrá seguir escribiendo. Usalo, por ejemplo, para cerrar trabajos abandonados." | ✔ (irreversible, no lo dice) |
| live-monitor.tsx:318 | "Colores de semáforo: verde está bien, amarillo conviene mirar, rojo necesita atención. Pasá el mouse por una celda para ver el detalle." | ✘ rojo marca conductas positivas y es relativo al grupo |
| live-monitor.tsx:470 | "Cada número cuenta acciones del alumno." | ✘ incluye eventos del sistema/docente |
| live-chat.tsx:169 | "Ves la charla mientras sucede: los mensajes del alumno aparecen al instante y la respuesta del tutor, palabra por palabra." | ✔ |
| live-alerts.tsx:104-106 | "Las alertas sobre lo que escribe cada alumno son inferencia de IA; las de pegar texto o salir de la actividad son datos observados. Revisá el chat antes de actuar. Los alumnos no ven estas alertas." | ≈ el alumno sí ve el aviso genérico de que se registran pegados/salidas (workspace.tsx:81) |
| participation-table.tsx:29-31 | "Estudiantes autorizados y participación" / "Autorizados" | ✘ no hay autorización: son los inscriptos del aula |
| participation-table.tsx:33 | "Comenzaron · Escribieron su respuesta inicial" | ✔ hoy; se rompe si es opcional |
| participation-table.tsx:59 | "Todavía nadie ingresó. Los alumnos aparecen acá cuando abren el enlace." | ≈ |
| app.sesiones.$sessionId.tsx:105-106 | "Se borran sus respuestas, el chat con el tutor, la rúbrica, el resumen y las alertas de esta actividad. Si vuelve a entrar con el enlace, empieza de cero." | ✔ (salvo informes) |
| app.sesiones.$sessionId.tsx:165 | "El alumno está trabajando: los mensajes nuevos aparecen solos, tal cual los escriben él y el tutor." | ✔ |
| app.sesiones.$sessionId.tsx:178 | "Datos observados directamente en la actividad." | ✔ |
| session-material.tsx:22-23 | "Material que tenía el alumno" / "Lo mismo que veía en pantalla mientras hablaba con el tutor." | ✘ es el material actual |
| rubric-editor.tsx:138-139 | "Cuando un alumno termina, la IA sugiere un nivel por criterio con la evidencia que lo respalda. Vos lo confirmás o lo cambiás desde la ficha del alumno: nada queda como nota sin tu confirmación." | ≈ se dispara al abrir la ficha; evidencia no verificada; la segunda oración es cierta |
| rubric-editor.tsx:149-150 | "Subila en PDF, Word, foto o texto y la pasamos al editor para que la revises (reemplaza la que está ahora)." | ✔ |
| rubric-assessment.tsx:138 | "El alumno todavía no terminó. Podés pedir una sugerencia con lo que lleva hecho." | ✔ |
| rubric-assessment.tsx:165 | "Sugerencia de la IA · falta tu confirmación" | ✔ |
| rubric-assessment.tsx:172 | "La rúbrica cambió después de esta sugerencia. Podés volver a pedirla." | ✔ (pero pierde tus niveles) |
| ai-draft-panel.tsx:49 | "La IA propone, vos revisás y editás antes de guardar" | ✔ |
| ai-draft-panel.tsx:51 | "Usa el título, los objetivos, la consigna y el material que ya guardaste en la actividad." | ≈ también ~3 000 chars por archivo; no ve cambios sin guardar |
| reflection-editor.tsx:64 | "El alumno las responde al terminar, junto con su respuesta final. Podés dejar pocas, cambiarlas o no poner ninguna." | ✔ |
| reflection-editor.tsx:71 | "Sin preguntas: el alumno solo escribe su respuesta final." | ✔ |
| reflection-editor.tsx:136 | "Los alumnos que ya terminaron conservan las preguntas que respondieron." | ✔ |
| session-summary.tsx:71 | "Elegí en qué basar el resumen. Es una lectura de la IA: revisala antes de usarla." | ✔ |
| session-summary.tsx:88 | "La IA está leyendo la conversación completa…" | ≈ tope 200 mensajes/24 000 chars |
| classroom-alerts.tsx:77 | "Alertas que aporta la plataforma… Las de seguridad no se pueden desactivar." | ✔ |
| classroom-alerts.tsx:146 | "Las alertas son una inferencia de la IA sobre lo que escribe cada alumno… Nunca se le muestran al alumno." | ≈ 2 de las 9 son observadas, no IA |
| classroom-alerts.tsx:186 | "La IA la busca en cada mensaje de tus alumnos y te avisa en «En vivo»." | ≈ salta mensajes de botones preset |
| tutor-type-select.tsx:163 | "Cada tipo cambia cómo conversa el tutor con tus alumnos. Siempre pregunta y guía: nunca da la respuesta final." | ≈ "nunca" es una instrucción al modelo, no garantía |
| pedagogy.ts:89-104 | descripciones de Selección múltiple, Producción escrita, Escritura a mano, Expresión oral | ✘ ver 7.3 |
| confirm-delete.tsx:53 | "Esto no se puede deshacer." | ✔ |
| app.alumnos.$studentId.tsx:64 | "Todavía no empezó ninguna de tus actividades." | ✔ |
| app.radiografia.$sessionId.tsx:130 | "Datos observados, tal como quedaron registrados." | ≈ "Preguntas del tutor" y "Reformulación" son heurísticas por regex/botones |
| app.radiografia.$sessionId.tsx:194 | "Actividad de transferencia sin ayuda: todavía no está disponible en la plataforma." | ✔ (placeholder) |

---

## 9. Checklist de requisitos para la reconstrucción

**Espacio y modelo**
- [ ] Sin instituciones ni onboarding: `workspace` del docente (acceso por enlace/clave privada guardada; cuenta opcional para recuperar). Aulas, alumnos y actividades cuelgan del workspace.
- [ ] Alumnos identificados **por actividad** (participante = sesión de esa actividad). Roster del aula opcional y explícito; entrar por un link **no** inscribe en el aula.
- [ ] FKs con `ON DELETE CASCADE` en Postgres para todo lo derivado de sesión/actividad/aula; borrado de archivos en disco en el mismo job; informes que referencien sesiones borradas se marcan o se purgan.

**Aulas**
- [ ] CRUD; archivar **y desarchivar** (vista "Archivadas"); al archivar, cerrar links de sus actividades (o preguntar).
- [ ] Nombre del docente separado de la creación del aula.

**Actividades**
- [ ] Crear con formulario (sin filas fantasma); duplicar transaccional (también a otra aula).
- [ ] Estados: draft → published → closed (cerrada para todos) → archived; transiciones con confirmación y efecto inmediato en sesiones abiertas (mensaje claro al alumno).
- [ ] Validación antes de publicar (título, consigna) y vista previa como alumno.
- [ ] **`require_initial_answer` (bool, por actividad)** y opcionalmente `require_final_answer`; respetarlo en UI alumno, API del tutor, prompt, etapas del monitor, razones de acompañamiento y estadísticas.
- [ ] **Reiniciar actividad**: borrar todas las sesiones y derivados (mensajes, eventos, rúbricas, resúmenes, radiografías, alertas, tokens), conservar configuración/archivos; opción "generar enlace nuevo"; confirmación con conteo.
- [ ] Borrar trabajo individual; "Terminar" individual **y** "Terminar para todos"; reabrir sesión.
- [ ] Guard de cambios sin guardar; pestañas en la URL; avisar topes de longitud (o eliminarlos).

**Enlace**
- [ ] Token regenerable; activo/inicio/vencimiento **validados en cada request del alumno**, no solo al ingresar; validación vencimiento > inicio; zona horaria explícita.
- [ ] Copiar con fallback, compartir, QR descargable.

**Monitor en vivo**
- [ ] Lista = participantes de la actividad (+ opcional "del roster, faltan: …").
- [ ] Una sola tabla (no duplicada); actualización por SSE/WebSocket desde Hono o polling liviano incremental (no re-descargar todos los eventos).
- [ ] "Última señal" solo con eventos generados por el alumno; tiempo activo ≠ tiempo transcurrido.
- [ ] Heatmaps con semántica correcta (ayuda ≠ participación), umbrales absolutos opcionales, tooltip accesible por teclado/touch, no depender solo del color.
- [ ] Drill-down: chat en vivo, recorrido (inicial → preguntas del tutor → reformulaciones → final → reflexión), material **snapshot** al momento de la sesión.

**IA (Claude Haiku, `claude-haiku-5-5`)**
- [ ] Un solo cliente Anthropic en el server con salida estructurada (`output_config.format` / `messages.parse` + zod); errores 429/overload mapeados a mensajes en español.
- [ ] Toda salida de IA rotulada "Sugerencia de IA"; nada se aplica ni se ejecuta solo sin acción del docente (no auto-sugerir rúbrica al abrir); regenerar nunca pisa decisiones del docente.
- [ ] Citas de evidencia verificadas (`quoteAppears`) en rúbrica, resumen, radiografía y alertas.
- [ ] Resumen editable/validable por el docente.

**Archivos**
- [ ] Tipos PDF/JPG/PNG/WEBP/audio; un único límite de tamaño coherente en UI, API y DB; máx archivos por actividad.
- [ ] Subida al API (no directo a storage desde el navegador); procesamiento en **job de fondo** con estados, timeout, reintento manual y automático (sin "Leyendo…" eterno).
- [ ] PDF: extracción de texto nativa por página (p. ej. pdf.js/poppler) y OCR/visión con Claude solo para páginas sin texto, en lotes por debajo de los límites de PDF por request (32 MB / 600 páginas con modelos de 1M); guardar texto **por página**.
- [ ] Audio: proveedor STT separado (Claude no acepta audio), idioma según la actividad.
- [ ] El tutor accede a todo el material (recuperación por fragmentos/páginas relevantes o presupuesto amplio con prompt caching), y la UI muestra qué leyó ("el tutor tiene acceso a 42/42 páginas"); el docente puede ver/corregir el texto extraído.

**Accesibilidad y mobile**
- [ ] Cerrar sesión/salir visible en mobile; tablas con scroll o tarjetas; editor de rúbrica responsive.
- [ ] Labels asociados a todos los controles; botones de nivel con `aria-pressed`; inputs de archivo operables con teclado; confirmaciones con diálogos propios; errores persistentes en pantalla además de toast.

**Textos**
- [ ] Reescribir todo lo marcado ✘/≈ en §8 (instituciones, "autorizados", "datos observados", "listo para el tutor", semáforo, "material que tenía el alumno", tipos de tutor que prometen funciones inexistentes).
- [ ] Eliminar código y textos del modelo de códigos de acceso (`CredentialsDialog`, `student_credentials`).
