# Informe de rendimiento — Aula Socrática

Fecha de las mediciones: 21/10/2026 · Rama: `worktree-agent-a81c7fbdb58ede1c7` · Línea de base: commit `d76a2ee`
(código de la reconstrucción tal como estaba + herramientas de medición) · Después: `HEAD` de la rama.

> **Todo lo que sigue son datos de laboratorio (sintéticos).** No hay datos de usuarios reales (RUM / CrUX): la app
> todavía no tiene tráfico ni instrumentación de campo. Los números sirven para comparar antes/después en la misma
> máquina, no para predecir la experiencia exacta de un alumno con un celular de gama baja en la red de la escuela.

## 1. Resumen

| Qué | Antes | Después | Variación |
|---|---|---|---|
| Página del alumno (`/clase/<token>`, chat) — LCP móvil | 3.508 ms | 2.898 ms | −17,4 % |
| Página del alumno — FCP | 2.744 ms | 1.807 ms | −34,2 % |
| Página del alumno — JS transferido | 170,5 KB | 141,9 KB | −16,8 % |
| Página del alumno — puntaje Performance | 85 | 94 | +9 pts |
| Inicio público `/` — LCP | 2.953 ms | 2.554 ms | −13,5 % |
| Páginas del docente — LCP | 3.746–4.404 ms | 3.314–4.083 ms | −7 % a −12 % |
| Páginas del docente — FCP | 2.444–2.679 ms | 1.859–1.937 ms | −24 % a −28 % |
| INP de laboratorio, vista en vivo (mediana de 10) | 208 ms | 168 ms | −19,2 % |
| INP de laboratorio, aula (mediana de 10) | 152 ms | 112 ms | −26,3 % |
| API, throughput con 50 clientes y 10 endpoints | 299 req/s | 488 req/s | +63,2 % |
| API `/api/dashboard` p50 / p99 (10 clientes) | 78 / 111 ms | 35 / 55 ms | −55 % / −51 % |
| API `/api/live/:id` p50 / p99 (10 clientes) | 85 / 119 ms | 55 / 78 ms | −36 % / −34 % |
| API `/api/s/:token` (alumno) p50 / p99 (10 clientes) | 20 / 33 ms | 13 / 23 ms | −35 % / −30 % |
| Tiempo de base de datos por pedido del inicio docente | 32,4 ms | 7,8 ms | −76 % |
| Chunk de entrada `index-*.js` (minificado / Brotli) | 163,6 / 41,9 KB | 45,4 / 13,6 KB | −72 % / −68 % |

Contra el prototipo original (Lovable): el inicio público pasó de LCP 6,56 s a 2,55 s (−61 %) y de 684 KB a 110 KB de
JS; un enlace de alumno, de LCP 17,9 s a 2,86 s (−84 %) y de 2,68 MB a 142 KB de JS (sección 4).

Lo que **no** mejoró o empeoró, con su explicación en la sección 6: el TBT de dos páginas del docente subió (la suma
de todas las tareas largas bajó, pero el FCP llegó ~700 ms antes y la ventana FCP→TTI que mide el TBT incluye ahora
tareas que antes quedaban afuera); el INP del chat del alumno no cambió de forma significativa (64 → 80 ms, dentro de
la granularidad de 8 ms de Event Timing; ya estaba en rango "bueno").

## 2. Metodología

### 2.1 Entorno

| | |
|---|---|
| Máquina | Intel Core i9-12900F (24 hilos), 34 GB RAM |
| Sistema | Windows 11 Pro 10.0.26200; Docker Engine 29.5.3 sobre WSL2 (kernel 6.18) |
| Base de datos | PostgreSQL 17.10 (Alpine) en el contenedor `aulasocratica-pg`, base propia `aula_perf`, configuración por defecto (shared_buffers 128 MB, work_mem 4 MB) |
| Servidor | Build de producción (`npm run build` → `node dist/server/index.mjs`), Node v22.22.0, `NODE_ENV=production`, puerto 4500, pool de 10 conexiones, logs `info` a archivo |
| IA | Simulador local `scripts/dev/fake-claude.mjs` (puerto 47998); no se midió la latencia real de Claude |
| Navegador | Google Chrome 155.0.8059.80 (headless), Lighthouse 13.5.0, Playwright 1.64.1 |
| Cliente/servidor/DB | Los tres en la misma máquina: no hay latencia de red real hasta la base ni TLS; HTTP/1.1 |

### 2.2 Datos (`scripts/bench/seed.mjs`, reproducible)

Generador determinista (PRNG con semilla fija: mismos ids, nombres y textos en cada corrida; fechas relativas a
"ahora"). Recrea el esquema desde las migraciones del checkout que se mide (la corrida "antes" no tiene los índices
nuevos) y carga:

- Espacio principal: 30 aulas (2 archivadas), 900 alumnos, 120 actividades (15 borradores), **3.000 sesiones,
  58.678 mensajes, 120.658 eventos pedagógicos, 1.807 alertas**, rúbricas, radiografías y resúmenes. Material de
  lectura de 2.000–9.000 caracteres por actividad (el editor admite 20.000). Una actividad "en vivo" con 29 alumnos
  trabajando en los últimos minutos.
- 9 espacios más con 1/3 de ese volumen cada uno (tablas multi-espacio): en total 12.000 sesiones, 235.288 mensajes,
  481.218 eventos, 7.201 alertas; 227 MB.

### 2.3 Qué se midió y cómo

Todo con `bash scripts/bench/run-suite.sh <label> 5`: seed → servidor nuevo (con `scripts/bench/mem-probe.mjs`) →
Lighthouse → INP → API. "Antes" se corrió sobre una copia del commit `d76a2ee` construida aparte (mismo
`node_modules`, mismas herramientas de medición); "después", sobre `HEAD`. Misma máquina, una después de la otra, sin
otras cargas pesadas.

