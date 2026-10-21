# Informe de diseño (UI/UX)

## Punto de partida

El prototipo tenía una identidad reconocible que valía la pena conservar: el logo (burbuja de diálogo azul marino con
un signo de pregunta lila cuyo punto es una hoja verde), el azul profundo con violeta suave sobre neutros fríos, y la
pareja tipográfica Fraunces + Figtree. Lo que se veía improvisado era todo lo demás: el aspecto de plantilla de
componentes por defecto, la barra lateral oscura de tablero genérico, jerarquías planas, chips de estado con contraste
insuficiente (4,03:1 y 3,32:1), ningún cierre de sesión en móvil, estados vacíos que aparecían cuando en realidad había
un error, y textos que prometían cosas que la app no hacía.

## Dirección

**Tema:** una herramienta para docentes argentinos de primaria y secundaria cuyo valor diferencial es que *la IA
pregunta en vez de responder* y que el docente puede ver *cómo cambia lo que piensa cada alumno*.

**Firma visual:** el signo de pregunta. Las preguntas del tutor se muestran en Fraunces itálica con un "?" lila colgado
en el margen (clase `.q-hang`), y el trabajo de cada alumno se dibuja como un **recorrido** vertical (clase `.thread`):
primera idea → preguntas del tutor → lo que respondió → respuesta final, con el punto final en verde hoja ("logrado").
Ese mismo lenguaje aparece en la portada (ejemplo rotulado como ilustrativo), en la pestaña Recorrido y en el PDF.

Todo lo demás es deliberadamente sobrio: superficies blancas sobre papel frío, bordes finos, sombras mínimas, un solo
color de acción (azul tinta) y el lila solo para lo que tiene que ver con preguntas y sugerencias de IA.

## Sistema de diseño (`src/client/styles.css`, `src/client/components/ui`)

| Token | Valor | Uso |
|---|---|---|
| `ink` | #14295C | Acción principal, títulos, texto de marca (13,9:1 sobre blanco) |
| `lilac` / `lilac-ink` | #9B87E8 / #5B45B8 | Decorativo (signo de pregunta) / texto de IA y acentos (7,0:1) |
| `leaf` | #3F6B22 | "Terminó", "logrado" (6,3:1; 5,4:1 sobre su fondo suave) |
| `amber`, `rose` | #85570A, #B4232F | Avisos y errores (≥ 5,5:1 sobre sus fondos) |
| `paper`, `surface`, `sunken`, `line` | #F6F7FB, #FFF, #EEF0F7, #DDE1EC | Fondos y separadores |
| `text`, `text-2`, `text-3` | #172036, #4B5470, #646C88 | Texto (≥ 4,8:1 sobre papel) |
| Radios | 8 / 12 / 16 / 22 px | Controles / tarjetas / diálogos / burbujas |
| Tipografía | Fraunces (títulos y preguntas del tutor), Figtree (interfaz) | Autoalojadas, subconjunto latino, `font-display: swap` con fuentes de respaldo ajustadas en métricas (sin saltos de diseño) |

Componentes propios (sobre primitivas accesibles de Radix): `Button` (5 variantes, estado de carga), `Field` (label +
ayuda + error enlazados por `aria-describedby`), `Input`, `Textarea` (crece con el texto), `Select` (nativo
estilizado: en el celular abre el selector del sistema), `Dialog` (hoja inferior en el celular, centrado en
escritorio, devuelve el foco al cerrar), `ConfirmDialog` (las acciones irreversibles grandes piden escribir una
palabra), `Tabs` (los paneles no se desmontan: cambiar de pestaña nunca pierde lo escrito), `Switch`, `Checkbox`,
`Menu`, `CopyButton`, `Badge`, `Card`, `PageHeader`, `EmptyState`, `ErrorState` (con reintento), `Skeleton`, `Notice`,
`Stat`.

Estados en todas las pantallas: cargando (esqueletos), vacío con una acción concreta, error con explicación y
"Reintentar", éxito con un aviso que repite el verbo del botón ("Guardar cambios" → "Cambios guardados").

## Mobile first

- Diseñado a 375 px y probado a 320, 375, 390, 430, 768, 1024 y 1440 px (auditoría con Playwright, 7 anchos × 30 pantallas).
- En el celular: barra superior con logo y "Mi espacio", barra inferior con Inicio, Aulas, Crear, Tutores y "Más";
  diálogos como hojas inferiores; tablas que se convierten en tarjetas; áreas táctiles de 44 px; áreas seguras (`safe-area-inset`).
- En escritorio: barra lateral clara (no un tablero oscuro genérico) con el espacio del docente abajo.
- Ninguna acción depende de pasar el mouse por encima.
- El chat del alumno: el cuadro de texto queda sobre el teclado del celular, nunca se pierde lo escrito (aunque el tutor
  esté respondiendo o falle la conexión), y la respuesta aparece a medida que se genera.

## Decisiones de experiencia

- **Sin fricción de entrada:** un botón crea el espacio del docente; el alumno solo escribe su nombre. La cuenta es un
  agregado opcional, explicado en "Mi espacio".
- **Honestidad:** todo lo que propone la IA aparece como "Sugerencia de la IA" y lo confirma el docente; las citas que no
  aparecen en lo que escribió el alumno se descartan solas; si la IA no está disponible lo dice un aviso arriba en vez
  de fallar botón por botón.
- **Vocabulario del docente, no del sistema:** "Aceptar alumnos" en vez de "enlace activo"; "Reiniciar actividad" con
  explicación de qué se borra y qué se conserva; "Permitir continuar" en vez de "reabrir sesión".
- **Lo pedido por WhatsApp quedó visible donde se usa:** filtro "Mostrar alumnos de [actividad]" en el aula, interruptor
  "Pedir una respuesta inicial" en la actividad, "Descargar PDF del recorrido" en En vivo y en el trabajo, subida de PDF,
  foto o Word dentro de "Crear con IA", y los 18 tutores precargados en "Mis tutores".

## Accesibilidad (referencia WCAG 2.2 AA)

Labels reales en todos los campos, foco visible lila, navegación completa con teclado, `aria-live` para resultados
asíncronos (el chat anuncia la respuesta cuando termina, no cada palabra), contraste ≥ 4,5:1 con los tokens, el "?"
decorativo oculto a lectores de pantalla, `prefers-reduced-motion` respetado, idioma `es-AR`. Los resultados de axe-core
por pantalla están en el informe de la auditoría UI/UX.
