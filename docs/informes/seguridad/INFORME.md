# Informe de seguridad — Aula Socrática

**Aplicación:** Aula Socrática (https://aulasocratica.becode.com.ar) — tutor socrático de IA para
docentes y alumnos (en su mayoría menores de edad).
**Fecha:** 2026-10-21 · **Revisor:** auditoría de seguridad de aplicaciones (independiente).
**Commit/estado:** build en `dist/` (no se reconstruyó). Node 22 + Hono + PostgreSQL/Drizzle + Claude.

## Alcance y método

- **Revisión de código** de todo `src/server`, `src/shared`, los contratos zod y el renderizador de
  Markdown del cliente (`src/client/features/student/markdown.tsx`).
- **Pruebas dinámicas** contra una instancia propia y aislada del build ya compilado:
  base `aula_sec`, puerto 4600, `DATA_DIR=./data-sec`, simulador local de IA
  (`scripts/dev/fake-claude.mjs`) en 47997. Se emularon condiciones de producción donde hizo falta
  (`NODE_OPTIONS=--max-old-space-size=768` como en el Dockerfile; `TRUST_PROXY=true`;
  `AI_DAILY_TOKENS_PER_WORKSPACE=1000`). No se tocaron otras bases ni puertos. Los procesos y la base
  `aula_sec` se detuvieron y borraron al terminar.
- **Inspección en navegador** (panel Browser del escritorio) de todas las pantallas del docente y del
  alumno con datos sembrados con payloads XSS en cada campo.
- **Producción:** solo lectura de encabezados de `/` y `/api/health` con `curl`. No se ejecutaron
  ataques ni carga contra producción.
- Los scripts reproducibles y sus salidas quedaron en `docs/informes/seguridad/scripts/`
  (`01-idor` … `10-admin`, `lib.mjs`, `04-xss-browser.out.txt`, `npm-audit-*.txt`).

Cobertura de los puntos pedidos: 1 IDOR/autorización ✔, 2 CSRF/CORS/clickjacking/CSP/XSS ✔,
3 inyección SQL/path/encabezados/prompt ✔, 4 sesiones/contraseñas/merge ✔, 5 subidas ✔,
6 abuso/DoS ✔, 7 exposición de datos ✔, 8 privacidad de menores/retención ✔, 9 `npm audit` ✔,
10 despliegue/headers/TRUST_PROXY ✔.

## Resumen por gravedad

| Gravedad | Cantidad |
|---|---|
| Crítica | 1 |
| Alta | 1 |
| Media | 5 |
| Baja | 5 |
| Info | 4 |

## Tabla de hallazgos

| ID | Título | Gravedad | Componente (archivo:línea) |
|---|---|---|---|
| F-01 | Bomba de descompresión en `.docx` tira el proceso (OOM) y deja un bucle de reinicio | **Crítica** | `src/server/services/extract.ts:86-93`; `src/server/services/file-jobs.ts:18,115-125` |
| F-02 | Abuso de costo de IA: workspaces anónimos ilimitados y un alumno agota el presupuesto de toda la clase | **Alta** | `src/server/ai/client.ts:80-93`; `src/server/routes/auth.ts:37`; `src/server/services/student/tutor.ts:76` |
| F-03 | IP de cliente falsificable vía `CF-Connecting-IP`/`X-Forwarded-For` si el origen es alcanzable sin Cloudflare | Media | `src/server/lib/request.ts:6-18` |
| F-04 | Los informes guardan nombre y respuestas de alumnos ya borrados (derecho de supresión de menores) | Media | `src/server/services/reports/build.ts:240-299`; `src/server/routes/reports.ts:70-82,209-217` |
| F-05 | Cambiar la contraseña no rota el código de recuperación (persistencia del atacante) | Media | `src/server/routes/auth.ts:146-159` |
| F-06 | Agotamiento de disco por "Duplicar" sin límite ni cuota por espacio | Media | `src/server/routes/activities.ts:173-181`; `src/server/services/activities/lifecycle.ts:257-313` |
| F-07 | Toma de identidad de un compañero por nombre de lista antes de su primer ingreso | Media | `src/server/services/student/session.ts:215-256` |
| F-08 | Enumeración de nombres de alumnos de una actividad vía `/resume` (404 vs 400) | Baja | `src/server/services/student/session.ts:278-296` |
| F-09 | Enumeración de cuentas de docente en `/register` y por tiempo en `/login` | Baja | `src/server/routes/auth.ts:61-70,86-96` |
| F-10 | DoS de "continuar en otro dispositivo": un tercero bloquea el código de un alumno 15 min | Baja | `src/server/services/student/session.ts:278-296` |
| F-11 | Sin verificación de bytes (magic bytes) al subir: la extensión manda | Baja | `src/shared/domain/files.ts:171-201`; `src/server/services/activities/files.ts:44-55` |
| F-12 | `GET /api/health` público revela estado de la base y `version` | Baja | `src/server/routes/health.ts:28-33` |
| F-13 | `npm audit`: 7 moderadas (prod: `argparse`/`sprintf-js` vía mammoth) | Info | `package.json` (mammoth 1.13.0) |
| F-14 | Lockout global de `/admin` permite bloquear al dueño (DoS de administración) | Info | `src/server/services/admin/session.ts:19,176-190` |
| F-15 | Carpetas vacías quedan en disco tras borrar aula/actividad | Info | `src/server/services/activities/lifecycle.ts:364-378` |
| F-16 | Inyección de prompt del alumno: alcance acotado (sin datos de terceros ni secretos) | Info | `src/shared/domain/tutor-prompt.ts:44-69` |

---

## Detalle de hallazgos

### F-01 (Crítica) — Bomba de descompresión en `.docx` tira el proceso y deja un bucle de reinicio

**Componente:** `src/server/services/extract.ts:86-93` (`extractDocx` → `mammoth.extractRawText`);
cola de lectura en `src/server/services/file-jobs.ts:18` (`CONCURRENCY = 2`) y job de recuperación
`src/server/services/file-jobs.ts:115-125`.

**Evidencia (prueba dinámica, `scripts/08-docx-bomb.mjs`):** un `.docx` de **597 KB** cuyo
`word/document.xml` infla a 200 MB. Subido a `POST /api/activities/:id/files` (muy por debajo del
límite de 60 MB), el job de fondo lo pasa a `mammoth`, que arma el DOM completo en memoria:

```
docx generado: 597 KB comprimido → 200 MB de XML
subida: 201 pending
t+3s health=sin respuesta (TypeError) (1291 ms)
# log del servidor:
<--- Last few GCs --->  Mark-Compact 768.8 (781.7) -> 767.5 (782.5) MB ...
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

El proceso (único; el rate-limit y el bus en vivo son en memoria, ver ARQUITECTURA.md) muere. Peor:
al reiniciar, el job `resume_file_processing` vuelve a tomar la fila en `pending`/`processing`
(`file-jobs.ts:115-125`) y **vuelve a morir ~65 s después de cada arranque** (bucle de reinicio
verificado: `t+67s health=000 → exit=134`). `clean()` recorta a 5 MB, pero **después** de que
mammoth ya construyó todo en memoria, así que no protege. El mismo patrón aplica a PDF/texto
(`extractPdf`/texto cargan todo el contenido antes de recortar).

**Impacto:** caída total del servicio para todos los docentes y alumnos, autosostenida, provocada por
cualquiera que cree un espacio gratis (un clic, sin correo) y suba un archivo pequeño. Requiere
intervención manual del operador (borrar la fila/el archivo) para recuperar.

**Recomendación:**
1. Procesar las subidas en un **worker aislado** (`worker_threads` o un subproceso con
   `--max-old-space-size` bajo) que pueda morir sin tumbar la API.
2. Limitar el **tamaño descomprimido**: antes de pasar a mammoth, abrir el zip y rechazar si la suma
   de tamaños sin comprimir supera un techo (p. ej. 50 MB) o si el ratio de compresión es
   desproporcionado. Con JSZip ya presente:
   ```ts
   const zip = await JSZip.loadAsync(data);
   let total = 0;
   zip.forEach((_p, f) => { total += f._data?.uncompressedSize ?? 0; });
   if (total > 50 * 1024 * 1024) throw new HttpError(422, "El documento es demasiado grande para leer.", "docx_too_large");
   ```
3. Que el job de recuperación **no reintente indefinidamente**: contar reintentos y marcar `failed`
   tras N fallos (y no re-encolar filas que ya fallaron por memoria).
4. Aplicar un tope de caracteres/páginas **antes** de materializar todo el texto (streaming).

---

### F-02 (Alta) — Abuso de costo de IA: workspaces anónimos ilimitados y presupuesto por clase agotable

**Componente:** presupuesto por espacio/día en `src/server/ai/client.ts:80-93` (`assertBudget`);
creación de espacios en `src/server/routes/auth.ts:37` (`rateLimit("start", 20, 60*60_000)` por IP);
chat del alumno en `src/server/services/student/tutor.ts:76`.

**Evidencia (`scripts/06-abuse.mjs`, con `AI_DAILY_TOKENS_PER_WORKSPACE=1000`):**

```
OK  un alumno agota el presupuesto diario de IA del docente  -> ai_quota en el mensaje 8
OK  después, las funciones de IA del docente también fallan (429 ai_quota)
OK  y el resto de la clase se queda sin tutor por el día  -> 429 ... límite diario de uso de IA
```

Dos problemas combinados:
- **DoS de clase / costo:** el presupuesto es **por espacio docente y por día**, compartido por todos
  los alumnos. Un solo alumno (o cualquiera con el enlace) puede consumirlo con mensajes de chat (el
  único freno es `CHAT_LIMIT` 20/5 min por sesión, trivial de superar con varias sesiones), dejando sin
  tutor a toda la clase y disparando el gasto real de la cuenta de Anthropic hasta el tope.
- **Espacios anónimos ilimitados:** cada espacio tiene su **propio** presupuesto de 4 000 000 tokens/día
  y se crea con un clic sin correo. El único freno a la creación es 20/h **por IP**, evadible con F-03.
  Un atacante que cree muchos espacios multiplica el costo total sin tope global.

**Impacto:** gasto no acotado contra la cuenta de IA del operador y denegación del tutor a clases enteras.

**Recomendación:**
- Tope **global diario** de tokens (toda la plataforma), además del tope por espacio, con alerta al
  operador. Es la única defensa real contra espacios anónimos masivos.
- Sub-límite por **sesión de alumno** (p. ej. N mensajes/tokens por alumno y día) para que un alumno no
  agote el presupuesto de la clase.
- Endurecer la creación de espacios: captcha/prueba de trabajo ligera o límite por huella además de IP;
  y resolver F-03 para que el límite por IP sea real.

---

### F-03 (Media) — IP de cliente falsificable por encabezados de reenvío

**Componente:** `src/server/lib/request.ts:6-18`.

```ts
if (env.TRUST_PROXY) {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();   // primer valor = el que pone el cliente
}
```

En producción `TRUST_PROXY=true`. Cloudflare siempre fija `CF-Connecting-IP`, así que por la ruta normal
ese valor es confiable. Pero:
- El **primer** valor de `X-Forwarded-For` lo controla el cliente; esa rama se usa cuando no llega
  `CF-Connecting-IP`, es decir **si el origen (Traefik/Coolify) es alcanzable sin pasar por Cloudflare**.
- En ese caso un cliente que pegue directo al origen puede mandar `CF-Connecting-IP: <lo que quiera>` y
  **rotar la IP en cada request**, anulando todos los límites por IP: creación de espacios (F-02),
  fuerza bruta de `/login` y el **lockout de `/admin`** (`admin.ts:47-55`, que confía en `clientIp`).

**Evidencia (`scripts/06-abuse.mjs`, `TRUST_PROXY=true`):**
```
OK  con CF-Connecting-IP rotado se crean más de 20 espacios por hora  -> 30/30 creados
OK  con X-Forwarded-For rotado (primer valor) también se evade        -> 25/25 creados
```

**Impacto:** si el origen no está restringido a las IPs de Cloudflare, todos los controles por IP son
evadibles (brute force de contraseñas, abuso de IA, inundación de altas).

**Recomendación:**
- **Restringir el origen** (firewall de Coolify/servidor) para aceptar tráfico solo de los rangos de
  Cloudflare, o exigir un secreto compartido de Cloudflare (header de autenticación de origen). Es lo que
  convierte a `CF-Connecting-IP` en confiable.
- No confiar en el primer valor de `X-Forwarded-For`; tomar el valor **a N saltos del final** según la
  cadena real de proxies, o usar solo `CF-Connecting-IP`. Documentar el número de proxies de confianza.

---

### F-04 (Media) — Los informes conservan datos de alumnos borrados (supresión de menores)

**Componente:** `src/server/services/reports/build.ts:240-299` (snapshot con `studentName`,
`excerpt(s.initialAnswer)`, `excerpt(s.finalAnswer)`, `excerpt(item.evidence)`); el snapshot se guarda en
`reports.data` (jsonb) y se reexporta en `routes/reports.ts:209-217` (CSV) y `:219-235` (PDF).

**Evidencia (`scripts/09-privacy.mjs`):**
```
OK  informe individual contiene nombre y respuesta de la alumna
OK  borrar alumno ok
después de borrar a la alumna: informe individual contiene nombre=true respuesta=true
OK  los informes guardados conservan nombre/respuestas de una alumna borrada
OK  y se siguen exportando (CSV)     // el CSV incluye "Sofía Ramírez"
```

Al borrar un alumno o su trabajo, el informe ya creado mantiene en su snapshot el **nombre completo, la
respuesta inicial, la final, comentarios y citas textuales**, y los sigue mostrando y exportando.
`/refresh` fallaría (404, `routes/reports.ts:70-82`) pero no borra el snapshot. La página `/privacidad`
afirma el derecho de supresión (Ley 25.326) y que "lo borrado se elimina".

**Impacto:** datos personales de menores sobreviven a un pedido de borrado; incumple lo que promete la
política de privacidad.

**Recomendación:**
- Al borrar un alumno / sesión / aula, **purgar o anonimizar** los snapshots de informes que lo
  referencian (buscar por `scope.studentId`/`sessionId`/`activityId`/`classroomId`), o borrar esos
  informes.
- Alternativa: no persistir texto/nombres en `reports.data`; recomputar desde la base al ver/exportar
  (ya existe `buildReport`), de modo que un borrado se refleje automáticamente.

---

### F-05 (Media) — Cambiar la contraseña no rota el código de recuperación

**Componente:** `src/server/routes/auth.ts:146-159` (`POST /auth/password`): actualiza `passwordHash` y
borra las otras sesiones, pero **no toca `recoveryCodeHash`**.

**Evidencia (`scripts/05-auth.mjs`):**
```
OK  cambio de contraseña ok
OK  cambio de contraseña cierra las otras sesiones
OK  el código de recuperación sigue sirviendo después del cambio de contraseña  -> 200
OK  recover cierra todas las sesiones previas (incluida la del dueño)
```

Si un atacante conoció el código de recuperación (16 caracteres, de un solo uso pero no rotado aquí) y el
docente, al sospechar, cambia la contraseña, el atacante **todavía puede** usar `POST /auth/recover` para
fijar una contraseña nueva y entrar. El cambio de contraseña no revoca ese vector.

**Impacto:** persistencia del atacante pese a la acción correctiva natural del docente.

**Recomendación:** en `POST /auth/password` rotar también `recoveryCodeHash` (generar uno nuevo y
devolverlo, como hace `recover`/`register`), o al menos invalidar el anterior. Documentar en la UI que al
cambiar la contraseña se genera un código de recuperación nuevo.

---

### F-06 (Media) — Agotamiento de disco por "Duplicar" sin límite ni cuota

**Componente:** `src/server/routes/activities.ts:173-181` (`POST /:id/duplicate`, sin rate-limit);
`src/server/services/activities/lifecycle.ts:257-313` (`duplicateActivity` copia cada archivo en disco).

**Evidencia (`scripts/06-abuse.mjs`):**
```
15 duplicados en 7150 ms: 15 OK; disco 21 MB → 336 MB (cada copia duplica los 20 MB de archivos)
OK  Duplicar no tiene límite de frecuencia ni cuota de disco
```

Con 4 archivos de 5 MB (20 MB), 15 duplicados agregan ~300 MB en 7 s. No hay rate-limit en `duplicate`
(a diferencia de subida/IA) ni cuota de disco por espacio; el tope es solo 300 actividades por aula ×
200 aulas. Un espacio gratis puede llenar el volumen persistente `/data` y tumbar la app (y el
health-check de disco lleno).

**Impacto:** DoS por agotamiento de almacenamiento desde un solo espacio.

**Recomendación:** rate-limit por docente en `duplicate` (como `assertUploadRate`); **cuota de disco por
espacio** (sumar `size_bytes` de `activity_files` + `materials` y rechazar sobre un tope); y considerar
deduplicar archivos idénticos por hash en vez de copiarlos.

---

### F-07 (Media) — Toma de identidad de un compañero antes de su primer ingreso

**Componente:** `src/server/services/student/session.ts:215-256` (`joinWithName`): si el nombre existe
en la lista pero **todavía no tiene sesión**, se crea la sesión para quien lo escriba.

**Evidencia (`scripts/02-student.mjs`):**
```
OK  cualquiera con el enlace puede tomar un nombre de la lista que todavía no entró  -> 201 → Mateo Gómez
el Mateo real después → 409 resume_required
```

El enlace de la actividad es compartido por toda la clase y los nombres de la lista los carga el docente
(conocidos por los compañeros). Quien entre primero con el nombre de otro queda como ese alumno; cuando
el alumno real entra, recibe `resume_required` y **no tiene el código** (lo tiene el impostor), quedando
afuera de su propio trabajo. No hay ninguna prueba de identidad más allá del código que se emite **después**
del primer ingreso.

**Impacto:** suplantación de un compañero (menor) y/o denegación de acceso a su trabajo; el trabajo queda
bajo un nombre que no corresponde.

**Recomendación:** es una limitación de diseño (identidad = nombre + enlace). Mitigaciones: código de
acceso por alumno entregado por el docente (pre-emitido), o modo "lista cerrada" donde solo el docente
marca presente; registrar/mostrar al docente cuándo un nombre de lista fue reclamado por auto-registro
para detectar anomalías. Como mínimo, documentar el riesgo para el docente.

---

### F-08 (Baja) — Enumeración de nombres de alumnos vía `/resume`

**Componente:** `src/server/services/student/session.ts:278-296`: nombre inexistente → 404 `not_found`;
nombre existente con código errado → 400 `wrong_code`.

**Evidencia (`scripts/02-student.mjs`):**
`resume nombre inexistente → 404 not_found; nombre existente → 400 wrong_code`. La diferencia permite, a
cualquiera con el enlace, confirmar qué compañeros ya empezaron la actividad (hasta toparse con el límite
por IP de 30/10 min).

**Impacto:** fuga menor de quién participó (datos de menores). Acotada por el límite por IP (y por F-03).

**Recomendación:** responder igual (p. ej. 400 `wrong_code` genérico) exista o no el nombre, para no
distinguir ambos casos.

---

### F-09 (Baja) — Enumeración de cuentas de docente

**Componente:** `src/server/routes/auth.ts:61-70` (`/register` responde 409 "Ya existe una cuenta con ese
correo") y `:86-96` (`/login`: correo inexistente no corre scrypt → respuesta más rápida).

**Evidencia (`scripts/05-auth.mjs`):**
```
registro con correo existente → 409 Ya existe una cuenta con ese correo...
login: correo inexistente ≈ 61 ms vs correo existente ≈ 83 ms
```

`/register` confirma explícitamente si un correo ya tiene cuenta; `/login` lo sugiere por tiempo (sin
scrypt cuando el correo no existe). `/recover` sí es genérico.

**Impacto:** enumeración de correos de docentes. Baja (no son menores; `/login` y `/recover` ya tienen
rate-limit por correo e IP).

**Recomendación:** en `/register`, ante correo existente, considerar un flujo que no confirme la
existencia (o aceptarlo como coste de UX). En `/login`, ejecutar un scrypt "dummy" cuando el correo no
existe para igualar los tiempos.

---

### F-10 (Baja) — DoS del "continuar en otro dispositivo"

**Componente:** `src/server/services/student/session.ts:278-296`: 5 códigos errados por sesión bloquean
15 min (`WRONG_CODE_LIMIT`).

**Evidencia (`scripts/02-student.mjs`):** `con el bloqueo activo el código correcto también se rechaza
(429 locked)`. El bloqueo protege contra fuerza bruta (bien: 32^6 ≈ 1e9 y 5 intentos/15 min), pero un
tercero que conozca el **nombre** de un alumno puede gastarle los 5 intentos y mantener su resume
bloqueado 15 min de forma repetida, impidiéndole continuar en otro dispositivo (el alumno con su cookie
sigue trabajando, confirmado).

**Impacto:** molestia/denegación acotada contra un alumno concreto.

**Recomendación:** combinar el lockout por sesión con backoff por IP (ya existe 30/10 min) y, si se
agregan señales, no penalizar al titular que ya tiene cookie válida.

---

### F-11 (Baja) — Sin verificación de bytes al subir (la extensión manda)

**Componente:** `src/shared/domain/files.ts:171-201` (`validateUpload` clasifica por extensión/MIME) y
`src/server/services/activities/files.ts:44-55` (guarda sin inspeccionar contenido).

**Evidencia (`scripts/07-upload.mjs`):** `foto.png` con bytes HTML y `doc.pdf` con bytes HTML se
**aceptan** (201). **Mitigante clave:** al servir, el tipo sale de la base y se fuerza
`X-Content-Type-Options: nosniff`; el HTML disfrazado de PNG se entrega como `image/png` y el navegador
no lo interpreta como HTML (verificado). SVG y HTML se rechazan por extensión. El `doc.pdf` falso queda
`failed` al no poder leerse y **no se sirve al alumno** (404).

**Impacto:** bajo (no deriva en XSS por el `nosniff` + tipo fijo). Principal consecuencia: archivos
corruptos/espurios ocupan espacio y fallan al procesarse.

**Recomendación:** validar **magic bytes** contra la extensión declarada en `validateUpload` (rechazar
incoherencias) para defensa en profundidad y para no gastar lectura de IA en basura.

---

### F-12 (Baja) — `/api/health` público revela estado y versión

**Componente:** `src/server/routes/health.ts:28-33`. Sin autenticación devuelve `{status, db, version}`.
En producción `version` es `"dev"` (verificado por `curl` a producción: `{"status":"ok","db":"ok","version":"dev"}`).

**Impacto:** fuga menor (estado de la base como señal de disponibilidad; `version` no aporta a un
atacante pero tampoco debería ser `"dev"` en prod). Útil para el health-check de Docker/Coolify, que sí
lo necesita.

**Recomendación:** mantener `/api/health` mínimo (p. ej. solo `{status}`), mover `db`/`version` detrás de
auth o del `/admin`, y fijar `APP_VERSION` en el build para no mostrar `"dev"`.

---

### F-13 (Info) — `npm audit`

`npm audit --omit=dev` (producción): **3 moderadas**, todas en la cadena de **mammoth**:
`sprintf-js` (DoS por especificadores de precisión) ← `argparse@1` ← `mammoth`.
`npm audit` (con dev): **7 moderadas**; suma `esbuild ≤0.24.2` (vía `drizzle-kit` / `@esbuild-kit`), que es
**solo de desarrollo** (dev server), no va en la imagen.

**Alcance real:** `argparse` solo lo usa el **CLI** `node_modules/mammoth/bin/mammoth` (no la API
`extractRawText`, verificado). El servidor se empaqueta con esbuild y el bundle no referencia
`argparse`/`sprintf-js`. Por lo tanto la vulnerabilidad de `sprintf-js` **no es alcanzable** desde la app;
queda como higiene de dependencias. `esbuild` de dev no afecta producción.

**Recomendación:** actualizar `mammoth` cuando haya versión con `argparse@2`/`sprintf-js` parcheado (hoy
`npm audit fix --force` degradaría mammoth: no hacerlo). Mantener `esbuild`/`drizzle-kit` al día en dev.

### F-14 (Info) — Lockout global de `/admin` puede bloquear al dueño

`src/server/services/admin/session.ts:19,176-190`: 30 fallos globales en 15 min bloquean el login de
admin para **todos**, incluido el dueño. Es una defensa deliberada contra fuerza bruta distribuida, pero
un atacante puede usarla para negar el acceso de administración (sobre todo combinada con F-03 para
rotar IPs). La contraseña real son 28 caracteres aleatorios, así que el riesgo de adivinación es bajo.
**Recomendación:** permitir una vía de rescate (p. ej. no contar hacia el lockout global los intentos que
traigan un token de sesión admin válido previo, o un bypass por IP de confianza del operador).

### F-15 (Info) — Carpetas vacías tras borrar

`src/server/services/activities/lifecycle.ts:364-378` borra los archivos pero
`scripts/09-privacy.mjs` muestra que la carpeta `activities/<id>` queda vacía en disco. Sin impacto de
seguridad; limpieza. `deletePrefix` ya existe y se usa en `deleteActivity`; verificar que también se
aplique en el borrado por aula/espacio.

### F-16 (Info) — Inyección de prompt: alcance acotado (control OK, con matiz)

`src/shared/domain/tutor-prompt.ts:44-69`: reglas globales declaran que material y mensajes son datos; el
contenido no confiable va entre vallas `<<<MATERIAL>>>`/`<<<DOCENTE>>>`/`<<<RESPUESTA>>>` y `stripFences`
quita los marcadores del contenido (verificado en los tests unitarios del repo). **Revisado que ningún
prompt mezcla datos de otros alumnos:** el tutor usa solo el material de la actividad + el historial y la
respuesta de **esa** sesión; alertas, resúmenes, rúbrica, radiografía e informe de IA operan sobre una
sola sesión. Lo máximo que un alumno podría lograr con inyección es que el modelo repita el material de la
actividad o sus propias reglas pedagógicas (no hay secretos ni credenciales en el prompt). **Matiz:** la
inyección de prompt en un LLM nunca es 100 % evitable; mantener las vallas y no incorporar nunca datos de
terceros al prompt.

---

## Controles verificados como correctos (con evidencia)

- **Autorización / IDOR (F-verde):** `scripts/01-idor.mjs` probó **~70 endpoints** de docente con ids de
  otro espacio (aulas, actividades, archivos, sesiones, alumnos, tutores, materiales, informes, SSE en
  vivo, PDF de recorrido, descargas, alertas, planning) → **todos 404** (nunca 403, nunca 200), y los
  datos del espacio A quedaron intactos. Helpers de `services/access.ts` (`ownedClassroom/Activity/...`)
  anteponen validación de UUID y filtran por `teacherId`; "no encontrado" en vez de "prohibido".
- **Aislamiento alumno↔alumno y alumno↔actividad:** un alumno de A no puede bajar un archivo de la
  actividad B (404); la cookie es por actividad (`as_s_<activityId>`), no sirve en otro enlace; un token
  de alumno renombrado para otra actividad da 401; la cookie de alumno no abre rutas de docente (401).
- **CSRF / CORS / clickjacking (`scripts/03-csrf-headers.mjs`):** toda mutación exige `Origin` propio o el
  header `x-aula-client`; se rechazaron (403) `Origin` ajeno, `Origin: null`, ausencia de ambos, y forms
  cross-site `urlencoded`/`text/plain` a todos los tipos de endpoint; el form propio sin JS funciona
  (303). Sin `Access-Control-Allow-*` para orígenes ajenos. `X-Frame-Options: DENY` + CSP
  `frame-ancestors 'none'`.
- **CSP / XSS (`scripts/04-xss-seed.mjs` + inspección en navegador, `04-xss-browser.out.txt`):** con
  payloads en **todos** los campos (nombres, títulos, consigna, material, rúbrica, reflexión, nombre de
  archivo, alerta, tutor, nombre de alumno, mensajes, respuesta final, comentario de rúbrica, narrativa
  de informe) y recorriendo todas las pantallas de docente y alumno: `window.__xss` quedó `null`,
  `0` elementos inyectados, `0` `<script>` inline. React escapa todo; el Markdown del tutor
  (`markdown.tsx`) construye elementos desde texto plano y los `[x](javascript:…)` se muestran solo como
  texto (sin `href`). CSP real con `script-src 'self'` (en prod también
  `https://static.cloudflareinsights.com`), `object-src 'none'`, `base-uri 'self'`. Sin
  `dangerouslySetInnerHTML`/`innerHTML` en `src/client`.
- **Inyección SQL:** todo `sql\`\`` usa plantillas parametrizadas; los dos `sql.identifier`
  (`reports/build.ts:494,499`) se construyen sobre claves de un whitelist fijo, no entrada de usuario;
  `ilike` escapa `% _ \`; los cursores base64 se validan (regex de timestamp + UUID). Un id no-UUID da
  404 limpio (`GET /api/sessions/' or 1=1--` → 404).
- **Path traversal / encabezados:** claves de almacenamiento generadas por el servidor (UUID),
  `resolveKey` exige `startsWith(root+sep)`, `newKey` valida owner UUID y extensión `[a-z0-9]{1,8}`;
  `fileId` validado como UUID. Nombres de archivo saneados (sin carpetas ni control chars); el
  `Content-Disposition` con nombre hostil **no** inyectó encabezados (`X-Injected` ausente). Intentos de
  traversal en estáticos devuelven el SPA, nunca `package.json`/`.env`/`index.mjs`.
- **Sesiones / contraseñas (`scripts/05-auth.mjs`):** tokens de 256 bits aleatorios guardados como
  SHA-256; cookie docente `HttpOnly; SameSite=Lax; Path=/` (Secure en prod), alumno `Path=/api/s`, admin
  `SameSite=Strict`. Contraseñas con scrypt (N=16384) + `timingSafeEqual`. El cambio de contraseña y
  `recover` revocan las demás sesiones; el logout invalida el token en servidor; un espacio anónimo no
  puede cerrar sesión. Límites de `login` (10/15 min IP + 8/15 min por correo) y `recover` (5/15 min)
  activos.
- **Merge de espacios (`workspace.ts:mergeWorkspaces`):** solo se fusiona un espacio anónimo **con
  contenido** hacia la cuenta donde el usuario **se autentica** (login/recover correctos); nunca al
  revés ni entre cuentas. No se halló forma de fusionar hacia o secuestrar una cuenta ajena.
- **Fuerza bruta del código de resume:** lockout por sesión (5/15 min) + límite por IP (30/10 min);
  32^6 ≈ 1.07e9 combinaciones. El titular con cookie no se ve afectado por el lockout.
- **Subidas:** SVG/HTML/exe/sin-extensión rechazados; servido con tipo fijo + `nosniff`; `Range`
  fuera de rango → 416; archivos que no se pudieron leer no se sirven al alumno (404).
- **Admin (`scripts/10-admin.mjs`):** `/admin` deshabilitado si `ADMIN_PASSWORD` vacío; comparación en
  tiempo constante; token HMAC derivado de la contraseña (cambiarla invalida sesiones), expira 8 h,
  revocable en logout; lockout por IP a los 5 fallos (y global a 30). `/overview` y `/workspaces`
  **sin nombres de alumnos ni contenido**, correos **enmascarados** (`v***@e***.test`); cookie de docente
  no da acceso admin.
- **Logs (`lib/logger.ts` + revisión de todos los `log.*`):** se registran ids y conteos, no contenido de
  alumnos ni tokens; `errorFields` recorta el stack a 6 líneas y no va al cliente (`onError` devuelve
  mensajes genéricos). Revisión de los paths logueados en la corrida: solo método/ruta/estado/ms.
- **Privacidad / borrado (`scripts/09-privacy.mjs`):** borrar actividad/aula elimina los archivos del
  disco; el archivo de biblioteca movido por una fusión se borra al borrar la cuenta; el admin ve datos
  minimizados. (La excepción es F-04: los informes conservan copias.)
- **Despliegue / headers (prod, solo lectura):** HTTPS con HSTS `max-age=31536000; includeSubDomains`,
  CSP estricta, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP `same-origin`, Permissions-Policy. El
  **Dockerfile** corre como usuario `node` (no root), no copia `.env` (hay `.dockerignore` con `.env*`),
  usa `tini` y un health-check. No se publican source maps del cliente (`dist/client/assets` sin `.map`).

## Resumen de `npm audit`

- **Producción (`--omit=dev`):** 3 moderadas — `sprintf-js` ← `argparse@1` ← `mammoth@1.13.0`
  (GHSA-hp3w-g68c-fv3c, DoS). **No alcanzable** desde la app (solo la usa el CLI `mammoth/bin`, no
  `extractRawText`; el bundle del servidor no las referencia). Arreglo disponible solo con
  `--force` (degradaría mammoth) → **no aplicar**; actualizar mammoth cuando haya fix no disruptivo.
- **Con dev:** 7 moderadas — suma `esbuild ≤0.24.2` vía `drizzle-kit`/`@esbuild-kit` (GHSA-67mh-4wv8-2f99,
  dev server lee respuestas). **Solo desarrollo**, no va a la imagen. Salidas completas en
  `scripts/npm-audit-prod.txt` y `scripts/npm-audit-all.txt`.

## Riesgos residuales

- **Una sola instancia, estado en memoria:** rate-limits, lockout de resume, lockout de admin, tokens
  admin revocados y el bus en vivo viven en memoria; un reinicio los resetea y, al escalar a réplicas,
  dejan de ser efectivos (ya documentado en ARQUITECTURA.md). Mover a Postgres/Redis antes de escalar.
- **F-03 depende del despliegue:** la efectividad de todos los límites por IP depende de que el origen no
  sea alcanzable sin Cloudflare; no se pudo verificar sin atacar producción.
- **Identidad del alumno = nombre + enlace compartido:** F-07/F-08/F-10 son consecuencia del modelo
  (sin cuentas para menores, a propósito). Mitigables, no eliminables sin cambiar el modelo.
- **Inyección de prompt en LLM:** acotada (F-16) pero intrínsecamente no eliminable al 100 %.
- No se auditó la configuración viva de Cloudflare/Coolify ni la rotación real de secretos (fuera de
  alcance; solo lectura de headers en producción).