| Medición | Herramienta | Configuración |
|---|---|---|
| LCP, FCP, CLS, TBT, Speed Index, TTI, TTFB, bytes, requests | `scripts/bench/lighthouse-pages.mjs` | Lighthouse móvil por defecto: Moto G Power, throttling **simulado** (150 ms RTT, 1,6 Mbps, CPU 4×). 8 páginas × **5 corridas**, Chrome nuevo en cada corrida (**caché fría**). Se informa la mediana. Páginas con sesión: cookie por `extraHeaders`. |
| INP de laboratorio | `scripts/bench/inp.mjs` + `inp-compare.sh` + `inp-aggregate.mjs` | Playwright con Chrome, 412×823, CPU 4× por CDP, sin throttling de red. Event Timing (`PerformanceObserver` tipo `event`, umbral 16 ms): INP = interacción más lenta de la corrida. Por la variabilidad, la comparación principal alterna bloques A/B/A/B (seed y servidor nuevos en cada bloque), **10 corridas por build y escenario**. |
| Tareas largas completas | `scripts/bench/long-tasks.mjs` | Mismo perfil de Lighthouse, 5 corridas: suma del bloqueo (duración − 50 ms) de **todas** las tareas largas, no solo las de la ventana FCP→TTI. |
| API p50/p95/p99 | `scripts/bench/api-suite.mjs` | Aislado: cada endpoint solo, 10 clientes concurrentes, 2 s de calentamiento + 10 s. Mixto: los 10 endpoints en ronda, 50 clientes, 30 s. Reconstrucción de informes y PDF: secuenciales. |
| Memoria y event loop | `scripts/bench/mem-probe.mjs` | `process.memoryUsage()` y `monitorEventLoopDelay` cada 1 s dentro del servidor (`node --import`), sin tocar el código de la app. |
| Consultas | `log_min_duration_statement = 0` en `aula_perf` (solo mientras se capturaba) + `EXPLAIN (ANALYZE, BUFFERS)` | Las consultas reales que emite Drizzle para cada endpoint, con sus parámetros. `docs/benchmarks/explain-*.txt`. |
| CPU del servidor | `node:inspector` (perfil de muestreo) | Carga mixta (20 clientes) y solo `/api/live/:id` (10 clientes). `docs/benchmarks/cpu-profile-*.txt`. |
| Bundles | `scripts/bench/vite-analyze.config.ts` + `bundle-report.mjs` | Módulos por chunk y, por ruta, el JS de una primera visita (entry + chunk + imports estáticos), mínimo y Brotli q11. |

Resultados crudos: `docs/benchmarks/{lighthouse,inp,api,bundle,long-tasks}-{before,after}.json`,
`inp-{before,after}-{1,2}.json` y `-pooled.json`, `explain-before.txt`, `explain-after.txt`, `explain-reports-after.txt`,
`cpu-profile-{before,after}.txt`, `regex-tutorquestion.txt`, `reports-refresh-abab.txt`. Tablas:
`node scripts/bench/compare.mjs before after`.

## 3. Resultados: antes y después

### 3.1 Resumen por página (Lighthouse móvil, mediana de 5 corridas)

| Página | LCP | FCP | TBT | CLS | JS transferido | Peso total | Requests |
|---|---|---|---|---|---|---|---|
| Inicio público `/` (prerenderizado) | 2.953 → 2.554 ms (−13,5 %) | 2.496 → 2.404 ms (−3,7 %) | 15 → 3 ms | 0 → 0 | 138,4 → 110,1 KB (−20,5 %) | 257,9 → 230,9 KB (−10,5 %) | 15 → 14 |
| `/ingresar` | 3.358 → 3.099 ms (−7,7 %) | 2.806 → 1.996 ms (−28,9 %) | 41 → 29 ms | 0 → 0 | 188,4 → 169,7 KB (−9,9 %) | 305,0 → 286,6 KB (−6,0 %) | 31 → 33 |
| `/clase/<token inexistente>` | 3.449 → 2.855 ms (−17,2 %) | 2.730 → 1.807 ms (−33,8 %) | 48 → 37 ms | 0,000 → 0,006 | 170,5 → 141,9 KB (−16,8 %) | 287,2 → 258,9 KB (−9,9 %) | 30 → 30 |
| `/clase/<token>` (ingreso del alumno) | 3.463 → 2.866 ms (−17,2 %) | 2.733 → 1.850 ms (−32,3 %) | 58 → 42 ms | 0,001 → 0 | 170,5 → 141,9 KB (−16,8 %) | 287,3 → 259,0 KB (−9,8 %) | 30 → 30 |
| `/clase/<token>` (chat, cookie del alumno) | 3.508 → 2.898 ms (−17,4 %) | 2.744 → 1.807 ms (−34,2 %) | 156 → 62 ms | 0 → 0 | 170,5 → 141,9 KB (−16,8 %) | 289,8 → 261,5 KB (−9,8 %) | 30 → 30 |
| `/app` (inicio docente) | 3.746 → 3.314 ms (−11,5 %) | 2.444 → 1.859 ms (−23,9 %) | 47 → 67 ms | 0,010 → 0,010 | 189,1 → 170,4 KB (−9,9 %) | 308,4 → 290,1 KB (−5,9 %) | 45 → 47 |
| `/app/aulas/<id>` | 4.074 → 3.628 ms (−11,0 %) | 2.527 → 1.910 ms (−24,4 %) | 70 → 128 ms | 0 → 0 | 210,9 → 192,2 KB (−8,8 %) | 338,7 → 320,3 KB (−5,4 %) | 52 → 54 |
| `/app/actividades/<id>?tab=en-vivo` | 4.404 → 4.083 ms (−7,3 %) | 2.679 → 1.937 ms (−27,7 %) | 210 → 352 ms | 0 → 0 | 251,6 → 254,6 KB (+1,2 %) | 383,1 → 386,4 KB (+0,9 %) | 63 → 66 |

Puntaje Performance: 91→94, 87→92, 87→94, 87→94, 85→94, 86→91, 83→87, 77→77. El TTFB del documento es 1–3 ms en
todos los casos (servidor local): no es un dato informativo en este entorno (ver 7).

### 3.2 Tabla Métrica | Antes | Después | Variación por página

