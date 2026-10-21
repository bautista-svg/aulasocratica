# Auditoría externa UI/UX + QA — Aula Socrática

- **Fecha:** 21 de octubre de 2026
- **Build auditado:** producción local en `http://localhost:4300` (IA reemplazada por el simulador local: respuestas «[Simulador local]…» y «Texto de prueba (…)»). Se juzgaron flujos, estados, feedback y layout, **no** la calidad del texto de IA.
- **Método:** uso real de la app con Playwright (sin leer código fuente, sin modificar archivos del proyecto).
- **Carpeta de trabajo:** `docs/informes/auditoria-ui/` → `scripts/` (scripts y datos), `evidencia/` (524 archivos: capturas, PDF y CSV descargados, JSON de evidencia).

## Resumen ejecutivo

| Gravedad | Cantidad |
|---|---|
| Crítica | 0 |
| Alta | 4 |
| Media | 14 |
| Baja | 22 |
| **Total** | **40** |

Los pedidos explícitos del cliente funcionan en lo esencial (PDF de 200 páginas leído completo, Crear con IA con PDF/foto/Word, alumnos separados por actividad, reinicio, respuesta inicial desactivable, PDF del recorrido). Los problemas más serios: **el doble clic duplica aulas y actividades**, **una afirmación falsa sobre la privacidad del nombre del docente**, **el Inicio se rompe en celulares cuando hay títulos largos** y **el tutor «predeterminado» ignora las ediciones que el docente hizo en Mis tutores**.

---

## 1. Alcance y método

**Herramientas**

- Playwright 1.64.1 con Google Chrome 155.0.8059.80 (`channel: "chrome"`, headless), contextos con `bypassCSP` para poder inyectar axe-core.
- axe-core 4.14.0 (`axe.run()` sobre el documento completo).
- pdf-lib 1.17.1 (PDF de 200 páginas, de 3 páginas, PDF de 61 MB, PDF dañado y vacío), jszip 3.10.2 (Word .docx), captura del navegador (foto JPG/PNG con texto), WAV de 3 s, .txt, .exe y .xlsx falsos. Generador: `scripts/00-generar-archivos.mjs`.
- PyMuPDF para leer el texto y renderizar las páginas de los PDF descargados (`scripts/pdftext.py`).
- Un «driver» interactivo propio (`scripts/driver.mjs` + `scripts/r.sh`) que mantiene el navegador abierto y ejecuta pasos en varios contextos a la vez; barrido automático `scripts/10-barrido-responsive.mjs`; reproducción automática de los defectos principales `scripts/20-reproducir-defectos.mjs` (salida en `evidencia/R-salida-reproduccion.json`).

**Actores simulados (contextos de navegador separados)**

- Docente: espacio sin cuenta → luego con cuenta (correo + contraseña + código de recuperación); el mismo docente abierto en un segundo dispositivo (390 px) y un tercero (1024 px) para ingresar y recuperar la contraseña. Las credenciales de prueba están en `scripts/data/credenciales-prueba.json` (no son reales).
- Alumnos: Ana (1440 px, luego segundo dispositivo de 430 px con su código), Bruno (375 px), Carla (390 px), Diego (1024 px), Elena, Fede, Gabi (voz), Hugo, «María de los Ángeles McDonald», un alumno solo con teclado, y otros para casos límite. En total 12 contextos de alumno.
- Administrador (`/admin`), un contexto anónimo y un segundo espacio sin cuenta (para probar accesos cruzados).

**Viewports:** 320, 375, 390, 430, 768, 1024 y 1440 px. Por debajo de 768 se emuló dispositivo móvil (`isMobile`, táctil).

**Cantidades**

- 36 pantallas/estados distintos recorridos (ver matriz en §6), incluidos los 6 pasos de Crear con IA, las 4 pestañas del trabajo del alumno y 8 estados del alumno.
- Barrido automático: 30 pantallas × 7 viewports = 210 cargas, ejecutado dos veces (la segunda con la detección de desborde corregida para contextos móviles). Para cada carga: desborde horizontal (`scrollWidth > clientWidth`), objetivos táctiles < 44 px (≤ 430 px), `<title>`, `h1`, `aria-current`, errores de consola y requests fallidos, y captura.
- axe-core: 60 ejecuciones en el barrido (375 y 1440 px) + 8 ejecuciones puntuales sobre diálogos y pantallas extra.
- 517 capturas PNG, 3 PDF de recorrido y 1 PDF + 1 CSV de informe descargados y verificados.
- Flujos completos: crear aula/actividad (válido e inválido), subir archivos (8 tipos, incluidos inválidos), rúbrica (manual, IA, importar), reflexión, publicar, QR, horario, cerrar/abrir, enlace nuevo, duplicar, reiniciar, archivar, eliminar, volver a borrador, terminar (uno/todos), alertas (revisar/descartar/reabrir), evaluación, resumen IA, radiografía, Mis tutores (editar, crear, restaurar, usar), Mis materiales (subir, texto, enlace, buscar, usar), Radiografía, Informes (crear, PDF, CSV, validar), cuenta (crear, ingresar, recuperar, cerrar sesión, borrar espacio), administración.
- Navegación inesperada: recarga con cambios sin guardar, recarga durante la respuesta del tutor, atrás/adelante, deep links desde otro espacio y sin sesión, IDs inexistentes, token inválido, enlace regenerado, actividad cerrada a mitad de la charla, aula archivada, actividad programada, doble clic en todos los botones de creación.

**Limitaciones**

- IA simulada: no se evaluó la calidad de las propuestas, resúmenes ni alertas por IA (por ejemplo, el simulador devolvió 2 propuestas en lugar de 3; no se reporta).
- Solo Chrome headless: no se probaron Safari/Firefox ni dispositivos reales. El dictado por voz no se pudo usar (el navegador headless niega el micrófono; se verificó el mensaje de error) y «Compartir…» (`navigator.share`) no muestra la hoja nativa en headless.
- No se agotaron a propósito los bloqueos (5 intentos de código del alumno, 5 de administración) para no bloquear el entorno.
- El panel de administración mostró otros dos espacios que no creó esta auditoría: el servidor pudo estar siendo usado en paralelo. No afecta los hallazgos.

---

## 2. Verificación de los pedidos explícitos del cliente

