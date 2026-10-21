# Aula Socrática — Informe final

**URL:** https://aulasocratica.becode.com.ar · **Fecha:** 21-10-2026 · **Repositorio:** `github.com/bautista-svg/aulasocratica` (privado, rama `main`)

## A. URL y estado verificado

| Comprobación | Resultado |
|---|---|
| El sitio responde por HTTPS con certificado válido (Cloudflare), HSTS y CSP | ✔ |
| `GET /api/health` (servidor + base de datos) | `{"status":"ok","db":"ok"}` |
| Estado de la IA (Claude Haiku 5.5) | `ok` |
| E2E contra producción (Playwright, 375 y 1440 px) | 8/8 |
| Funciones de IA con el modelo real en producción (incluida la lectura de PDF escaneado) | 17/17 |
| Despliegue automático (push a `main` → Coolify, ~4 min, el contenedor anterior sigue hasta que el nuevo está sano) | ✔ |
| Base PostgreSQL 17 propia en el VPS, migraciones automáticas al arrancar, backups diarios de Coolify | ✔ |

## B. Resumen ejecutivo

El prototipo de Lovable se reescribió como una aplicación de producción propia: React + Vite en el navegador,
Node + Hono + PostgreSQL en el servidor, desplegada en Coolify en el VPS, sin depender de Supabase ni de Lovable.

**Lo que cambió para el usuario:**
- **Se usa sin cuenta.** El docente entra con un clic y su espacio queda en ese dispositivo. La cuenta (correo y
  contraseña) es opcional y sirve para abrirlo desde otro lado. Los alumnos solo escriben su nombre.
- **Los 8 pedidos del WhatsApp están implementados y probados:**
  1. PDF sin límite de páginas.
  2. Sin el texto falso de instituciones.
  3. "Crear con IA" desde PDF, foto o Word.
  4. Alumnos separados por actividad.
  5. Reiniciar una actividad borrando sus datos.
  6. "Mis tutores" con los 18 tutores precargados, editables y elegibles.
  7. Respuesta inicial opcional.
  8. PDF del recorrido completo desde En vivo.
- **Nada decorativo ni falso.** Cada botón hace lo que dice y cada número sale de datos reales. Las afirmaciones del
  original que no eran ciertas se corrigieron o se quitaron, y las sugerencias de la IA están rotuladas como tales.
- **Mobile first y accesible.** Probado de 320 a 1440 px, con teclado y con axe-core. En producción, las 61 pantallas
  revisadas (con datos y vacías, a 375 y 1440 px) no tienen violaciones de axe ni desborde horizontal. Lighthouse da
  1,00 en accesibilidad en todas las páginas públicas.
- **Rápido.** En producción, la página del alumno pinta su contenido principal en ~2,1 s en un celular de gama media
  emulado (el original tardaba 17,9 s) y descarga 94 % menos JavaScript.
- **Seguro y con costo acotado.** El original tenía 16 problemas de seguridad, entre ellos uno crítico. Todos están
  corregidos, mitigados o aceptados con justificación. El gasto en IA tiene topes diarios en dólares (por docente y
  global).

**Cómo se trabajó:**
- **Auditoría del original:** tres auditorías (funcional, técnica y de UX).
- **Desarrollo por módulos:** agentes especializados en paralelo.
- **Tres auditorías finales independientes:**
  - UI/UX con Playwright: 40 defectos, los 40 corregidos y re-verificados.
  - Seguridad: 16 hallazgos.
  - Rendimiento: mediciones antes y después.
- **Pruebas contra la producción real**, incluida la IA verdadera.

## C–I. Entregables

| | Entregable | Archivo |
|---|---|---|
| C | Inventario funcional: cada función, estado original, problema, solución, prueba y estado final | [`inventario-funcional.md`](inventario-funcional.md) |
| D | Diseño: dirección, sistema de diseño, decisiones, accesibilidad | [`diseno.md`](diseno.md) |
| E | QA: pruebas ejecutadas y resultados, matriz de cobertura, defectos corregidos | [`qa.md`](qa.md) · auditoría UI/UX: [`auditoria-ui/INFORME.md`](auditoria-ui/INFORME.md) |
| F | Rendimiento: metodología, antes/después, producción vs. original | [`rendimiento.md`](rendimiento.md) (§10 = producción) |
| G | Seguridad: hallazgos, explotación, correcciones y estado | [`seguridad/INFORME.md`](seguridad/INFORME.md) (tabla final al pie) |
| H | Documentación técnica: arquitectura, variables, migraciones, despliegue, backups, restauración, rollback, retención | [`../ARQUITECTURA.md`](../ARQUITECTURA.md), [`../OPERACION.md`](../OPERACION.md), [`../../README.md`](../../README.md) |
| I | Evidencia visual de producción (375 y 1440 px) | [`evidencia-final/`](evidencia-final/) · antes/después de cada corrección: [`auditoria-ui/correcciones/`](auditoria-ui/correcciones/) · exploración completa: [`auditoria-ui/evidencia/`](auditoria-ui/evidencia/) |