#### Página del alumno — `/clase/<token>` con su cookie (chat)

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 3.508 ms | 2.898 ms | −17,4 % |
| FCP | 2.744 ms | 1.807 ms | −34,2 % |
| CLS | 0,000 | 0,000 | = |
| TBT | 156 ms | 62 ms | −59,9 % |
| INP de laboratorio (mediana / máx. de 10) | 64 / 80 ms | 80 / 88 ms | sin cambio significativo (±2 cuantos de 8 ms) |
| TTI | 3.525 ms | 3.051 ms | −13,5 % |
| TTFB (documento) | 1 ms | 1 ms | = |
| JS transferido | 170,5 KB | 141,9 KB | −16,8 % |
| Peso total | 289,8 KB | 261,5 KB | −9,8 % |
| Requests | 30 | 30 | = |
| Trabajo del hilo principal | 918 ms | 543 ms | −40,9 % |
| API `/api/s/<token>` p50 / p95 / p99 (10 clientes) | 20 / 27 / 33 ms | 13 / 19 / 23 ms | −35 % / −28 % / −30 % |

#### Inicio público — `/`

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 2.953 ms | 2.554 ms | −13,5 % |
| FCP | 2.496 ms | 2.404 ms | −3,7 % |
| CLS | 0,000 | 0,000 | = |
| TBT | 15 ms | 3 ms | −83,3 % |
| TTFB (documento) | 1 ms | 3 ms | +2 ms (Brotli del HTML con CSS en línea en cada pedido) |
| JS transferido | 138,4 KB | 110,1 KB | −20,5 % |
| CSS transferido | 10,6 KB | 0 (en línea) | — |
| Peso total | 257,9 KB | 230,9 KB | −10,5 % |
| Requests | 15 | 14 | −6,7 % |

#### `/ingresar`

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 3.358 ms | 3.099 ms | −7,7 % |
| FCP | 2.806 ms | 1.996 ms | −28,9 % |
| CLS | 0,000 | 0,000 | = |
| TBT | 41 ms | 29 ms | −28,4 % |
| TTFB (documento) | 1 ms | 2 ms | +1 ms |
| JS transferido | 188,4 KB | 169,7 KB | −9,9 % |
| Peso total | 305,0 KB | 286,6 KB | −6,0 % |
| Requests | 31 | 33 | +2 |

#### `/clase/<token inexistente>` y `/clase/<token>` sin cookie (ingreso)

| Métrica | Antes (inexistente / ingreso) | Después (inexistente / ingreso) | Variación |
|---|---|---|---|
| LCP | 3.449 / 3.463 ms | 2.855 / 2.866 ms | −17,2 % / −17,2 % |
| FCP | 2.730 / 2.733 ms | 1.807 / 1.850 ms | −33,8 % / −32,3 % |
| CLS | 0,000 / 0,001 | 0,006 / 0,000 | dentro del ruido (cambio de fuente; < 0,1) |
| TBT | 48 / 58 ms | 37 / 42 ms | −22,9 % / −27,0 % |
| JS transferido | 170,5 KB | 141,9 KB | −16,8 % |
| Peso total | 287,2 / 287,3 KB | 258,9 / 259,0 KB | −9,9 % |
| Requests | 30 | 30 | = |

#### `/app` (inicio docente)

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 3.746 ms | 3.314 ms | −11,5 % |
| FCP | 2.444 ms | 1.859 ms | −23,9 % |
| CLS | 0,010 | 0,010 | = |
| TBT (FCP→TTI) | 47 ms | 67 ms | +44,1 % (ver 6.1) |
| Bloqueo de todas las tareas largas | 78 ms | 54 ms | −30,8 % |
| INP | — (sin escenario) | — | — |
| JS transferido | 189,1 KB | 170,4 KB | −9,9 % |
| Peso total | 308,4 KB | 290,1 KB | −5,9 % |
| Requests | 45 | 47 | +2 |
| API `/api/dashboard` p50 / p95 / p99 | 78 / 99 / 111 ms | 35 / 48 / 55 ms | −55 % / −52 % / −51 % |

#### `/app/aulas/<id>`

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 4.074 ms | 3.628 ms | −11,0 % |
| FCP | 2.527 ms | 1.910 ms | −24,4 % |
| CLS | 0,000 | 0,000 | = |
| TBT (FCP→TTI) | 70 ms | 128 ms | +82,9 % (ver 6.1) |
| Bloqueo de todas las tareas largas | 110 ms | 92 ms | −16,4 % |
| INP de laboratorio (mediana / máx. de 10) | 152 / 256 ms | 112 / 160 ms | −26,3 % / −37,5 % |
| JS transferido | 210,9 KB | 192,2 KB | −8,8 % |
| Peso total | 338,7 KB | 320,3 KB | −5,4 % |
| Requests | 52 | 54 | +2 |
| API `/api/classrooms/<id>/activities` p50 / p99 | 17 / 27 ms | 10 / 16 ms | −41 % / −40 % |

#### `/app/actividades/<id>?tab=en-vivo`

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| LCP | 4.404 ms | 4.083 ms | −7,3 % |
| FCP | 2.679 ms | 1.937 ms | −27,7 % |
| CLS | 0,000 | 0,000 | = |
| TBT (FCP→TTI) | 210 ms | 352 ms | +68,0 % (ver 6.1) |
| Bloqueo de todas las tareas largas | 436 ms | 296 ms | −32,1 % |
| INP de laboratorio (mediana / máx. de 10) | 208 / 288 ms | 168 / 200 ms | −19,2 % / −30,6 % |
| JS transferido | 251,6 KB | 254,6 KB | +1,2 % |
| Peso total | 383,1 KB | 386,4 KB | +0,9 % |
| Requests | 63 | 66 | +3 |
| API `/api/live/<id>` p50 / p95 / p99 | 85 / 103 / 119 ms | 55 / 71 / 78 ms | −36 % / −31 % / −34 % |

### 3.3 INP de laboratorio

Bloques alternados antes/después/antes/después; 10 corridas por build y escenario (mediana = valor 5 de 10).