| # | Pedido | Resultado | Evidencia |
|---|---|---|---|
| 1 | Subir PDF de muchas páginas | **OK** | PDF de 200 páginas subido al material de la actividad: «PDF de 200 páginas: el tutor usa el documento completo» en ~3 s. En «Ver el texto que lee el tutor» aparecen las marcas de la página 1, 150 y 200 (83.717 caracteres). PDF de 61 MB rechazado con «pesa más de 60 MB». `evidencia/07-material-pdf-200-paginas-1440.png`, `07-material-ver-texto-pdf-completo-1440.png`, `07-material-pdf-61MB-1440.png` |
| 2 | Crear con IA acepta PDF, foto y Word directo | **OK** | En el paso 2 se subieron juntos el PDF de 200 páginas, el .docx y una foto JPG («Listo» los tres; «La IA leyó el material completo: 3 materiales, 84.201 caracteres»). También solo con foto PNG. Hay entrada de cámara (`capture=environment`). `92-crear-ia-material-subido-1440.png`, `94-crear-ia-propuestas-1440.png` |
| 3 | Alumnos separados por actividad | **OK** | «El agua en la montaña»: Ana, Bruno, Carla. «Repaso»: Ana y Diego (Ana aparece en las dos por separado). La pestaña Alumnos del aula los junta con su actividad. Nota: el doble clic (D01) puede crear dos actividades iguales y repartir al curso entre dos enlaces. `63-en-vivo-act2-1440.png`, `64-aula-alumnos-1440.png` |
| 4 | Reiniciar una actividad borrando todo | **OK** | Confirmación con texto «REINICIAR» y opción de enlace nuevo; En vivo queda en 0; el alumno que vuelve con su dispositivo ve la pantalla de nombre; los alumnos sin otros trabajos se quitan de la lista del aula. `120-reiniciar-confirmar-1440.png`, `120-reiniciada-en-vivo-1440.png`, `121-alumno-tras-reinicio-1024.png`, `122-aula-alumnos-tras-reinicio-1440.png` |
| 5 | Todos los tutores incluidos aparecen en Mis tutores, son editables y elegibles al crear | **Parcial** | Los 18 tutores incluidos (8 enfoques + 10 formatos) están en Mis tutores, se editan, se marcan «Editado» y tienen «Restaurar original». Se pueden elegir en «Nueva actividad», «Aplicar tutor» y en el paso 5 de Crear con IA. **Pero** la opción por defecto «Pensamiento crítico (predeterminado)» ignora la edición del docente y aparece duplicada con «Pensamiento crítico» (D04). `80-tutores-tras-editar-1440.png`, `81-evidencia-tutor-predeterminado.json`, `81-tutor-predeterminado-sin-edicion-1440.png` |
| 6 | El docente puede desactivar la respuesta inicial | **OK** | Con el interruptor apagado el alumno ve «Paso 1 de 2: Conversación / Paso 2 de 2: Cierre» y entra directo al chat; En vivo muestra «x/2». `62-alumno-act2-sin-respuesta-inicial-1024.png` |
| 7 | Desde En vivo se descarga el PDF con todo el recorrido del alumno | **OK** (con observación) | Menú «⋯» de cada alumno → «Descargar PDF del recorrido» (en móvil hay botón «PDF» visible en cada tarjeta). El PDF incluye consigna, respuesta inicial, toda la conversación con los pedidos de ayuda, respuesta final, reflexión, señales del navegador y la evaluación confirmada con el comentario del docente. Observación: en escritorio la descarga queda escondida en «⋯» y a 1024 px esa columna se corta (D13). `30-docente-en-vivo-menu-alumno-1440.png`, `31-recorrido-ana-perez-p1.png`, `31-recorrido-bruno-gomez.pdf`, `31-recorrido-ana-perez-evaluada.pdf` |
| 8 | Ninguna afirmación falsa | **Falla** | Ver detalle abajo. |

**Detalle del punto 8 (veracidad de los textos)**

| Afirmación | Dónde | Resultado |
|---|---|---|
| «Tu nombre… Tus alumnos no lo ven» | Mi espacio, formulario de cuenta | **Falsa**: la pantalla de entrada del alumno muestra «Con Profe Auditoría» (D02). |
| «Se guarda en este dispositivo mientras escribís» (primera idea) | Alumno | **Falsa**: se guarda en `sessionStorage`; se pierde en otra pestaña o al cerrar el navegador (D06). |
| Ejemplo de «Recorrido del pensamiento» con respuestas intermedias del alumno | Landing («Ejemplo ilustrativo») | **Engañosa**: el Recorrido real no muestra lo que el alumno escribió entre las preguntas del tutor (D07). |
| «Vista de solo lectura» | Administración | **Imprecisa**: el panel tiene la acción «Suspender» (D28). |
| PDF «de cualquier cantidad de páginas (hasta 60 MB)», Word y fotos | Landing / Mis materiales | Verdadera (200 páginas leídas; 61 MB rechazado). |
| «El tutor no puede escuchar audios», «El tutor no abre enlaces» | Material / Mis materiales | Verdaderas y honestas (pide transcripción / descripción). |
| «No hay publicidad ni herramientas de seguimiento de terceros» | Privacidad | Consistente con lo observado: 0 requests a otros dominios en 10 pantallas; una sola cookie `as_t` (httpOnly, SameSite=Lax). |
| «Se registra si pegás texto copiado o si salís… 10 segundos o más» | Alumno / Privacidad | Verdadera: generó «Pegó un texto de 52 caracteres» y «Salió de la actividad durante 11 s». |
| El docente puede borrar el trabajo de un alumno, un alumno, una actividad, un aula o todo el espacio | Privacidad | Verdadera (todas las acciones existen y piden confirmación). |
| Instituciones, logos o testimonios | Landing | No se encontró ninguna afirmación de instituciones o clientes. |
| «Costo estimado con precios de referencia de US$ 0,10 por millón de tokens de entrada y US$ 0,50 por millón de salida» | Administración | **A verificar** con la configuración de producción: no coincide con las tarifas publicadas de los modelos Claude; si se usa igual en producción, el costo estimado queda subestimado. `211-admin-panel-1440.png` |

---

## 3. Defectos

Orden por gravedad. Cada ID se puede buscar en las capturas citadas (`docs/informes/auditoria-ui/evidencia/`). Los defectos D01, D02, D03, D04, D05, D06 y D12 se reproducen solos con `node scripts/20-reproducir-defectos.mjs`.

### Tabla resumen

| ID | Gravedad | Pantalla | Defecto |
|---|---|---|---|
| D01 | Alta | Aulas, Aula, Crear con IA, Duplicar | El doble clic crea aulas/actividades/copias duplicadas |
| D02 | Alta | Mi espacio → alumno | La UI dice que los alumnos no ven el nombre del docente, pero lo ven |
| D03 | Alta | Inicio (320–430 px) | Desborde horizontal de 580–634 px con títulos largos; la barra inferior queda cortada |
| D04 | Alta | Nueva actividad / Mis tutores / Crear con IA | «Pensamiento crítico (predeterminado)» ignora la edición del docente y está duplicado |
| D05 | Media | Todos los diálogos | Al cerrar un diálogo el foco vuelve a `<body>` |
| D06 | Media | Alumno: primera idea | El borrador no se guarda «en este dispositivo» (sessionStorage) |
| D07 | Media | Trabajo → Recorrido | El Recorrido omite lo que escribió el alumno y sus pedidos de ayuda |
| D08 | Media | Panel del docente en otro dispositivo | Con la sesión cerrada en otro dispositivo, las acciones fallan en silencio |
| D09 | Media | Configuración de actividad (móvil) | La barra «Cambios sin guardar» + barra inferior tapan el campo que se edita |
| D10 | Media | En vivo | «Terminar para todos» no cierra la actividad: entran alumnos nuevos |
| D11 | Media | Aula | Archivar no pide confirmación aunque haya alumnos trabajando; las actividades siguen «Abierta» |
| D12 | Media | Alumno: «Usá tu código» | Se envían códigos de largo inválido y consumen intentos |
| D13 | Media | En vivo a 1024 px | La tabla desborda y la columna de acciones (con el PDF) queda cortada |
| D14 | Media | Conversación, Alumnos y Alertas del aula | Contraste insuficiente (axe `color-contrast`, 35 nodos) |
| D15 | Media | Mis tutores | Nombre accesible distinto del texto visible (axe `label-content-name-mismatch`, 19) |
| D16 | Media | Alumno: primera idea (móvil y teclado) | El campo principal queda después de toda la lista de archivos |
| D17 | Media | 14 pantallas | `<title>` genérico, igual al de la landing |
| D18 | Media | Todo `/app` | `aria-current="page"` en «Inicio» y en el logo en todas las pantallas |
| D19 | Baja | En vivo / Trabajo | Estados contradictorios: «Trabajando», «Abandonada», «1/3» vs «Paso 2 de 3» |
| D20 | Baja | En vivo / Trabajo / PDF | «Mensajes» con tres valores distintos para el mismo alumno |
| D21 | Baja | Crear con IA, Usar material, Informes, Radiografía | Aulas archivadas ofrecidas como destino sin marcarlas |
| D22 | Baja | Alumno con enlace viejo | «¿Seguro que es este enlace? Revisá que esté completo» para un enlace reemplazado |
| D23 | Baja | Aula / Trabajo inexistente | Error 404 con botón «Reintentar» |
| D24 | Baja | PDF de informe | Encabezados de tabla cortados a mitad de palabra |
| D25 | Baja | Informe, mapa de calor | «a. m..» con doble punto; horas en 12 h y 24 h mezcladas |
| D26 | Baja | Alumno | El nombre se fuerza a mayúscula inicial («María De Los Ángeles Mcdonald») |
| D27 | Baja | Toasts | Botón de cierre con nombre accesible en inglés «Close toast» |
| D28 | Baja | Administración | Desborde a 375 px (1081 px), sin `h1`, «solo lectura» con acción Suspender |
| D29 | Baja | Landing tras cerrar sesión/borrar espacio | Sigue mostrando «Mi espacio» y «Abrir mi espacio» |
| D30 | Baja | Configuración → Tutor | Selector muestra «Argumentación · Argumentación» |
| D31 | Baja | Alumno: entrada | Metadatos redundantes («Ciencias Naturales · 5.º B — Ciencias Naturales · …») |
| D32 | Baja | Varios formularios | Validaciones inconsistentes (servidor sin aviso en el campo, globo nativo, error obsoleto, foco) |
| D33 | Baja | Aula → Agregar alumnos | «1 ya estaban en la lista» |
| D34 | Baja | Confirmaciones destructivas | Botón «Eliminar…» pide escribir «BORRAR» |
| D35 | Baja | Material | PDF dañado cuenta en «x de 20 archivos» y ofrece «Reintentar» |
| D36 | Baja | En vivo / Trabajo | Ícono de «Terminar» parece una casilla de verificación |
| D37 | Baja | Varias (móvil) | Objetivos táctiles menores a 44 px |
| D38 | Baja | Alumno con actividad cerrada | El alumno que ya terminó pierde acceso a su trabajo; no se avisa que el mensaje no se envió |
| D39 | Baja | 404 | Sin `h1` y logo duplicado dentro de `/app` |
| D40 | Baja | Tras eliminar actividad | Request residual 404 en consola |

