# Inventario funcional

Fuente de verdad del proyecto: cada funcionalidad, cómo estaba en el prototipo de Lovable, qué problemas tenía, qué se
hizo y con qué prueba se verifica. "Estado original" resume las auditorías `docs/audit/A|B|C-*.md`.

Referencias de pruebas: `I:` = test de integración (`tests/integration/<archivo>`), `U:` = test unitario,
`E2E:` = Playwright (`tests/e2e/`), `UI:` = auditoría UI/UX con Playwright (`docs/informes/auditoria-ui/INFORME.md`).

Estados: **Funciona** (de punta a punta, persistido y probado) · **Parcial** · **Limitación** (decisión documentada).

## Acceso y espacio del docente

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| Usar la app sin crear cuenta | Inexistente: cuenta obligatoria (Supabase Auth) | Contradecía el requisito | "Empezar sin cuenta": espacio ligado al dispositivo (cookie httpOnly, token hasheado); funciona incluso sin JavaScript (formulario) | Crítica | I: auth-classrooms; E2E: smoke | Funciona |
| Cuenta opcional (correo + contraseña) | Login obligatorio, Google | — | Registro sobre el espacio actual; código de recuperación de un solo uso (no hay correo saliente) | Alta | I: auth-classrooms | Funciona |
| Entrar desde otro dispositivo sin perder lo hecho | No aplicaba | — | Al ingresar o recuperar la contraseña, el trabajo hecho sin cuenta en ese dispositivo se suma a la cuenta | Alta | I: auth-classrooms | Funciona |
| Recuperar contraseña | Por correo (Supabase) | — | Con código de recuperación; rota el código; cambiar la contraseña también lo rota | Alta | I: auth-classrooms, security-fixes | Funciona |
| Borrar mi espacio | Inexistente | — | Confirmación escribiendo BORRAR; borra filas y archivos | Media | I: auth-classrooms | Funciona |
| Instituciones | Multi-institución con roles | No reflejaba el uso real; texto falso "Cada aula pertenece a una institución…" | Eliminadas (decisión del usuario); la escuela es un dato opcional del aula | Alta | UI | Funciona |

## Aulas y alumnos

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| Crear/editar/archivar/restaurar/eliminar aula | Funcionaba; archivar ocultaba el aula sin forma de restaurar y dejaba los enlaces abiertos | Aula archivada irrecuperable, enlaces activos | Pestaña Archivadas con Restaurar; archivar cierra los enlaces de sus actividades | Alta | I: auth-classrooms; UI | Funciona |
| Lista de alumnos del aula | Alta manual/CSV con correo | Alumnos mezclados entre actividades | Lista opcional pegando nombres; los alumnos aparecen solos al entrar; **filtro "Mostrar alumnos de [actividad]"** | Alta (WhatsApp) | I: auth-classrooms; E2E: flows | Funciona |
| Corregir nombre / eliminar alumno con sus trabajos | Parcial | — | Renombrar con control de duplicados; eliminar con confirmación (y los informes se actualizan) | Media | I: auth-classrooms, security-fixes | Funciona |
| Alertas del aula (configurables) | Funcionaba | — | Catálogo de la plataforma (las de seguridad siempre activas) + alertas propias | Media | I: auth-classrooms | Funciona |