| Escenario | Antes (mediana / p75 / máx.) | Después (mediana / p75 / máx.) | Variación de la mediana |
|---|---|---|---|
| Chat del alumno: escribir 60 caracteres, enviar (respuesta del simulador), escribir | 64 / 80 / 80 ms | 80 / 88 / 88 ms | sin cambio significativo |
| En vivo: 8 clics en los filtros de alumnos, pestañas del mapa de calor, Configuración ↔ En vivo | 208 / 240 / 288 ms | 168 / 184 / 200 ms | −19,2 % |
| Aula: 5 cambios de pestaña (Alumnos, Alertas, Actividades) | 152 / 168 / 256 ms | 112 / 136 / 160 ms | −26,3 % |

La corrida de 3 repeticiones de la suite dio 88→48, 256→312 y 152→176 ms: con 3 corridas el ruido supera a la
diferencia, por eso se agregó la comparación alternada.

### 3.4 Tareas largas de toda la carga (Lighthouse, mediana de 5)

| Página | TBT (FCP→TTI) | Bloqueo de todas las tareas largas | Suma de las tareas largas | FCP |
|---|---|---|---|---|
| `/app` | 56 → 54 ms | 78 → 54 ms (−30,8 %) | 278 → 154 ms (−44,6 %) | 2.443 → 1.856 ms |
| `/app/aulas/<id>` | 69 → 92 ms | 110 → 92 ms (−16,4 %) | 310 → 242 ms (−21,9 %) | 2.527 → 1.904 ms |
| `/app/actividades/<id>?tab=en-vivo` | 241 → 283 ms | 436 → 296 ms (−32,1 %) | 736 → 496 ms (−32,6 %) | 2.683 → 1.873 ms |
| `/clase/<token>` (chat) | 157 → 68 ms | 187 → 79 ms (−57,8 %) | 337 → 179 ms (−46,9 %) | 2.733 → 1.848 ms |

### 3.5 API bajo concurrencia

Aislado (10 clientes, 10 s por endpoint):

| Endpoint | Respuesta | p50 | p95 | p99 | req/s |
|---|---|---|---|---|---|
| `/api/auth/me` | 0,2 KB | 8 → 6 ms (−26,5 %) | 12 → 9 ms | 14 → 11 ms | 1.164 → 1.572 (+35,1 %) |
| `/api/dashboard` | 5,2 KB | 78 → 35 ms (−55,0 %) | 99 → 48 ms | 111 → 55 ms | 127 → 278 (+118,9 %) |
| `/api/classrooms` | 9,3 KB | 14 → 12 ms (−13,8 %) | 18 → 17 ms | 21 → 20 ms | 714 → 815 (+14,1 %) |
| `/api/classrooms/<id>/activities` | 1,7 KB | 17 → 10 ms (−40,6 %) | 23 → 14 ms | 27 → 16 ms | 586 → 985 (+68,1 %) |
| `/api/classrooms/<id>/students` | 31,4 KB | 19 → 17 ms (−6,5 %) | 24 → 24 ms | 30 → 28 ms | 526 → 556 (+5,7 %) |
| `/api/activities/<id>` | 7,8 KB | 17 → 15 ms (−12,0 %) | 23 → 21 ms | 27 → 26 ms | 579 → 650 (+12,3 %) |
| `/api/live/<id>?window=30m` | 47,5 KB | 85 → 55 ms (−35,5 %) | 103 → 71 ms | 119 → 78 ms | 117 → 178 (+52,1 %) |
| `/api/sessions/<id>` | 14,1 KB | 29 → 25 ms (−15,0 %) | 38 → 34 ms | 42 → 41 ms | 333 → 388 (+16,5 %) |
| `/api/sessions?view=radiografia` | 16,4 KB | 30 → 23 ms (−22,8 %) | 46 → 33 ms | 59 → 42 ms | 315 → 413 (+31,1 %) |
| `/api/s/<token>` (alumno) | 12,6 KB | 20 → 13 ms (−35,4 %) | 27 → 19 ms | 33 → 23 ms | 487 → 739 (+51,7 %) |

Mixto (50 clientes, 30 s, los 10 endpoints en ronda): **299 → 488 req/s (+63,2 %)**.

| Endpoint | p50 | p95 | p99 |
|---|---|---|---|
| `/api/auth/me` | 119 → 62 ms (−47,5 %) | 154 → 90 ms | 176 → 101 ms |
| `/api/dashboard` | 118 → 73 ms (−37,7 %) | 158 → 102 ms | 184 → 119 ms |
| `/api/classrooms` | 104 → 64 ms (−38,6 %) | 141 → 91 ms | 164 → 108 ms |
| `/api/classrooms/<id>/activities` | 166 → 95 ms (−42,9 %) | 200 → 125 ms | 221 → 141 ms |
| `/api/classrooms/<id>/students` | 212 → 129 ms (−39,1 %) | 262 → 167 ms | 307 → 190 ms |
| `/api/activities/<id>` | 214 → 128 ms (−40,0 %) | 264 → 167 ms | 308 → 182 ms |
| `/api/live/<id>?window=30m` | 228 → 135 ms (−41,0 %) | 285 → 171 ms | 324 → 191 ms |
| `/api/sessions/<id>` | 157 → 92 ms (−41,3 %) | 194 → 124 ms | 219 → 139 ms |
| `/api/sessions?view=radiografia` | 120 → 105 ms (−12,2 %) | 155 → 139 ms | 179 → 155 ms |
| `/api/s/<token>` | 217 → 121 ms (−44,6 %) | 266 → 159 ms | 294 → 177 ms |

Operaciones pesadas (secuenciales): reconstruir el informe general 150/146 → 140/139 ms y el de un aula 47/48 →
45/24 ms (bloques alternados, `reports-refresh-abab.txt`); PDF del recorrido 15 → 15 ms. La corrida única de la suite
había dado 126 → 167 ms y 25 → 47 ms para los informes: al alternar builds no se reproduce (la reconstrucción tiene un
comportamiento bimodal de ~25 o ~45 ms en ambos builds).

### 3.6 Memoria y event loop (proceso Node)