### Detalle

#### D01 — El doble clic crea registros duplicados · **Alta**
- **Pantalla:** «Nueva aula» (Aulas), «Nueva actividad → Crear y seguir» (Aula), «Crear con IA → Crear y publicar» (paso 6), «Duplicar» (menú de actividad).
- **Pasos:** 1) Abrir cualquiera de esos diálogos y completar lo mínimo. 2) Hacer doble clic en el botón de confirmación. 3) Volver a la lista.
- **Esperado:** se crea un solo registro; el botón se deshabilita o muestra «Creando…» al primer clic.
- **Obtenido:** dos aulas «Aula doble click», dos actividades «Doble click prueba», dos actividades **publicadas** desde Crear con IA (con dos enlaces distintos) y dos «(copia)». El ingreso del alumno («Entrar a la actividad») sí está protegido.
- **Solución sugerida:** deshabilitar el botón mientras la mutación está en curso (`isPending`) y usar una clave de idempotencia en los POST de creación/duplicación/publicación.
- **Evidencia:** `100-doble-click-aulas-duplicadas-1440.png`, `100-doble-click-actividades-duplicadas-1440.png`, `99-aula-lista-tras-wizard-1440.png`, `R-D01-aulas-duplicadas.png`, `R-salida-reproduccion.json`.

#### D02 — Afirmación falsa: «Tus alumnos no lo ven» · **Alta**
- **Pantalla:** Mi espacio (campo «Tu nombre o el de tu espacio» y «Tu nombre (opcional)» al crear cuenta) → pantalla de entrada del alumno.
- **Pasos:** 1) En Mi espacio, guardar el nombre «Profe Auditoría» (el texto de ayuda dice «Aparece en el saludo de Inicio y en el menú. Tus alumnos no lo ven.»). 2) Abrir el enlace de una actividad publicada en otro navegador.
- **Esperado:** el alumno no ve el nombre del docente, o la ayuda dice que sí lo ve.
- **Obtenido:** la tarjeta de entrada del alumno muestra «Con Profe Auditoría».
- **Solución sugerida:** decidir el comportamiento y alinear el texto. Si se quiere mostrar, cambiar la ayuda a «Lo ven tus alumnos al entrar a una actividad» y avisarlo en la Privacidad; si no, quitarlo de `/clase/…`.
- **Evidencia:** `241-alumno-ve-nombre-docente-390.png`, `242-mi-espacio-dice-alumnos-no-lo-ven-1440.png`, `R-D02-alumno-ve-nombre-docente.png`.

#### D03 — Inicio desborda en celulares con títulos largos · **Alta**
- **Pantalla:** Inicio (`/app`) a 320, 375, 390 y 430 px.
- **Pasos:** 1) Tener una actividad con un título largo, por ejemplo «Fracciones equivalentes: comparación y ordenamiento en la recta numérica». 2) Abrir Inicio en un celular.
- **Esperado:** el título se recorta con «…» o se divide en líneas; sin scroll horizontal.
- **Obtenido:** `scrollWidth` 580–634 px contra 375 px. Toda la página se ensancha, las tarjetas de números quedan cortadas y la barra inferior de navegación queda parcialmente fuera de pantalla («Tutores» cortado, «Más» invisible). El causante es el título de «Actividades recientes» (`span.truncate` dentro de un contenedor flex sin `min-width: 0`).
- **Solución sugerida:** agregar `min-w-0` al contenedor flex del título (y `overflow-hidden` a la tarjeta) para que `truncate` funcione; agregar una prueba visual con títulos de 160 caracteres.
- **Evidencia:** `273-inicio-movil-overflow-375.png`, `B-inicio-375.png`, `B-inicio-320.png`, `R-D03-inicio-375.png`, `scripts/data/barrido-320_375_390_430_768_1024_1440.json`.

#### D04 — El tutor «predeterminado» ignora las ediciones de Mis tutores · **Alta**
- **Pantalla:** Aula → Nueva actividad (selector «Tutor»); Crear con IA paso 5.
- **Pasos:** 1) En Mis tutores, editar «Pensamiento crítico» y agregar una regla («REGLA-AUDITORIA-PC…»); guardar (queda «Editado»). 2) Aula → Nueva actividad: el selector ofrece «Pensamiento crítico (predeterminado)» (seleccionada) y, más abajo, «Pensamiento crítico». 3) Crear con la opción por defecto.
- **Esperado:** una sola opción «Pensamiento crítico», y que use la versión editada (o que el selector aclare que la predeterminada es la original).
- **Obtenido:** la actividad se crea con el tutor base: «Indicaciones para el tutor» vacío y sin «Basada en…». Con «Argumentación» editado y elegido explícitamente, sí se copian el nivel y las reglas. En Crear con IA, la opción preseleccionada es «La sugerencia de la propuesta» (base) aunque exista la versión editada.
- **Solución sugerida:** quitar la entrada «(predeterminado)» y preseleccionar el «Pensamiento crítico» de Mis tutores (editado o no); marcar con «Editado» las versiones modificadas dentro del selector.
- **Evidencia:** `81-evidencia-tutor-predeterminado.json`, `81-tutor-predeterminado-sin-edicion-1440.png`, `81-tutor-argumentacion-con-edicion-1440.png`, `05-nueva-actividad-dialogo-1440.png`, `96-crear-ia-paso5-tutor-1440.png`.