## Actividades

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| Crear actividad (desde un tutor guardado) | Funcionaba | El "predeterminado" ignoraba los tutores editados | Elige entre "Mis tutores" (todos precargados) | Alta (WhatsApp) | I: activities; UI | Funciona |
| Consigna, objetivos, material escrito | Funcionaba; cambiar de pestaña perdía cambios | Pérdida de datos | Editor con guardado explícito, aviso de cambios sin guardar, pestañas que no desmontan | Alta | I: activities; UI | Funciona |
| Archivos (PDF, Word, fotos, texto, audio) | PDF/imagen/audio; el tutor leía solo ~15.000 caracteres por archivo | "Límite de páginas" (WhatsApp); lecturas colgadas | **Sin límite de páginas**: texto por página localmente; PDF escaneado por IA en tramos; Word; fotos; audio con transcripción del docente; reintentar; vista previa; cola en segundo plano con recuperación; aislamiento ante archivos maliciosos | Crítica (WhatsApp) | I: activities-files (PDF de 120 págs), materials (150 págs), upload-safety; UI (200 págs) | Funciona |
| Respuesta inicial opcional | Obligatoria en 8 lugares | Pedido WhatsApp | Interruptor por actividad; tutor, etapas, recorrido y PDF lo respetan | Alta (WhatsApp) | I: activities, student, live; UI | Funciona |
| Tutor: tipo, nivel de ayuda, reglas | Funcionaba | Descripciones que prometían funciones inexistentes | Textos honestos; aplicar un tutor guardado | Media | U: tutor-presets | Funciona |
| Voz | STT/TTS de un proveedor externo | — | Dictado y lectura en voz alta del navegador (Web Speech API); se oculta si no hay soporte; el docente puede desactivarla por actividad; Privacidad informa que el dictado lo procesa el servicio de voz del navegador | Media | I: student (inputMode voz); UI (permiso) | Limitación: depende del navegador |
| Rúbrica (editar, proponer con IA, importar de archivo) | Funcionaba | La IA corría sola al abrir un trabajo | Propuestas solo a pedido y siempre revisables | Media | I: activities, sessions | Funciona |
| Reflexión final (editar, proponer con IA) | Volvían las preguntas por defecto al borrarlas | — | Lista vacía = sin reflexión, respetado por el alumno | Media | I: activities, student | Funciona |
| Publicar / despublicar / archivar | Funcionaba; despublicar echaba a los alumnos sin aviso | — | Confirmaciones explícitas | Media | I: activities | Funciona |
| Enlace: copiar, compartir, QR, aceptar alumnos, apertura/cierre, regenerar | Funcionaba; cerrar el enlace no frenaba a quienes ya estaban | Alumnos seguían 12 h | Disponibilidad verificada en **cada** pedido del alumno | Alta | I: student, activities | Funciona |
| Duplicar actividad (con archivos) | Funcionaba | — | Copia archivos; cuota de disco y límite de frecuencia | Baja | I: activities, security-fixes | Funciona |
| **Reiniciar actividad** borrando todos los datos | Inexistente | Pedido WhatsApp | Borra todos los trabajos (conversaciones, eventos, evaluaciones, alertas), conserva configuración y enlace (o lo regenera) | Alta (WhatsApp) | I: activities; E2E: flows | Funciona |
| Eliminar actividad | Funcionaba | — | Confirmación BORRAR; borra archivos del disco | Media | I: activities | Funciona |

## Alumno

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| Entrar por enlace | Nombre + correo, sin verificación; cualquiera con el correo de otro entraba como él | Suplantación, datos personales de menores | Solo nombre; token por dispositivo; código de 6 caracteres para seguir en otro dispositivo; "No soy yo" | Crítica | I: student; E2E: flows | Funciona |
| Respuesta inicial → charla con el tutor → respuesta final y reflexión | Funcionaba con errores (Enter borraba lo escrito) | — | Flujo nuevo, borradores que no se pierden, transmisión de la respuesta en vivo, reintento | Crítica | I: student; E2E: flows | Funciona |
| Botones de ayuda (pista, no entendí, ejemplo…) | Funcionaba | — | Eventos registrados; pistas contadas | Media | I: student | Funciona |
| Archivos de la actividad para el alumno | Enlaces firmados de 2 h que vencían | — | Servidos por la sesión del alumno, con soporte de rangos (audio en iOS) | Media | I: student | Funciona |
| Señales observadas (pegó texto, salió de la actividad) | Ruido (cualquier blur) | Falsos positivos | Solo pegados de afuera y ausencias ≥ 10 s por visibilidad; agrupadas | Media | I: student | Funciona |