| Métrica | Antes | Después | Variación |
|---|---|---|---|
| RSS máx. en reposo | 116 MB | 118 MB | +1,7 % |
| Heap usado máx. en reposo | 36 MB | 38 MB | +5,6 % |
| RSS máx. con carga aislada | 278 MB | 267 MB | −4,0 % |
| Heap usado máx. / promedio con carga aislada | 162 / 76 MB | 143 / 58 MB | −11,7 % / −23,7 % |
| RSS máx. con carga mixta (50 clientes) | 284 MB | 289 MB | +1,8 % |
| Heap usado máx. / promedio con carga mixta | 165 / 103 MB | 159 / 102 MB | −3,6 % / −1,0 % |
| Retraso del event loop p99 máx. (aislada / mixta) | 19,9 / 19,3 ms | 17,8 / 16,5 ms | −10,6 % / −14,5 % |

La memoria pico casi no cambia (el pico lo marca la concurrencia: 50 respuestas en vuelo); el heap promedio baja
porque se leen menos columnas y menos objetos por pedido. Nota: la resolución del monitor de event loop es 10 ms.

### 3.7 Bundles

| | Antes (mín. / Brotli) | Después (mín. / Brotli) | Variación Brotli |
|---|---|---|---|
| Chunk de entrada `index-*.js` | 163,6 / 41,9 KB | 45,4 / 13,6 KB | −67,7 % |
| Entry + react + tanstack (toda página lo descarga) | 487,9 / 131,4 KB | 369,7 / 103,0 KB | −21,6 % |
| Primera visita a `/clase/<token>` | 568,8 / 157,1 KB | 449,7 / 128,5 KB | −18,2 % |
| Primera visita a `/` | 497,2 / 134,4 KB | 379,0 / 106,0 KB | −21,1 % |
| Primera visita a `/app` (sin sonner, que llega después) | 584,3 / 163,1 KB | 498,9 / 142,9 KB | −12,4 % |
| Primera visita a `/app/actividades/<id>` | 752,4 / 210,0 KB | 751,8 / 210,9 KB | +0,4 % |

El resto de las rutas, en `docs/benchmarks/bundle-{before,after}.json` (las que usan formularios con zod quedan
igual: zod se mudó del entry a un chunk compartido que esas páginas igual necesitan).

## 4. Comparación con el prototipo original

Mismo script (`lighthouse.mjs`, mismo perfil móvil) y misma máquina; el original corría en `:4100`
(`docs/benchmarks/lighthouse-original-local.json`, 3 corridas; la reconstrucción, 5).

| Página | Métrica | Original (Lovable) | Reconstrucción, antes | Reconstrucción, después | Después vs original |
|---|---|---|---|---|---|
| Inicio público `/` | Puntaje | 62 | 91 | 94 | +32 pts |
| | LCP | 6.563 ms | 2.953 ms | 2.554 ms | −61,1 % |
| | FCP | 6.114 ms | 2.496 ms | 2.404 ms | −60,7 % |
| | TBT | 0 ms | 15 ms | 3 ms | +3 ms |
| | CLS | 0 | 0 | 0 | = |
| | JS transferido | 683,8 KB | 138,4 KB | 110,1 KB | −83,9 % |
| | Peso total | 939,2 KB | 257,9 KB | 230,9 KB | −75,4 % |
| | Requests | 33 | 15 | 14 | −57,6 % |
| Ingreso (`/auth` → `/ingresar`) | Puntaje | 61 | 87 | 92 | +31 pts |
| | LCP | 6.791 ms | 3.358 ms | 3.099 ms | −54,4 % |
| | FCP | 6.174 ms | 2.806 ms | 1.996 ms | −67,7 % |
| | TBT | 0 ms | 41 ms | 29 ms | +29 ms |
| | CLS | 0 | 0 | 0 | = |
| | JS transferido | 711,5 KB | 188,4 KB | 169,7 KB | −76,2 % |
| | Peso total | 966,3 KB | 305,0 KB | 286,6 KB | −70,3 % |
| | Requests | 35 | 31 | 33 | −5,7 % |
| Enlace de alumno inexistente | Puntaje | 55 | 87 | 94 | +39 pts |
| | LCP | 17.915 ms | 3.449 ms | 2.855 ms | −84,1 % |
| | FCP | 13.467 ms | 2.730 ms | 1.807 ms | −86,6 % |
| | TBT | 100 ms | 48 ms | 37 ms | −62,8 % |
| | CLS | 0 | 0 | 0,006 | ≈ |
| | JS transferido | 2.683,3 KB | 170,5 KB | 141,9 KB | −94,7 % |
| | Peso total | 2.934,5 KB | 287,2 KB | 258,9 KB | −91,2 % |
| | Requests | 75 | 30 | 30 | −60,0 % |

El TBT de 0 ms del original en el inicio y el ingreso no es una virtud: el original pinta todo tarde (FCP > 6 s) y el
TBT solo mide entre FCP y TTI.

## 5. Cuellos de botella encontrados (con evidencia)

### 5.1 El chunk de entrada llevaba zod, sonner y tailwind-merge a todas las páginas

Análisis del build original (`bundle-before.json`): `index-*.js` = 163,6 KB minificado; tamaño renderizado de sus
módulos: **zod 163 KB**, tailwind-merge 57 KB, **sonner 53 KB**, código propio ~25 KB.
- zod entraba por `validateSearch: z.object(...)` en 8 rutas: las opciones de ruta no se dividen con
  `autoCodeSplitting`, quedan en el entry. Además `contracts/student.ts` se importaba en la página del alumno solo por
  4 constantes; como el módulo crea esquemas zod al cargarse, arrastraba zod entero.
- sonner entraba porque `__root.tsx` montaba `<Toaster>`; el inicio público, la página del alumno y privacidad nunca
  muestran avisos.
- tailwind-merge sí se usa en el primer render (Button, Spinner): se dejó.

### 5.2 La SPA cargaba en cascada

Trazas de Lighthouse de `/clase/<token>` y `/app/aulas/<id>`: HTML → entry (+react, tanstack) → recién cuando el
router corre, el chunk de la ruta y sus imports → recién cuando el componente monta, `/api/auth/me` o `/api/s/:token`
→ en las páginas del docente, después de `me`, las consultas de la página (en el aula, 4 más). Cada eslabón suma un
RTT (150 ms en el perfil móvil) y espera al anterior.