#### D05 — El foco se pierde al cerrar cualquier diálogo · **Media**
- **Pantalla:** Nueva aula, Nueva actividad, Nuevo tutor, Editar tutor, Escribir texto (Materiales), QR en grande (y el resto de los diálogos probados).
- **Pasos:** 1) Con teclado, enfocar «Nueva aula» y Enter. 2) Escape (o «Cancelar»).
- **Esperado:** el foco vuelve al botón que abrió el diálogo (WCAG 2.4.3).
- **Obtenido:** `document.activeElement` es `BODY`; el siguiente Tab va a «Saltar al contenido», al principio de la página. Los menús desplegables sí devuelven el foco.
- **Solución sugerida:** no desmontar/recrear el disparador al cerrar; dejar que Radix restaure el foco o hacerlo en `onCloseAutoFocus`.
- **Evidencia:** `231-teclado-foco-vuelve-1440.png`, `R-salida-reproduccion.json` (`D05_foco_tras_cerrar: "BODY"`).

#### D06 — El borrador de la primera idea no se guarda «en este dispositivo» · **Media**
- **Pantalla:** Alumno, paso «Tu idea».
- **Pasos:** 1) Entrar como alumno y escribir en «Tu primera idea» (ayuda: «Se guarda en este dispositivo mientras escribís.»). 2) Abrir el mismo enlace en otra pestaña o cerrar y reabrir el navegador.
- **Esperado:** el texto sigue ahí.
- **Obtenido:** el campo aparece vacío. El borrador vive en `sessionStorage` (`as-draft:…:initial`), que es por pestaña. Recargar la misma pestaña sí lo conserva.
- **Solución sugerida:** guardar el borrador en `localStorage` (o en el servidor) con la clave del alumno, o cambiar el texto a «Se guarda mientras no cierres esta pestaña».
- **Evidencia:** `21-alumno-nueva-pestana-borrador-1440.png`, `R-salida-reproduccion.json`.

#### D07 — El «Recorrido del pensamiento» no muestra lo que escribió el alumno · **Media**
- **Pantalla:** Trabajo del alumno → pestaña Recorrido.
- **Pasos:** 1) Un alumno conversa: mensaje propio, «Necesito una pista», «No entendí», «¿Podés darme un ejemplo?», etc. 2) Abrir su trabajo.
- **Esperado:** la secuencia idea → pregunta del tutor → respuesta del alumno → … como en el ejemplo de la landing («Hay menos aire… ¿menos presión?»).
- **Obtenido:** se listan 10 «Pregunta del tutor» seguidas, sin los mensajes del alumno ni sus pedidos de ayuda (solo aparecen «Pidió revisar», «Propuso otra idea» y «Explicó»). El PDF del recorrido y la pestaña Conversación sí los muestran. El panel «En números» dice «Pistas pedidas 1», pero la pista no aparece en la línea de tiempo.
- **Solución sugerida:** intercalar las respuestas del alumno (colapsadas o en una línea) y marcar los pedidos de ayuda en la línea de tiempo.
- **Evidencia:** `50-sesion-ana-1440.png`, `51-sesion-ana-tab-conversacion-1440.png`, `00-explorar-home-1440.png`.

#### D08 — Sesión cerrada en otro dispositivo: la app falla en silencio · **Media**
- **Pantalla:** Panel del docente abierto en un dispositivo cuando, en otro, se recupera o cambia la contraseña («Cerramos la sesión en tus otros dispositivos»).
- **Pasos:** 1) Docente con cuenta abierto en el dispositivo A. 2) En el dispositivo B, «Olvidé mi contraseña» con el código de recuperación. 3) En A, sin recargar, tocar «Nueva aula», completar y «Crear aula».
- **Esperado:** aviso «Tu sesión se cerró porque cambiaste la contraseña» y redirección a Ingresar.
- **Obtenido:** Inicio sigue saludando «Hola, Profe Auditoría» con un bloque «No se pudo cargar — No encontramos tu espacio en este dispositivo — Reintentar»; el POST responde 401 y el diálogo queda abierto sin ningún mensaje. Las encuestas periódicas siguen dando 401 en consola. Al recargar se ve «No hay un espacio abierto en este dispositivo» con «Empezar sin cuenta» como acción principal (riesgo de crear un espacio vacío).
- **Solución sugerida:** interceptar 401 globalmente → toast explicativo + redirección a `/ingresar?volver=<ruta>`.
- **Evidencia:** `207-sesion-revocada-pagina-abierta-390.png`, `208-sesion-revocada-accion-390.png`, `206-sesion-cerrada-otro-dispositivo-1440.png`.

#### D09 — En móvil, las barras fijas tapan el campo que se está editando · **Media**
- **Pantalla:** Actividad → Configuración a 375 px.
- **Pasos:** 1) Abrir la configuración en un celular. 2) Tocar «Objetivos de aprendizaje» (u otro campo cerca del borde inferior) y escribir.
- **Esperado:** el campo enfocado queda visible por encima de las barras.
- **Obtenido:** al primer cambio aparece la barra «Cambios sin guardar» (683–727 px) sobre la barra inferior (747–812 px); el textarea enfocado queda en 753–845 px, completamente tapado. Entre ambas barras ocupan ~130 px de 812.
- **Solución sugerida:** `scroll-padding-bottom` / `scroll-margin-bottom` iguales a la altura de las barras y `scrollIntoView` del campo enfocado al aparecer la barra; ocultar la barra inferior mientras hay teclado o cambios sin guardar.
- **Evidencia:** `272-docente-movil-editor-barra-guardar-375.png`.

#### D10 — «Terminar para todos» no cierra la actividad · **Media**
- **Pantalla:** Actividad → En vivo.
- **Pasos:** 1) «Terminar para todos» → confirmar. 2) Un alumno nuevo abre el enlace.
- **Esperado:** que el nombre del botón coincida con el efecto; si el docente terminó para todos, que el enlace no acepte más alumnos o que se ofrezca cerrarlo.
- **Obtenido:** la actividad sigue «Abierta» y el alumno nuevo («Hugo Tarde») entra y empieza a trabajar.
- **Solución sugerida:** agregar en la confirmación una casilla «Cerrar también el enlace» (marcada por defecto) o renombrar a «Terminar el trabajo de los que están ahora».
- **Evidencia:** `262-terminar-para-todos-confirmar-1440.png`, `263-terminar-para-todos-resultado-1440.png`, `264-alumno-entra-tras-terminar-para-todos-375.png`.

#### D11 — Archivar un aula sin confirmación y estados que no cambian · **Media**
- **Pantalla:** Aula → «⋯» → Archivar aula.
- **Pasos:** 1) Con un alumno trabajando en ese momento («1 trabajando ahora»), elegir «Archivar aula».
- **Esperado:** confirmación que avise cuántos alumnos están trabajando y que sus enlaces se cierran; luego las actividades marcadas como cerradas.
- **Obtenido:** se archiva al instante (solo un toast «Sus enlaces quedan cerrados»). El alumno que estaba escribiendo pasa a «Esta actividad ya no está disponible». Dentro del aula archivada la actividad sigue con la etiqueta verde «Abierta», el botón principal «Compartir» y, en la pestaña Archivadas, «1 ahora».
- **Solución sugerida:** diálogo de confirmación con el número de alumnos activos; mostrar «Cerrada (aula archivada)» y desactivar «Compartir».
- **Evidencia:** `110-aula-archivada-1440.png`, `111-alumno-aula-archivada-1440.png`, `112-actividad-en-aula-archivada-1440.png`, `112-aulas-archivadas-tab-1440.png`.