## Seguimiento docente

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| **En vivo por actividad** | Mostraba a todo el aula en cada actividad | Pedido WhatsApp | Solo los alumnos que entraron a ESA actividad; estado, etapa, tiempo de trabajo, ayudas, alertas; actualización por SSE | Alta (WhatsApp) | I: live; E2E: flows | Funciona |
| Mapas de calor | Pintaban de rojo la ayuda pedida | Engañoso | Escala neutra→lila con números y leyenda | Baja | UI | Funciona |
| Alertas (IA + observadas) con revisión | Funcionaba | — | Revisada / Descartar / reabrir | Media | I: live | Funciona |
| **Panel de alertas de todos los alumnos** | Inexistente: solo por actividad | Pedido del cliente (21-10) | Página «Alertas» con las alertas de todas las aulas y actividades; las de atención inmediata primero; filtros por estado, aula, actividad, gravedad y origen; marcar varias como revisadas; contador en la navegación (pestaña propia en el celular); se actualiza sola cada 20 s | Alta | I: alerts; UI (axe 375/1440) | Funciona |
| Terminar un trabajo / para todos; permitir continuar | Sin vuelta atrás | — | Terminar, permitir continuar, terminar para todos | Media | I: live, sessions | Funciona |
| Trabajo del alumno: Recorrido, Conversación, Evaluación, Radiografía | Funcionaba en parte | Citas de IA sin verificar | Citas verificadas contra lo que escribió el alumno; sugerencias marcadas | Alta | I: sessions | Funciona |
| **PDF del recorrido completo** | Inexistente | Pedido WhatsApp | PDF real (no imprimir pantalla) desde En vivo y desde el trabajo | Alta (WhatsApp) | I: sessions; E2E: flows; UI | Funciona |
| Radiografía del pensamiento (lista y por trabajo) | Funcionaba; descartadas reaparecían | — | Validar/editar/descartar; no reaparecen; analiza toda la conversación | Media | I: sessions | Funciona |
| Página del alumno (todas sus actividades) | Funcionaba | — | Trabajos y actividades pendientes | Baja | I: students | Funciona |

## Biblioteca, tutores y "Crear con IA"

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| **Mis tutores con todos los tutores precargados y editables** | Vacío para un docente nuevo; los tipos solo en código | Pedido WhatsApp | Los 18 tutores se copian a cada espacio, editables, restaurables, duplicables; elegibles al crear actividades | Alta (WhatsApp) | I: tutors; UI | Funciona |
| Mis materiales (archivos, enlaces, textos, carpetas, etiquetas, búsqueda) | Funcionaba con recortes | — | Sin límite de páginas; vista previa; reintentar; "Usar en una actividad" sin pisar lo escrito | Media | I: materials | Funciona |
| **Crear con IA desde PDF, foto o Word** | Solo desde la biblioteca, con 3.500 caracteres por material | Pedido WhatsApp | Subida dentro del asistente; propuestas basadas en el material completo (o fragmentos con páginas); estado guardado; camino sin IA | Alta (WhatsApp) | I: planning; UI | Funciona |

## Informes, administración y contenido

| Funcionalidad | Estado original | Problemas | Solución | Prioridad | Prueba | Estado final |
|---|---|---|---|---|---|---|
| Informes individuales / grupales / generales | Datos armados en el navegador (manipulables); "PDF" = imprimir | Datos no confiables | Datos calculados en el servidor; texto del docente + propuesta de IA marcada; validar; CSV para Excel (;) y PDF real; se actualizan al borrar alumnos | Media | I: reports, security-fixes | Funciona |
| Panel de administración | Contraseña compartida, lockout evitable, datos de alumnos visibles | — | Sesión firmada, bloqueo por IP real, datos minimizados, suspender espacios | Media | I: admin | Funciona |
| Textos y afirmaciones | Afirmaciones falsas ("código personal", instituciones, chat de ejemplo sin rotular) | — | Textos revisados; ejemplo rotulado como ilustrativo; página /privacidad | Alta | UI | Funciona |
| Retención y borrado de datos | Inexistente | — | Tarea periódica documentada (30 días / 12 meses / cuentas hasta que se borren) | Media | U/I: retention | Funciona |