### 5.3 Fuentes descubiertas tarde y CSS bloqueante en el inicio

En el inicio, el LCP es el `<h1>` en Fraunces; las tres fuentes (101,6 KB) recién se piden cuando el CSS está
parseado y el texto maquetado (`network-dependency-tree`: HTML → CSS 10,6 KB → fuentes). Lighthouse marcaba el CSS
como bloqueante (~300 ms estimados). En la SPA, las fuentes se pedían recién al renderizar React.

### 5.4 Base de datos: costos que crecían con la base entera, no con el docente

`docs/benchmarks/explain-before.txt` (consultas reales con sus parámetros):
- **Inicio docente, alertas**: `Seq Scan on learning_sessions` (12.000 filas, todos los espacios) + `Hash` de 3.600
  alumnos y `Seq Scan on student_alerts` (7.201), para devolver 5 filas: 6,6 ms. El `LIMIT 5` se aplicaba después de
  unir todo.
- **Resúmenes de actividades** (inicio y lista del aula): 120 filas con **todas las columnas**, incluido el material de
  lectura (hasta 20.000 caracteres por actividad, ~660 KB en total en el seed): 5,8 ms en `EXPLAIN ANALYZE` y 12,3 ms
  en el log del servidor (que incluye enviar ese texto); 4 subconsultas por actividad con `Bitmap Heap Scan` y filtro
  por estado (1.947 buffers).
- **Radiografía**: `Hash Left Join` con **todos** los `thinking_analyses` de la base (2.623 filas con su JSON, 1,6 MB
  de hash) antes de ordenar y paginar 31 filas: 12,0 ms.
- Tiempo total de base de datos por pedido (suma de los tiempos registrados): inicio docente 32,4 ms; radiografía
  11,6 ms; aulas 4,3 ms.
- Además, Drizzle no usa sentencias preparadas: cada consulta se parsea y planifica en cada pedido (fases `parse` +
  `bind` de 0,2–1,7 ms en el log del servidor para consultas de una fila, como la sesión del docente o el recurso
  propio).
- Verificado y **no** era problema: el middleware de sesión escribe en la base a lo sumo una vez por hora (no por
  pedido); la vista en vivo ya leía todo en bloque (sin N+1); los assets estáticos van precomprimidos y con
  `immutable`.

### 5.5 CPU del servidor: la vista en vivo

Perfil de muestreo con solo `/api/live/:id` (10 clientes; `cpu-profile-before.txt`): 86 req/s, p50 113 ms, 4,6 %
ocioso (limitado por CPU, no por la base, que tardaba ~1 ms). Por función:
- `participants.sort(... localeCompare(..., "es", { sensitivity: "base" }))`: **6,0 %** (crea un collator ICU por
  comparación).
- `tutorQuestion` (regex de la última pregunta del tutor): **6,5 %**. La regex `/[^.!?¿¡]*¿?[^.!?¿¡]*\?/g` tiene dos
  cuantificadores iguales seguidos y retrocede de forma cúbica en cada oración que no termina en "?": 94,5 µs por
  respuesta típica, 17 ms para una oración de 400 caracteres (`regex-tutorquestion.txt`). La misma función recorre
  todas las respuestas del tutor en el recorrido y la radiografía de cada trabajo.
- `lastAt` + `lastSignalAt` + `activityBuckets`: **14,4 %**. Cada evento se convertía de `Date` a texto ISO y las
  reglas lo volvían a parsear (decenas de veces por alumno).
- Mapeo de filas de Drizzle (`is`, `mapFromDriverValue` de timestamps): ~17 %, sobre todo por los ~1.200 eventos de
  la actividad.

En carga mixta (`cpu-profile-before.txt`), además, la compresión: `hono/compress` pasaba **todas** las respuestas JSON
(incluso de 40 bytes) por un `CompressionStream` en el hilo principal. Medido aparte con esa compresión (10 clientes,
8 s, dos veces cada una): el listado de alumnos de un aula (31 KB) daba 558–559 req/s con `Accept-Encoding: identity`
y 496–504 req/s con gzip (−10 %); la vista en vivo (48 KB), 161–173 contra 158–169 req/s (−2 %).

### 5.6 Interacciones del docente

`PerformanceObserver('long-animation-frame')` sobre la vista en vivo (CPU 4×): un clic en un filtro de alumnos
costaba 71–129 ms de script y cambiar de pestaña 140–181 ms; además, cada 5 s el reloj del panel re-renderizaba todo
(~70 ms). Causas en el código: la página de la actividad leía la pestaña de la URL en el componente raíz del editor,
así que cada cambio de pestaña re-renderizaba la configuración, compartir y en vivo completos; la lista de alumnos
renderizaba **dos** diseños (tarjetas y tabla) y ocultaba uno con CSS; el mapa de calor se re-renderizaba con el
reloj aunque no depende de la hora. Lo mismo en el aula (pestañas Actividades/Alumnos/Alertas).

## 6. Cambios realizados y su efecto medido