#### D12 — El código para continuar acepta largos inválidos y gasta intentos · **Media**
- **Pantalla:** Alumno → «¿Empezaste en otro dispositivo? Usá tu código».
- **Pasos:** 1) Nombre correcto y código «b4gv7» (5 caracteres; la ayuda dice «Son 6 letras y números»). 2) «Seguir mi trabajo».
- **Esperado:** el botón no se habilita, o aparece «Faltan caracteres» sin consumir un intento.
- **Obtenido:** se envía, responde 400 y muestra «te quedan 3 intentos». Con 5 intentos en total, un alumno que tipea mal puede bloquearse.
- **Solución sugerida:** validar en el cliente (6 caracteres alfanuméricos, mayúsculas automáticas) antes de enviar; no contar como intento un formato inválido.
- **Evidencia:** `43-alumno-codigo-codigo-5-caracteres-430.png`, `43-alumno-codigo-codigo-incorrecto-430.png`, `R-salida-reproduccion.json`.

#### D13 — En vivo a 1024 px: la columna de acciones queda cortada · **Media**
- **Pantalla:** Actividad → En vivo a 1024 × 1024 (laptop chica / tablet horizontal).
- **Pasos:** abrir En vivo con alumnos.
- **Esperado:** la tabla entra o se desplaza dentro de su contenedor.
- **Obtenido:** la tabla mide 752 px dentro de un contenedor más angosto y la página desborda a 1033 px; «Ver trabajo» queda recortado y el menú «⋯» (donde está «Descargar PDF del recorrido») queda fuera de la vista. «Pedidos de ayuda» se apila en 5 líneas.
- **Solución sugerida:** usar el diseño de tarjetas (el de 768 px) hasta ~1100 px, o `overflow-x: auto` en el contenedor de la tabla; mostrar «PDF» como botón visible en la fila.
- **Evidencia:** `B-act-envivo-1024.png`, `scripts/data/barrido-320_375_390_430_768_1024_1440.json`.

#### D14 — Contraste de color insuficiente · **Media**
- **Pantalla:** Trabajo → Conversación (20 nodos: etiqueta del alumno y del tipo de ayuda en las burbujas del alumno), Aula → Alumnos (3: texto con `opacity-80` dentro de las insignias verdes de actividad), Aula → Alertas (12: filas de alertas «Siempre activa» con `opacity-60`).
- **Pasos:** correr axe-core en esas pantallas (375 y 1440 px).
- **Esperado:** contraste ≥ 4.5:1 en texto normal (WCAG 1.4.3).
- **Obtenido:** violación `color-contrast` (serious) en las tres pantallas.
- **Solución sugerida:** no bajar la opacidad del texto; usar un color de texto con contraste suficiente sobre `bg-ink-soft` / `bg-leaf-soft`.
- **Evidencia:** `B-sesion-conversacion-1440.png`, `B-aula-alumnos-1440.png`, `B-aula-alertas-1440.png`, `scripts/data/barrido-v1-axe.json`.

#### D15 — Tarjetas de Mis tutores: el nombre accesible no incluye el texto visible · **Media**
- **Pantalla:** Mis tutores.
- **Obtenido:** cada tarjeta es un botón con `aria-label="Abrir Argumentación"` mientras el texto visible incluye la descripción y el nivel; axe `label-content-name-mismatch` (serious) en los 19 botones. Quien usa control por voz («clic Ayuda a construir…») no puede activarlas.
- **Esperado / solución:** que el nombre accesible empiece con el texto visible (por ejemplo `aria-labelledby` al título y `aria-describedby` a la descripción) en lugar de un `aria-label` distinto.
- **Evidencia:** `B-tutores-1440.png`, `scripts/data/barrido-v1-axe.json`.

#### D16 — El campo principal del alumno queda al final · **Media**
- **Pantalla:** Alumno, paso «Tu idea», a 375 px y con teclado.
- **Pasos:** 1) Entrar a una actividad con 6 archivos en un celular. 2) Buscar dónde escribir.
- **Esperado:** el campo «Tu primera idea» visible sin desplazarse mucho y con el foco al entrar.
- **Obtenido:** en 375 px el campo aparece después de la consigna, el bloque de material, los 6 archivos (con reproductor de audio) y el aviso del código: hay que bajar unas dos pantallas. Con teclado, tras entrar el foco queda en `<body>` y hacen falta 18 tabulaciones (incluidos 3 controles del audio) para llegar al campo.
- **Solución sugerida:** en móvil, colapsar «Archivos de la actividad (6)» y el aviso del código; mover el foco al campo de la primera idea (o a su título) al entrar.
- **Evidencia:** `40-alumno-movil-375-respuesta-inicial-full.png`, `320-alumno-teclado-tras-respuesta-inicial-1024.png`.

#### D17 — `<title>` genérico en 14 pantallas · **Media**
- **Pantallas:** Aulas, Aula (3 pestañas), Actividad (3 pestañas), Trabajo del alumno (4 pestañas), Radiografía, ficha del alumno (`/app/alumnos/…`), `/app` sin espacio y 404.
- **Obtenido:** todas usan «Aula Socrática — un tutor que pregunta en vez de responder», igual que la landing; en cambio Inicio, Crear con IA, Mis tutores, Informes o Mi espacio sí tienen título propio. Con varias pestañas abiertas (aula, actividad, alumno) el docente no las distingue, y un lector de pantalla no anuncia la página (WCAG 2.4.2).
- **Solución sugerida:** «El agua en la montaña · En vivo · Aula Socrática», «Ana Pérez · El agua en la montaña · Aula Socrática», etc.
- **Evidencia:** `scripts/data/barrido-320_375_390_430_768_1024_1440.json` (campo `title`).

#### D18 — `aria-current="page"` incorrecto · **Media**
- **Pantalla:** todas las pantallas de `/app`.
- **Obtenido:** el logo («Aula Socrática, inicio») y «Inicio» llevan `aria-current="page"` en todas las pantallas, además del ítem real (por ejemplo en Aulas: logo, Inicio, Aulas y la pestaña «Activas»). Un lector de pantalla anuncia «Inicio, página actual» estando en Mis tutores.
- **Solución sugerida:** activar con coincidencia exacta para `/app` (`activeOptions: { exact: true }`) y no marcar el logo.
- **Evidencia:** `scripts/data/barrido-320_375_390_430_768_1024_1440.json` (campo `ariaCurrent`).

#### D19 — Estados contradictorios en En vivo y en el trabajo · **Baja**
- **Obtenido:** (a) la tarjeta «Trabajando ahora: 0» y el filtro «Trabajando 1» (que muestra a Ana «Abandonada, última acción hace 30 min»); (b) en el trabajo de Ana se ven a la vez «En curso» y «Abandonada»; (c) la etapa «Charla con el tutor 1/3» (barra con 1 de 3 segmentos) mientras el alumno ve «Paso 2 de 3: Conversación»; en una actividad sin respuesta inicial, «0/2» para el paso 1 de 2; (d) a Carla, terminada por el docente, el alumno ve el paso 3 «Cierre» sin marcar como hecho y el docente ve «Terminó 3/3».
- **Solución sugerida:** un solo vocabulario de estados (Activo / Sin actividad / Abandonada / Terminó) en tarjetas, filtros y fichas; etapa como «Etapa 2 de 3: Charla con el tutor».
- **Evidencia:** `156-en-vivo-filtro-trabajando-1440.png`, `B-sesion-evaluacion-320.png`, `32-docente-en-vivo-3-alumnos-1440.png`, `132-alumno-terminado-por-docente-390.png`.

#### D20 — «Mensajes» con tres valores distintos · **Baja**
- **Obtenido:** para Ana, el mapa de calor dice «Mensajes 4» (solo texto libre), el Trabajo dice «Mensajes del alumno 10» y el PDF anterior decía «8 mensajes del alumno» (todos, incluidos botones de ayuda).
- **Solución sugerida:** llamar «Mensajes escritos» al del mapa de calor o usar la misma definición; agregar la definición en el tooltip.
- **Evidencia:** `32-docente-en-vivo-3-alumnos-1440.png`, `50-sesion-ana-1440.png`, `31-recorrido-ana-perez-p1.png`.

