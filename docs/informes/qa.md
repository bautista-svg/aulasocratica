# Informe de QA — Aula Socrática

Fecha: 21-10-2026. Versión verificada: la desplegada en `https://aulasocratica.becode.com.ar` (rama `main`), más las
dos correcciones de seguridad menores del cierre (F-09 y F-15, ver `seguridad/INFORME.md`).

## 1. Qué se ejecutó y con qué resultado

| Nivel | Qué cubre | Dónde corre | Resultado |
|---|---|---|---|
| Unitarios | Reglas puras: pedagogía, tutores precargados, prompt del tutor, monitor en vivo, nombres, planificación, informes, radiografía, Markdown del alumno, contrato del alumno, compresión, rangos de Cloudflare, reglas de sesiones | Vitest (`npm test`) | **14 archivos, 74 tests, todos pasan** |
| Integración | Cada endpoint de la API contra **PostgreSQL real** (base aislada por trabajador) y una IA simulada por HTTP: permisos, validaciones, persistencia, archivos reales (PDF de 120 y 150 páginas, Word, imágenes, audio), límites, borrados en cascada, informes, retención | Vitest (`npm test`) | **16 archivos, 161 tests, todos pasan** |
| Total `npm test` | | | **30 archivos, 235 tests, 0 fallas** · `npm run typecheck` limpio · `npm run build` OK |
| E2E (Playwright) | Portada sin errores; health; empezar sin cuenta y borrar el espacio; recorrido completo: docente crea aula y actividad, publica, **dos alumnos** trabajan con el tutor, el docente los ve **por actividad**, descarga el **PDF del recorrido** y **reinicia** la actividad | `mobile-375` y `desktop-1440` (Chrome) | **8/8 local** (build de producción) y **8/8 contra producción** |
| IA real en producción | 17 comprobaciones con Claude Haiku 5.5 (`scripts/dev/prod-ai-full.mjs`) | Producción, espacio descartable que se borra al final | **17/17** |
| Auditoría UI/UX | Todas las pantallas y estados, 7 anchos (320–1440), teclado, lector de pantalla (árbol de accesibilidad), axe-core | Playwright + axe sobre build de producción | 40 defectos encontrados, **40 corregidos y re-verificados** |
| Auditoría de seguridad | 16 hallazgos (1 crítico, 1 alto, 5 medios, 5 bajos, 4 informativos) | Revisión de código + pruebas de explotación locales | 11 corregidos, 1 mitigado, 4 aceptados con justificación |
| Auditoría de rendimiento | Lighthouse (5 corridas), INP de laboratorio, carga de API, memoria, bundles | Local con datos sembrados + producción | Ver `rendimiento.md` |

Comprobaciones de IA real (17/17): estado de la IA · lectura de foto (visión) · lectura de un PDF escaneado (páginas
que son imágenes, sin capa de texto) · Crear con IA: propuestas · Crear con IA: crear y publicar · rúbrica propuesta ·
reflexión propuesta · importar rúbrica desde archivo · alumno entra · tutor responde (dos turnos, incluido el tono) ·
alumno termina · detección de alertas · evaluación con rúbrica sugerida · resumen del trabajo · radiografía del
pensamiento · texto de informe propuesto.

## 2. Matriz de cobertura por funcionalidad

`U` unitario · `I` integración · `E2E` Playwright · `UI` auditoría UI/UX · `IA` comprobación con IA real en
producción. Los pedidos del WhatsApp están en **negrita**.

| Funcionalidad | U | I | E2E | UI | IA |
|---|---|---|---|---|---|
| Empezar sin cuenta / borrar el espacio | | auth-classrooms | smoke | ✔ | |
| Cuenta opcional, ingreso, recuperación, unión de espacios | | auth-classrooms, security-fixes | | ✔ | |
| Aulas: crear, editar, archivar, restaurar, eliminar | | auth-classrooms | flows | ✔ | |
| **Alumnos separados por actividad** | live-monitor | auth-classrooms, live | flows | ✔ | |
| **Subir PDF sin límite de páginas** (y Word, fotos, audio, texto) | | activities-files, materials, upload-safety | | ✔ (PDF de 200 págs.) | ✔ (foto y PDF escaneado) |
| **Sin el texto falso de instituciones** | | | | ✔ | |
| **Crear con IA desde PDF, foto o Word** | planning | planning | | ✔ | ✔ |
| **Mis tutores: todos precargados, editables y elegibles** | tutor-presets | tutors, activities | | ✔ | |
| **Respuesta inicial opcional** | | activities, student, live | | ✔ | |
| **Reiniciar actividad borrando sus datos** | | activities | flows | ✔ | |
| **PDF del recorrido desde En vivo** | | sessions | flows | ✔ | |
| Configuración de la actividad (consigna, objetivos, material, tutor, rúbrica, reflexión, voz) | rules | activities | flows | ✔ | ✔ (rúbrica, reflexión) |
| Publicar, enlace, QR, apertura/cierre, regenerar | | activities, student | flows | ✔ | |
| Alumno: entrar con nombre, código para otro dispositivo | student-contract | student | flows | ✔ | ✔ |
| Alumno: tutor socrático con transmisión en vivo, ayudas, reintento | tutor-prompt, markdown | student | flows | ✔ | ✔ |
| Alumno: respuesta final y reflexión | | student | flows | ✔ | ✔ |
| En vivo: estado por alumno, alertas, terminar / permitir continuar | live-monitor | live, sessions | flows | ✔ | ✔ (alertas) |
| Trabajo: recorrido, conversación, evaluación, radiografía, resumen | thinking-xray | sessions | | ✔ | ✔ |
| Mis materiales | | materials | | ✔ | |
| Informes (individual, grupal, general; CSV y PDF) | reports | reports, security-fixes | | ✔ | ✔ |
| Inicio del docente | | dashboard | flows | ✔ | |
| Administración | | admin | | ✔ | |
| Retención de datos | | retention | | | |
| Seguridad: CSRF, cuotas, topes de IA, IP real, aislamiento de archivos | cloudflare-ip | security-fixes, upload-safety | | | |