| # | Cambio | Dónde | Efecto medido |
|---|---|---|---|
| 1 | `validateSearch` con validadores propios (mismas reglas que zod: claves desconocidas afuera, tipo incorrecto → pantalla de error; test de equivalencia contra zod) | `src/client/lib/search.ts`, 8 rutas | Entry 163,6 → 45,4 KB (zod fuera) |
| 2 | Límites del alumno en `contracts/student-limits.ts` (sin zod); `student.ts` los re-exporta | `src/shared/contracts`, `features/student` | La página del alumno ya no descarga zod: primera visita 157,1 → 128,5 KB Brotli (con #1 y #3) |
| 3 | `<Toaster>` de sonner cargado a demanda; no se monta en `/`, `/clase/*` ni `/privacidad`; sonner reproduce los avisos creados antes de montarse | `routes/__root.tsx`, `components/app/toaster.tsx` | sonner (33,5 KB) fuera del entry; JS transferido −16,8 % en la página del alumno, −20,5 % en el inicio |
| 4 | Inicio prerenderizado con el CSS en línea y sin preload de fuentes | `scripts/prerender.mjs` | Se elimina el request bloqueante de CSS; LCP del inicio 2.953 → 2.554 ms (con #1 y #3) |
| 5 | Preload de Fraunces y Figtree en el shell de la SPA | `scripts/vite-preloads.ts` | Experimento con 2 corridas: sin el preload, `/clase` (chat) FCP 2.801 / LCP 2.954 ms; con preload 2.407 / 2.883 ms |
| 6 | El servidor agrega `modulepreload` (prioridad baja) del JS de la ruta y `preload` de las primeras llamadas a la API según la URL (`/api/s/:token`, `/api/auth/me`, inicio, aula ×4, actividad, sesión) | `src/server/lib/html-hints.ts`, `app.ts`, `dist/route-preloads.json` | Verificado con Playwright: cada URL se pide una sola vez (el fetch usa el preload) y sin avisos de "preload no usado". Experimentos (2 corridas): sin modulepreload, LCP del aula 3.937 ms vs 3.633 ms con él; con prioridad normal el FCP empeoraba ~500 ms (aula 2.864 ms) y con `fetchpriority="low"` volvió a 1.855 ms manteniendo el LCP. Resultado final: FCP −24 % a −34 % y LCP −7 % a −17 % en todas las páginas de la SPA |
| 7 | Índices `learning_sessions(activity_id, status, last_activity_at)` y `student_alerts(activity_id, created_at) WHERE status = 'open'` | `schema.ts`, `drizzle/0001_perf_indexes.sql` | Conteos por actividad con `Index Only Scan` y `Heap Fetches: 0` (resúmenes: 5,8 → 1,8 ms y 1.947 → 1.125 buffers; conteos del inicio 3,4 → 1,6 ms; aulas 4,0 → 1,2 ms). Ocupan 952 kB + 200 kB |
| 8 | Resúmenes de actividades: solo las columnas del resumen | `routes/classrooms.ts` | Inicio y lista de actividades sin leer material/consigna/rúbrica |
| 9 | Inicio: las 5 alertas se eligen antes de unir sesión y alumno | `routes/dashboard.ts` | 6,6 → 1,9 ms; el join toca 5 filas (antes 12.000 + 3.600). Con #7 y #8: base de datos por pedido 32,4 → 7,8 ms; `/api/dashboard` p50 78 → 35 ms, 127 → 278 req/s |
| 10 | Radiografía: la x-ray se lee solo para la página | `services/sessions/lists.ts` | 12,0 ms → 6,8 + 0,13 ms; p50 30 → 23 ms, p99 59 → 42 ms |
| 11 | Vista en vivo: columnas justas; eventos como filas planas con la hora en ms (equivalencia con el mapeo de Drizzle verificada con 481.000 eventos y 200.000 timestamps con microsegundos); `Intl.Collator` reutilizado; `LiveEvent.at` opcional para no re-parsear fechas | `services/sessions/live-snapshot.ts`, `shared/domain/live-monitor.ts` | Perfil solo-en-vivo: 86 → 185 req/s, p50 113 → 53 ms. Suite: p50 85 → 55 ms, p99 119 → 78 ms |
| 12 | Regex de `tutorQuestion` sin retroceso cúbico (mismas coincidencias: test con 20.000 textos aleatorios) | `shared/domain/thinking-xray.ts` | 94,5 → 3,6 µs por respuesta típica; 17 ms → 0,13 ms para una oración de 400 caracteres |
| 13 | Sentencias preparadas para la sesión del docente, aula/actividad/sesión propias y enlace + dispositivo del alumno | `auth/teacher.ts`, `services/access.ts`, `services/student/session.ts` | Junto con #14: `/api/auth/me` 1.164 → 1.572 req/s; `/api/s/:token` 487 → 739 req/s |
| 14 | Compresión de JSON/HTML con `node:zlib` asíncrono (thread pool), Brotli q4 si se acepta, nada bajo 1 KB; `hono/compress` sigue para el resto y para SSE nunca | `src/server/lib/compress.ts` (+ tests) | Saca la compresión del event loop: throughput mixto +63 % (con el resto), event loop p99 19,3 → 16,5 ms |
| 15 | Pestañas de actividad y de aula: la URL se lee en un componente propio; los paneles llegan como elementos y React no los re-renderiza al cambiar de pestaña. Vista en vivo y `StudentsPanel` memoizados | `routes/app.actividades.$activityId.tsx`, `routes/app.aulas.$classroomId.tsx`, `features/*` | INP en vivo 208 → 168 ms, aula 152 → 112 ms (medianas de 10) |
| 16 | Lista de alumnos en vivo: solo el diseño visible (tarjetas o tabla, por `matchMedia`); mapa de calor memoizado (no depende del reloj de 5 s) | `features/live/live-panel.tsx`, `lib/media.ts` | Incluido en #15; el DOM de la lista se reduce a la mitad |
| 17 | `Tabs`: el panel activo primero, los ocultos se montan enseguida dentro de una transición (siguen montados; no se pierden ediciones). Vista en vivo: cada snapshot nuevo se renderiza con `useDeferredValue` | `components/ui/controls.tsx`, `live-panel.tsx` | Suma de tareas largas de la actividad 736 → 496 ms; bloqueo total 436 → 296 ms |
| 18 | Mensajes del chat memoizados (no se re-renderiza ni se vuelve a parsear el Markdown de toda la conversación por tecla ni por fragmento recibido) | `features/student/thread.tsx` | No medible con 28 mensajes: ni antes ni después hay cuadros > 50 ms al escribir (LoAF con CPU 4×). Queda como protección para conversaciones largas y para el streaming |

### 6.1 Por qué sube el TBT de dos páginas del docente

El TBT suma el bloqueo de las tareas largas **entre FCP y TTI**. Los cambios #5 y #6 adelantaron el FCP ~600–800 ms
(el spinner se pinta antes porque el entry pesa menos y ya no compite con el JS de la ruta), así que tareas que antes
caían **antes** del FCP ahora caen dentro de la ventana. La medición de todas las tareas largas de la carga (3.4)
muestra que el bloqueo total bajó en las cuatro páginas medidas (−16 % a −58 %) y el trabajo del hilo principal de
la página del alumno, −41 %. En la actividad sigue habiendo dos tareas de React de ~230 y ~150 ms simuladas (el
render inicial del editor y el de la vista en vivo cuando llegan los datos), que son la próxima oportunidad (6.2).

### 6.2 Compromisos y riesgos

- **Preloads según la URL**: si una página deja de pedir alguna de esas URLs, el navegador avisa "preload no usado"
  (solo consola, y se baja una respuesta de más). La lista vive en `src/server/lib/html-hints.ts`; los datos del
  docente se precargan solo si llega la cookie del espacio.
- **Brotli en JSON/HTML**: cambia la codificación que reciben los navegadores (transparente). Las respuestas < 1 KB ya
  no se comprimen. Con un proxy que recomprima (Cloudflare), no hay conflicto: la respuesta ya llega codificada.
- **Sentencias preparadas**: requieren conexión directa a Postgres o un pooler que las soporte. Si en el futuro se pone
  PgBouncer en modo transacción, habrá que habilitar `max_prepared_statements` (PgBouncer ≥ 1.21) o volver a consultas
  sin preparar en esos cuatro archivos.
- **Paneles ocultos montados en una transición**: aparecen en el DOM un instante después del primer render (antes, en
  el mismo). Nada del código depende de lo contrario (verificado: cambio de pestaña, aviso, guardado y vuelta al panel
  en vivo, 390 y 1280 px).
- **Lista en vivo con un solo diseño**: el diseño se elige por `matchMedia('(min-width: 64rem)')` y cambia al
  redimensionar; para un lector de pantalla no hay diferencia (el oculto ya tenía `display: none`).
- **Índices**: se crean con `CREATE INDEX` dentro de la migración (Drizzle corre las migraciones en transacción, no
  admite `CONCURRENTLY`): bloquean escrituras en `learning_sessions` y `student_alerts` mientras se construyen. Con los
  volúmenes medidos tardan milisegundos.

## 7. Limitaciones (lo que no se midió o no se puede afirmar)

- **No hay datos de campo.** Todo es laboratorio. Para validar con usuarios reales haría falta medir Web Vitals en el
  navegador (por ejemplo la librería `web-vitals` enviando LCP/INP/CLS a un endpoint propio) o esperar datos de CrUX.
- **Red y servidor locales.** Lighthouse simula la red (Lantern) sobre una carga real en localhost con HTTP/1.1; en
  producción (Traefik/Cloudflare, HTTP/2 o 3, TLS) el costo de muchos requests chicos y el efecto de los preloads
  pueden ser distintos. El TTFB medido (1–3 ms) no dice nada sobre producción; el aumento de 1–2 ms en el inicio es el
  Brotli del HTML con el CSS en línea (82 KB sin comprimir), que podría cachearse.
- **La base estaba en la misma máquina** (Docker/WSL2), sin latencia de red; en producción cada consulta suma un viaje
  de red, lo que favorece todavía más a los cambios que reducen consultas o filas.
- **INP**: interacciones sintéticas de Playwright con CPU 4×, en una sola máquina; Event Timing redondea a 8 ms. El
  chat del alumno quedó igual dentro de ese margen. No se midió INP en el inicio docente ni en otras pantallas.
- **TBT** no es comparable cuando el FCP se mueve mucho (6.1); se informa además el bloqueo de todas las tareas largas.
- **No medido**: latencia real del tutor (depende de la API de Anthropic; se usó el simulador), subida y extracción de
  archivos, generación de informes con IA, PDFs grandes, la vista en vivo con muchos docentes conectados por SSE (por
  diseño cada cambio dispara un refetch del snapshot con debounce de 400 ms en el servidor y throttle de 1,5 s en el
  cliente; ese snapshot ahora cuesta ~la mitad), páginas de materiales, tutores, informes y administración en
  Lighthouse.
- **Oportunidades que quedaron**: la consulta del informe general (78–116 ms, una subconsulta correlacionada por tipo
  de ayuda y por aula, `explain-reports-after.txt`) se puede reescribir con una sola agregación; el inicio público
  todavía se re-renderiza con `createRoot` en vez de hidratar el HTML prerenderizado (LCP 150 ms después del FCP);
  tailwind-merge (~7 KB Brotli) sigue en el entry; las dos tareas largas de React de la actividad (6.1); los íconos de
  lucide salen en ~29 chunks diminutos (con los modulepreload ya no forman cadena, pero son requests).
- Variabilidad: Lighthouse simulado es muy estable entre corridas (LCP ±1 %); el INP y las operaciones secuenciales
  únicas no lo son (por eso se alternaron builds).

## 8. Cómo reproducir

```bash
docker exec aulasocratica-pg psql -U aula -d aula -c "create database aula_perf;"
npm ci && npm run build
bash scripts/bench/run-suite.sh after 5          # seed + servidor + Lighthouse + INP + API → docs/benchmarks/*-after.json
node scripts/bench/long-tasks.mjs after 5        # con un servidor levantado (ver run-suite.sh)
bash scripts/bench/inp-compare.sh <dirAntes> before <dirDespués> after 2 5
node scripts/bench/inp-aggregate.mjs after docs/benchmarks
node scripts/bench/compare.mjs before after      # tablas en Markdown
```

`seed.mjs` **borra el esquema** de la base que recibe: solo acepta nombres que contengan `perf` o `bench`.

## 9. Para integrar

- Migración nueva `drizzle/0001_perf_indexes.sql` (dos `CREATE INDEX`); se aplica sola al arrancar
  (`runMigrations`). Si otra rama agrega migraciones, regenerar con `npm run db:generate` para que el journal quede en
  orden.
- El build escribe `dist/route-preloads.json` (fuera de `dist/client`, no es público); el Dockerfile ya copia `dist`
  entero. Si falta, el servidor simplemente no agrega los `modulepreload`.
- `.gitignore` y `.dockerignore` ignoran `data-perf/` (datos y logs de las mediciones).
- Sin variables de entorno nuevas. Tests: 23 archivos / 189 tests en verde (7 tests nuevos de equivalencia y de
  compresión); `npm run typecheck` limpio; e2e `@smoke` 6/6 contra el build de producción.