#### D21 — Aulas archivadas ofrecidas como destino · **Baja**
- **Pantalla:** Crear con IA (paso 1), Mis materiales → «Usar en una actividad», Informes → Nuevo informe, filtros de Radiografía.
- **Obtenido:** «Aula doble click» (archivada) aparece como cualquier otra, sin «(archivada)». Una actividad creada y publicada ahí no recibe alumnos.
- **Solución sugerida:** excluirlas o agruparlas bajo «Archivadas».
- **Evidencia:** `165-materiales-usar-en-actividad-1440.png`, `180-informes-nuevo-1440.png`, `170-radiografia-modulo-1440.png`.

#### D22 — Mensaje engañoso para un enlace reemplazado · **Baja**
- **Pasos:** «Generar un enlace nuevo» y abrir el enlace anterior.
- **Obtenido:** «¿Seguro que es este enlace? No encontramos esta actividad. Revisá que el enlace esté completo…», aunque el enlace está completo; los alumnos que tenían la pestaña abierta quedan consultando cada pocos segundos con 404 en consola.
- **Solución sugerida:** «Este enlace ya no funciona: tu docente generó uno nuevo. Pedíselo.»
- **Evidencia:** `141-enlace-viejo-375.png`.

#### D23 — Error 404 de aula o trabajo con «Reintentar» · **Baja**
- **Pasos:** abrir `/app/aulas/no-existe` o `/app/sesiones/xyz` (o un ID de otro espacio).
- **Obtenido:** «No se pudo cargar — El aula no existe o no tenés acceso — Reintentar». Reintentar no sirve; la actividad y el informe sí ofrecen «Ir a mis aulas» / «Volver a Informes».
- **Solución sugerida:** acción de salida coherente («Ir a mis aulas»). (El acceso cruzado entre espacios está bien bloqueado.)
- **Evidencia:** `221-id-inexistente-1440.png`, `220-otro-espacio-deep-link-aula-1440.png`.

#### D24 — PDF del informe con encabezados cortados · **Baja**
- **Obtenido:** en «Participación por actividad» y «Ayudas pedidas por tipo» los encabezados se parten a mitad de palabra: «Finalizaro / n», «Ejemp / los».
- **Solución sugerida:** anchos mínimos de columna o `hyphens: auto` con idioma `es`, o abreviar.
- **Evidencia:** `182-informe-pdf-p1.png`, `182-informe-Informe_grupal_-_5._B_-_Ciencias_Naturales_5._grado_B.pdf`.

#### D25 — Formatos de hora · **Baja**
- **Obtenido:** «Creado el 21 oct, 12:57 a. m.. Borrador» y «entre las 12:41 a. m. y las 01:11 a. m..» (doble punto); en el mismo mapa de calor las columnas usan 24 h («00:41»).
- **Solución sugerida:** no agregar punto tras «a. m.»; un único formato (en Argentina, 24 h es lo habitual).
- **Evidencia:** `184-informe-validado-1440.png`, `310-heatmap-actividad-en-el-tiempo-1440.png`.

#### D26 — El nombre del alumno se transforma · **Baja**
- **Pasos:** entrar como «maría de los ángeles MCDONALD».
- **Obtenido:** «María De Los Ángeles Mcdonald» (partículas en mayúscula, apellido alterado). Para recuperar con código no importa (acepta «ana perez»), pero el docente ve un nombre que el alumno no escribió.
- **Solución sugerida:** respetar lo escrito (solo recortar espacios) o capitalizar solo si todo está en minúsculas, sin tocar «de/del/los/la».
- **Evidencia:** `283-alumno-nombre-capitalizado-1440.png`.

#### D27 — Botón de cierre de toasts en inglés · **Baja**
- **Obtenido:** todos los toasts tienen un botón con nombre accesible «Close toast».
- **Solución sugerida:** configurar la etiqueta («Cerrar aviso»).
- **Evidencia:** `04-aula-creada-1440.png` (botón «×» del toast).

#### D28 — Administración: desborde, sin h1 y texto impreciso · **Baja**
- **Obtenido:** a 375 px el panel mide 1081 px de ancho y corta textos («Sin nombres ni contenido:» cortado); axe `page-has-heading-one`; el encabezado dice «Vista de solo lectura» pero cada espacio tiene «Suspender» (con buena confirmación).
- **Solución sugerida:** tablas con scroll propio; `h1` «Administración»; texto «Vista para supervisar y frenar abusos».
- **Evidencia:** `213-admin-375.png`, `211-admin-panel-1440.png`, `212-admin-suspender-confirmar-1440.png`.

#### D29 — Estado viejo tras cerrar sesión o borrar el espacio · **Baja**
- **Pasos:** Mi espacio → «Cerrar sesión» (o «Borrar mi espacio» → BORRAR).
- **Obtenido:** redirige a la landing, que muestra «Mi espacio» arriba y «Abrir mi espacio» como botón principal (junto al toast «Sesión cerrada en este dispositivo»). Tras borrar el espacio no hay ningún aviso de confirmación. Al recargar se corrige.
- **Solución sugerida:** invalidar la caché de sesión antes de navegar; toast «Tu espacio se borró».
- **Evidencia:** `301-espacio-borrado-1440.png`, `342-tras-cerrar-sesion-1440.png`, `302-landing-tras-borrar-recarga-1440.png`.

#### D30 — «Argumentación · Argumentación» · **Baja**
- **Pantalla:** Configuración → «Usar un tutor de «Mis tutores»».
- **Obtenido:** cada opción repite nombre y tipo cuando son iguales (18 opciones).
- **Solución sugerida:** mostrar el tipo solo si el nombre es distinto («Tutor de la auditoría · Pensamiento crítico»).
- **Evidencia:** `06-editor-actividad-1440.png`.

#### D31 — Metadatos redundantes en la entrada del alumno · **Baja**
- **Obtenido:** «Ciencias Naturales · 5.º B — Ciencias Naturales · 5.º grado B · Escuela N.º 12 Domingo F. Sarmiento» (la materia aparece dos veces; en 375 px ocupa 3 líneas).
- **Solución sugerida:** mostrar materia y curso sin repetir el nombre del aula cuando lo contiene.
- **Evidencia:** `20-alumno-entrada-1440.png`, `241-alumno-ve-nombre-docente-390.png`.

#### D32 — Validaciones inconsistentes · **Baja**
- **Obtenido:**
  - «Confirmar evaluación» sin niveles: el error («Elegí un nivel.») llega tras un 400 del servidor (error en consola) y queda visible después de pedir la sugerencia de IA.
  - «Validar informe» incompleto: solo un toast «Completá todas las secciones…», sin marcar los campos (400 en consola).
  - Crear cuenta con correo inválido: no hay mensaje propio; aparece el globo nativo del navegador (otro estilo e idioma del sistema).
  - Rúbrica con criterio sin nombre: el campo se marca, pero el foco queda en el botón «Guardar cambios».
  - Muchos botones principales están deshabilitados hasta completar el formulario sin explicar qué falta («Crear aula», «Crear tutor», «Entrar a la actividad», «Crear contraseña nueva», «Agregar a la actividad»).
- **Solución sugerida:** validación en el cliente con el mismo componente de error, foco al primer campo inválido y botones habilitados.
- **Evidencia:** `52-evaluacion-confirmar-vacia-1440.png`, `52-evaluacion-sugerencia-ia-1440.png`, `184-informe-validado-1440.png`, `191-cuenta-correo-invalido-sin-mensaje-1440.png`, `09-rubrica-guardar-criterio-vacio-1440.png`.