Huecos conocidos de la matriz, sin prueba automática:
- **Voz:** el dictado y la lectura en voz alta dependen del navegador. La auditoría UI solo pudo verificar el caso
  "sin permiso de micrófono".
- **Hoja de compartir del sistema:** el botón "Compartir…" del celular no es automatizable.
- **Tiempo real con muchos alumnos simultáneos:** probado con carga sintética (ver `rendimiento.md` §3.5), no con una
  clase real.

## 3. Defectos encontrados y corregidos

### Auditoría UI/UX (detalle en `auditoria-ui/INFORME.md`)

| Gravedad | Encontrados | Corregidos | Ejemplos |
|---|---|---|---|
| Crítica | 0 | — | — |
| Alta | 4 | 4 | D01 doble clic creaba duplicados; D02 la UI decía que los alumnos no veían el nombre del docente; D03 desborde horizontal en el inicio a 320–430 px; D04 el tutor "predeterminado" ignoraba la edición |
| Media | 14 | 14 | Foco perdido al cerrar diálogos; borrador de la primera idea que no persistía; "Terminar para todos" no cerraba la actividad; contraste (axe, 35 nodos); `<title>` genérico |
| Baja | 22 | 22 | Estados contradictorios en En vivo; horas en 12 h y 24 h; botón "Close toast" en inglés; objetivos táctiles menores a 44 px |

Cada corrección se re-verificó con Playwright. La evidencia "antes/después" está en
`auditoria-ui/correcciones/{global,docente,alumno}/`, con los resultados de los scripts en los `.json` de esas carpetas.

### Defectos encontrados por la verificación con IA real

| Defecto | Corrección | Verificación |
|---|---|---|
| Toda la IA fallaba en producción porque la API key es de usuario y necesita el workspace | Encabezado `anthropic-workspace-id` desde `ANTHROPIC_WORKSPACE_ID` | 16/16 en producción |
| El clasificador de alertas marcaba como "poco compromiso" a un alumno que hacía una pregunta genuina | Instrucciones más estrictas; las citas solo pueden salir del texto revisado | `prod-ai-full.mjs`; evidencia `evidencia-final/09-en-vivo-1440.png` |
| Alertas duplicadas cuando dos análisis terminaban a la vez | Nueva comprobación justo antes de insertar | I: live |
| El cálculo de gasto de IA fallaba en Postgres (tipos de los parámetros) | Precios como literales SQL | I: security-fixes, admin |

### Defectos del despliegue

| Defecto | Corrección |
|---|---|
| El primer build en Coolify falló con `vite: not found`: Coolify pasa `NODE_ENV=production` al build | `npm ci --include=dev` en la etapa de build del Dockerfile |
| La consola de producción mostraba un error de CSP por el beacon de Cloudflare Web Analytics | CSP ajustada y declarado en `/privacidad` |

## 4. Cómo se prueba (reproducible)

```bash
npm ci
npm test                       # unitarios + integración (necesita Postgres local; ver docs/OPERACION.md)
npm run typecheck
npm run build
npx playwright test            # E2E contra la app levantada en http://localhost:5173 (npm run dev)
E2E_BASE_URL=https://aulasocratica.becode.com.ar npx playwright test   # E2E contra producción (crea y borra su propio espacio)
node scripts/dev/prod-ai-full.mjs https://aulasocratica.becode.com.ar   # 17 comprobaciones con IA real (gasta centavos)
node scripts/dev/prod-axe.mjs https://aulasocratica.becode.com.ar       # axe-core + desborde horizontal en todas las pantallas, 375 y 1440 px
node scripts/dev/evidence-screens.mjs https://aulasocratica.becode.com.ar docs/informes/evidencia-final   # capturas finales
```

Las pruebas contra producción crean un espacio de prueba y lo **borran al final** (también si fallan).