Capturas de `evidencia-final/`. Se tomaron de producción con un espacio de prueba que se borró al terminar. Los
alumnos de prueba conversaron con el tutor real.

| Archivo | Pantalla |
|---|---|
| `01-portada-*` | Portada |
| `02-inicio-*` | Inicio del docente |
| `03-aula-*` | Aula |
| `04-aula-alumnos-por-actividad-375` | Alumnos filtrados por actividad |
| `05-actividad-configuracion-*` | Configuración de la actividad |
| `06-actividad-compartir-375` | Enlace y QR |
| `07-alumno-entrada-375` | Alumno: entrada con su nombre |
| `08-alumno-chat-375` | Alumno: charla con el tutor (respuesta real de la IA) |
| `09-en-vivo-*` | En vivo, con alertas detectadas por IA |
| `10-trabajo-recorrido-*` | Recorrido del alumno con "Descargar PDF del recorrido" |
| `11-trabajo-conversacion-375` | Conversación |
| `12-mis-tutores-*` | Mis tutores (precargados) |
| `13-crear-con-ia-375` | Crear con IA |
| `14-mis-materiales-1440` | Mis materiales |
| `15-mi-espacio-375` | Mi espacio |
| `16-privacidad-375` | Privacidad |

## J. Estado final

| Área | Estado | Evidencia |
|---|---|---|
| Frontend | ✅ Completo | React 19 + TanStack Router/Query + Tailwind v4; chunk de entrada de 17 KB gz; build sin errores |
| Backend | ✅ Completo | API Hono con validación zod en todos los endpoints; 161 tests de integración contra Postgres real |
| Base de datos | ✅ Completa | PostgreSQL 17 propio, 2 migraciones versionadas, índices medidos con `EXPLAIN`, backups diarios, restauración documentada |
| Diseño responsive | ✅ Completo | Auditado en 320 / 375 / 390 / 430 / 768 / 1024 / 1440 px; en producción, 61/61 pantallas (375 y 1440 px, con datos y vacías) sin violaciones de axe ni desborde horizontal; Lighthouse accesibilidad 1,00 |
| Funcionalidades | ✅ Completas | Inventario: todas en "Funciona", salvo la voz (depende del navegador, documentado); los 8 pedidos del WhatsApp probados de punta a punta |
| Contenido verificado | ✅ Completo | Afirmaciones falsas eliminadas; el ejemplo de la portada está rotulado como ilustrativo; página de privacidad con lo que realmente se guarda y quién lo procesa (Anthropic, Cloudflare y el servicio de voz del navegador) |
| Seguridad | ✅ Corregida | 11 corregidos, 1 mitigado (F-07), 4 aceptados con justificación; cabeceras y CSRF verificados en producción |
| QA | ✅ Completo | 235/235 tests, E2E 8/8 local y en producción, IA real 17/17 en producción, 40/40 defectos de UI corregidos |
| Rendimiento | ✅ Medido | Lighthouse en producción: 0,97–0,98; LCP ~2,1 s (original: 6,6–17,9 s); JS −75 % a −94 % |
| Despliegue | ✅ En producción | Coolify con autodeploy desde GitHub, health check, HTTPS, rollback documentado |

## Limitaciones reales (no ocultas)

- **Voz:** el dictado y la lectura en voz alta usan el motor del navegador (decisión tomada). Funcionan bien en
  Chrome, Edge y Safari. En Firefox no hay dictado, y en ese caso la app oculta el botón en vez de mostrar uno que no
  anda.
- **Una sola instancia:** los límites de frecuencia y el aviso en vivo viven en la memoria del proceso. Alcanza de
  sobra para el uso previsto. Para correr varias réplicas habría que moverlos a Postgres o Redis (documentado en
  `ARQUITECTURA.md`).
- **Backups:** Coolify los hace a diario en el mismo VPS. Si se pierde el VPS, se pierden también los backups.
  Recomendación: activar el destino S3 de Coolify (cualquier S3 compatible) para una copia fuera del servidor.
- **Identidad de los alumnos:** como los alumnos no tienen cuenta (a propósito, son menores), alguien que conoce el
  enlace podría entrar con el nombre de un compañero que todavía no empezó. Para que el docente lo detecte, la app
  marca esos ingresos (F-07).
- **Uso real:** todavía no hay docentes ni alumnos reales. Las mediciones son de laboratorio y de producción con
  datos de prueba. Cloudflare Web Analytics va a dar las métricas de uso real cuando haya tráfico.
- **Correo:** la app no envía correos. Para recuperar la cuenta se usa el código de recuperación que se muestra al
  crearla.