#### D33 — Concordancia en «Agregar alumnos» · **Baja**
- **Obtenido:** «Se agregaron 2. 1 ya estaban en la lista.»
- **Solución sugerida:** «1 ya estaba en la lista».
- **Evidencia:** `293-agregar-alumnos-lista-1440.png` (toast posterior).

#### D34 — Palabras de confirmación inconsistentes · **Baja**
- **Obtenido:** «Eliminar para siempre» y «Eliminar trabajo» piden escribir «BORRAR»; «Reiniciar» pide «REINICIAR» (y acepta «reiniciar»). Mezcla de verbos Eliminar/Borrar en la misma acción.
- **Solución sugerida:** escribir el mismo verbo que el botón («ELIMINAR») o usar siempre «Borrar».
- **Evidencia:** `260-eliminar-actividad-confirmar-1440.png`, `311-eliminar-trabajo-confirmar-1440.png`, `120-reiniciar-confirmar-1440.png`.

#### D35 — Archivo dañado: contador y «Reintentar» · **Baja**
- **Obtenido:** un PDF dañado queda en la lista con «No pudimos abrir este PDF. Puede estar dañado o protegido con contraseña» y botón «Reintentar» (que no puede funcionar), y cuenta en «7 de 20 archivos».
- **Solución sugerida:** acción «Quitar» y «Subir otra versión»; no contarlo en el límite.
- **Evidencia:** `07-material-invalidos-lista-1440.png`.

#### D36 — Ícono de «Terminar» parece una casilla · **Baja**
- **Obtenido:** «Terminar para todos» (En vivo) y «Terminar» (Trabajo) usan un cuadrado vacío, que se lee como checkbox.
- **Solución sugerida:** ícono de bandera/stop relleno o sin ícono.
- **Evidencia:** `32-docente-en-vivo-3-alumnos-1440.png`, `50-sesion-ana-1440.png`.

#### D37 — Objetivos táctiles menores a 44 px · **Baja**
- **Obtenido (375 px):** migas de pan («Aulas» 34×17–20 px), «Ver aulas» (58×20), pestañas Activas/Archivadas (32 px de alto), chips de duración «40/60/80/120 min» (36 px), menús «⋯» y lápiz (40×40), interruptores (48×28), etiquetas de Mis materiales (36 px). Cumplen el mínimo AA de 24 px, pero no la recomendación de 44 px para uso táctil.
- **Solución sugerida:** área táctil mínima de 44 px (padding o pseudo-elemento).
- **Evidencia:** `scripts/data/barrido-320_375_390_430_768_1024_1440.json` (campo `smallTargets`).

#### D38 — Pantalla de actividad cerrada · **Baja**
- **Obtenido:** (a) un alumno que ya había terminado (Bruno) pierde acceso a su pantalla «¡Terminaste la actividad!» y a su código mientras el docente tiene cerrada la actividad; (b) el alumno que estaba escribiendo cuando se cerró ve «Tu docente cerró esta actividad por ahora» sin aviso de que su mensaje no se envió (el texto se conserva y reaparece al reabrir, lo que está bien, pero no se le dice).
- **Solución sugerida:** permitir ver el trabajo terminado en modo lectura; «Tu último mensaje no se envió; lo guardamos para cuando se reabra».
- **Evidencia:** `71-alumno-actividad-cerrada-390.png`, `45-alumno-terminado-375.png`.

#### D39 — 404 sin h1 y con logo duplicado · **Baja**
- **Obtenido:** la 404 no tiene `h1` (axe `page-has-heading-one`, `region`) y dentro de `/app` muestra el logo del shell y otro logo propio.
- **Evidencia:** `00-explorar-no-existe-esta-ruta-1440.png`, `221-id-inexistente-1440.png`.

#### D40 — Request residual tras eliminar una actividad · **Baja**
- **Obtenido:** después de «Eliminar para siempre» la app redirige al aula y luego hace `GET /api/activities/<id>/files` → 404 (error en consola).
- **Solución sugerida:** cancelar/invalidar las consultas de la actividad borrada antes de navegar.
- **Evidencia:** registro del driver (paso «Eliminar actividad»), `260-eliminar-actividad-confirmar-1440.png`.

---

## 4. Propuestas de mejora (no son defectos), ordenadas por impacto

1. **PDF del recorrido a la vista y en lote.** En escritorio la descarga está escondida en «⋯» (en móvil hay botón «PDF»). Poner «PDF» visible en cada fila y agregar «Descargar todos (ZIP/PDF)» en En vivo; es un pedido central del cliente.
2. **Último paso de Crear con IA completo.** «Revisar y crear» no muestra ni deja cambiar Respuesta inicial, Voz ni Rúbrica antes de «Crear y publicar»: se publica con la respuesta inicial activa sin que el docente lo decida.
3. **Un solo modelo de «tutor».** Hoy conviven «Tipo de tutor», «Mis tutores», «Usar un tutor de Mis tutores» y «Indicaciones para el tutor» (que recibe un bloque largo con Dificultad/Objetivos/Criterios al aplicar un tutor). Proponer un único selector agrupado (Enfoques / Formatos / Míos) con marca «Editado» y el campo de indicaciones propio separado del bloque copiado.
4. **Alumno en celular: tarea primero.** Consigna corta + campo de respuesta arriba; material y archivos en un acordeón «Material (6)»; aviso del código colapsable después de guardar la primera idea.
5. **Confirmación al enviar el trabajo final.** «Enviar mi trabajo» es irreversible y se envía sin confirmar; un diálogo breve o una ventana de 1–2 minutos para corregir evitaría envíos accidentales.
6. **Botones habilitados + mensajes en línea** en lugar de botones grises sin explicación (ver D32).
7. **Volver a la página original tras ingresar.** Hoy siempre lleva a `/app`; conservar `?volver=`.
8. **Errores que dicen cómo resolver.** «pesa más de 60 MB» → «Comprimilo o dividilo (por ejemplo, con…)»; «.xlsx no se acepta» → «Exportalo a PDF».
9. **Enlaces sin https://.** Autocompletar `https://` en Mis materiales (hoy rechaza «es.wikipedia.org/…»).
10. **Pestaña «Alertas» del aula.** Es configuración, no un listado: renombrarla «Configurar alertas» y sumar el historial de alertas del aula.
11. **Toasts que no tapen el título.** Aparecen arriba al centro sobre migas de pan y título; moverlos abajo a la derecha (o abajo en móvil, por encima de la barra).
12. **Chips de ayuda del alumno en móvil.** Hoy se desplazan en horizontal y «¿Podés darme un ejemplo?» queda cortado; permitir dos filas o indicar que hay más.
13. **«Restaurar original»** también en el menú de cada tarjeta de Mis tutores (hoy solo dentro del diálogo, en «Más acciones»).
14. **Antes de reiniciar o eliminar**, ofrecer «Descargar los PDF/CSV primero».
15. **Primeros pasos**: el paso 2 dice «a partir de un PDF o una foto»; agregar «o un Word».
16. **Glosario en En vivo** (tooltip en cada estado y métrica), para que «Trabajando», «Activo» y «Mensajes» signifiquen lo mismo en todas partes.
17. **Inicio sin nombre.** El saludo «Hola» y la tarjeta «¿Cómo querés que te llamemos?» compiten con el aviso «Tu espacio está guardado solo en este dispositivo»; mostrar uno a la vez.

---

## 5. Resumen de accesibilidad

**axe-core 4.14.0** (pantalla completa, 375 y 1440 px; mismas violaciones en ambos tamaños salvo donde se indica):

| Pantalla | Violaciones (id · impacto · nodos) |
|---|---|
| Landing, Ingresar, Recuperar, Privacidad, Admin (login) | sin violaciones |
| Administración (panel) | `page-has-heading-one` · moderate · 1 |
| 404 | `page-has-heading-one` · moderate · 1; `region` · moderate · 1 |
| `/app` sin espacio, Token inválido | sin violaciones |
| Alumno: entrada | `region` · moderate · 1 (contenido fuera de landmarks) |
| Alumno: chat, terminado, móvil tras entrar | sin violaciones |
| Inicio, Aulas, Aula → Actividades | sin violaciones |
| Aula → Alumnos | `color-contrast` · serious · 3 |
| Aula → Alertas | `color-contrast` · serious · 12 |
| Actividad → Configuración, Compartir, En vivo | sin violaciones |
| Trabajo → Recorrido | `landmark-unique` · moderate · 1 (solo 1440) |
| Trabajo → Conversación | `color-contrast` · serious · 20 |
| Trabajo → Evaluación, Radiografía | sin violaciones |
| Ficha del alumno | sin violaciones |
| Crear con IA | sin violaciones |
| Mis tutores | `label-content-name-mismatch` · serious · 19 |
| Mis materiales | `heading-order` · moderate · 1 |
| Radiografía, Informes, Informe, Mi espacio | sin violaciones |
| Diálogos «Nueva aula» y «Reiniciar actividad» | sin violaciones |

**Hallazgos manuales (no los detecta axe):**
- Foco perdido al cerrar diálogos (D05) y foco no dirigido tras entrar como alumno (D16) — WCAG 2.4.3.
- `<title>` genérico en 14 pantallas (D17) — WCAG 2.4.2.
- `aria-current="page"` en «Inicio» y logo en todas las pantallas (D18).
- «Close toast» en inglés (D27) — WCAG 3.1.2.
- Varios botones «Cambiar» idénticos en «Revisar y crear» de Crear con IA, sin indicar qué cambian (WCAG 2.4.6).
- Objetivos táctiles < 44 px (D37).
- Positivo: enlace «Saltar al contenido» funcional; foco visible en los controles recorridos con Tab; atrapado de foco correcto dentro de los diálogos; Escape cierra diálogos y menús; menús con flechas; pestañas con flechas; regiones `aria-live` para contadores, subida de archivos y respuestas del tutor; Enter envía y Shift+Enter hace salto de línea; el ingreso del alumno, la primera idea y el chat se pueden hacer solo con teclado; nombres hostiles (`<img onerror>`, `<script>`) se muestran escapados sin ejecutarse.

---

## 6. Matriz de cobertura

Leyenda: ✔ = sí / sin problemas · ✘ = problema (ver ID) · P = parcial · — = no aplica.
«Controles ejercitados» = se usaron todos los botones, menús, pestañas y formularios visibles (válido e inválido donde aplica).

| Pantalla / estado | Abierta | Controles ejercitados | Móvil ok (320–430) | Escritorio ok (768–1440) | axe ok |
|---|---|---|---|---|---|
| Landing `/` | ✔ | ✔ | ✔ | ✔ (D29 tras cerrar sesión) | ✔ |
| Ingresar | ✔ | ✔ | ✔ | ✔ | ✔ |
| Recuperar cuenta | ✔ | ✔ | ✔ | ✔ | ✔ |
| Privacidad | ✔ | ✔ (índice) | ✔ | ✔ | ✔ |
| Administración: login | ✔ | ✔ (1 intento fallido + correcto) | ✔ | ✔ | ✔ |
| Administración: panel | ✔ | P (Suspender cancelado) | ✘ D28 | ✔ | ✘ D28 |
| 404 | ✔ | ✔ | ✔ | ✔ | ✘ D39 |
| `/app` sin espacio | ✔ | ✔ | ✔ | ✔ | ✔ |
| Clase: token inválido / enlace viejo | ✔ | ✔ | ✔ (D22) | ✔ | ✔ |
| Alumno: entrada | ✔ | ✔ | ✔ (D31) | ✔ | ✘ region |
| Alumno: código para continuar | ✔ | ✔ (D12) | ✔ | ✔ | — |
| Alumno: primera idea | ✔ | ✔ (D06) | ✘ D16 | ✔ | ✔ |
| Alumno: chat + ayudas + voz | ✔ | ✔ (dictado: solo error de permiso) | ✔ | ✔ | ✔ |
| Alumno: cierre (final + reflexión) | ✔ | ✔ | ✔ | ✔ | — |
| Alumno: terminado | ✔ | ✔ | ✔ | ✔ | ✔ |
| Alumno: cerrada / archivada / programada / terminada por docente | ✔ | ✔ | ✔ (D38) | ✔ | — |
| Inicio | ✔ | ✔ | ✘ D03 | ✔ | ✔ |
| Aulas (Activas/Archivadas) | ✔ | ✔ | ✔ (D37) | ✔ | ✔ |
| Aula → Actividades | ✔ | ✔ | ✔ | ✔ (D11) | ✔ |
| Aula → Alumnos | ✔ | ✔ | ✔ | ✔ | ✘ D14 |
| Aula → Alertas (configuración) | ✔ | P (no se cambiaron los interruptores) | ✔ | ✔ | ✘ D14 |
| Actividad → Configuración | ✔ | ✔ | ✘ D09 | ✔ | ✔ |
| Actividad → Compartir | ✔ | ✔ (Compartir… nativo no verificable) | ✔ | ✔ | ✔ |
| Actividad → En vivo | ✔ | ✔ | ✔ | ✘ D13 (1024) | ✔ |
| Trabajo → Recorrido | ✔ | ✔ | ✔ | ✔ (D07) | ✘ landmark-unique |
| Trabajo → Conversación | ✔ | ✔ | ✔ | ✔ | ✘ D14 |
| Trabajo → Evaluación | ✔ | ✔ | ✔ | ✔ | ✔ |
| Trabajo → Radiografía | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ficha del alumno (`/app/alumnos/…`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Crear con IA (6 pasos) | ✔ | ✔ | ✔ | ✔ (D01) | ✔ |
| Mis tutores (+ diálogos) | ✔ | ✔ | ✔ | ✔ (D04) | ✘ D15 |
| Mis materiales | ✔ | ✔ | ✔ | ✔ | ✘ heading-order |
| Radiografía | ✔ | ✔ | ✔ | ✔ | ✔ |
| Informes (lista + nuevo) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Informe (detalle, PDF, CSV) | ✔ | ✔ | ✔ | ✔ (D24, D25) | ✔ |
| Mi espacio (cuenta, código, cerrar sesión, borrar) | ✔ | ✔ | ✔ | ✔ (D02, D29) | ✔ |

---

## Anexo — Cómo reproducir

```bash
cd docs/informes/auditoria-ui/scripts
node 00-generar-archivos.mjs          # archivos de prueba (PDF 200 págs., Word, fotos, audio, inválidos)
node 20-reproducir-defectos.mjs       # reproduce D01, D02, D03, D04, D05, D06 y D12 en un espacio nuevo
node 10-barrido-responsive.mjs        # barrido 30 pantallas × 7 viewports (requiere scripts/data/*.json de una sesión previa)
node 11-resumen-barrido.mjs           # tablas de desborde, axe, títulos y objetivos táctiles
```

`10-barrido-responsive.mjs` usa los estados guardados en `scripts/data/` (`docente-state.json`, `alumno-ana-state.json`, `alumno-bruno-state.json`, `ids.json`), generados durante esta auditoría; para otro entorno, crear primero un espacio con actividad y alumnos (o adaptar `ids.json`).
