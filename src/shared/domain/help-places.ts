// Where everything is, for the help assistant ("¿Dónde está…?"). The AI picks one of these ids and
// the client takes the teacher there and lights up the element marked data-tour="<target>".
// Keep in step with the shell (components/app/shell.tsx) and the screens that carry the targets.

export type HelpScope = "activity" | "classroom" | "session";

export interface HelpPlace {
  id: string;
  /** Short name, shown on the "Llevame" button. */
  name: string;
  /** Where it is, in the app's words (for the assistant's prompt). */
  where: string;
  /** A screen of its own; omitted when it lives on every screen (search, theme). */
  to?: string;
  /** It lives inside one activity, classroom or student work: used when that screen is open. */
  scope?: HelpScope;
  /** Tab to open inside the scoped screen (the screen's ?tab=). */
  tab?: string;
  target: string;
  /** When the scoped screen is not open: where to go instead and what to light up. */
  fallback?: { to: string; target: string };
}

const OPEN_ACTIVITY = { to: "/app/actividades", target: "lista-actividades" };
const OPEN_CLASSROOM = { to: "/app/aulas", target: "lista-aulas" };

export const HELP_PLACES: HelpPlace[] = [
  { id: "inicio", name: "Inicio", to: "/app", target: "nav-inicio", where: "Menú de la izquierda › Inicio. Resumen del día: qué conviene hacer, clases en curso, lo que hay para revisar y tus aulas." },
  { id: "buscar", name: "Buscar", target: "buscar", where: "Arriba del menú, «Buscar» (o Ctrl K): encuentra aulas y actividades y abre cualquier sección." },
  { id: "aulas", name: "Aulas", to: "/app/aulas", target: "nav-aulas", where: "Menú › Aulas: la lista de aulas (un aula por curso)." },
  { id: "nueva_aula", name: "Nueva aula", to: "/app/aulas", target: "nueva-aula", where: "El «+» al lado de Aulas en el menú, o el botón «Nueva aula» en Aulas." },
  { id: "actividades", name: "Actividades", to: "/app/actividades", target: "nav-actividades", where: "Menú › Preparar › Actividades: todas las actividades de todas las aulas, con filtros." },
  { id: "nueva_actividad", name: "Nueva actividad", to: "/app/actividades", target: "nueva-actividad", where: "Actividades › «Nueva actividad» (en blanco), o dentro de un aula › «Nueva actividad»." },
  { id: "crear_con_ia", name: "Crear con IA", to: "/app/actividades", target: "crear-ia", where: "Actividades › «Crear con IA»: subís un PDF, una foto o un texto y la IA propone actividades." },
  { id: "tutores", name: "Mis tutores", to: "/app/tutores", target: "nav-tutores", where: "Menú › Preparar › Mis tutores: los tutores incluidos y los propios (cómo pregunta la IA)." },
  { id: "materiales", name: "Mis materiales", to: "/app/materiales", target: "nav-materiales", where: "Menú › Preparar › Mis materiales: la biblioteca de archivos y enlaces para reusar." },
  { id: "en_vivo", name: "En vivo", to: "/app/en-vivo", target: "nav-en-vivo", where: "Menú › En clase › En vivo: las actividades con alumnos trabajando ahora." },
  { id: "para_revisar", name: "Para revisar", to: "/app/alertas", target: "nav-revisar", where: "Menú › Revisar › Para revisar: los avisos del tutor de todas las aulas, con filtros, para marcarlos como vistos." },
  { id: "radiografia", name: "Radiografía", to: "/app/radiografia", target: "nav-radiografia", where: "Menú › Revisar › Radiografía: cómo piensa la clase en una actividad." },
  { id: "informes", name: "Informes", to: "/app/informes", target: "nav-informes", where: "Menú › Revisar › Informes: informes en PDF por actividad o por alumno." },
  { id: "cuenta", name: "Mi cuenta", to: "/app/cuenta", target: "nav-cuenta", where: "Abajo en el menú, tu nombre › Mi cuenta: cuenta, contraseña, Google, código de recuperación, habilidades que evalúa la IA." },
  { id: "modo_oscuro", name: "Modo claro u oscuro", target: "tema", where: "Abajo en el menú, el botón de la luna (en el celular, en «Más»)." },
  { id: "recorrido", name: "Recorrido guiado", target: "recorrido", where: "Abajo en el menú, «Recorrido guiado» (en el celular, en «Más»): muestra de nuevo el recorrido de la pantalla." },
  { id: "pedidos", name: "Pedidos de cambios", to: "/app/pedidos", target: "nav-pedidos", where: "Menú › Pedidos de cambios (solo si el equipo lo habilitó): contarle al equipo qué cambiarías." },

  { id: "actividad_preparar", name: "Preparar", scope: "activity", tab: "configuracion", target: "paso-preparar", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad, paso 1 «Preparar»: consigna, objetivos, material, tutor, respuestas, voz, rúbrica, reflexión, mensaje final, entrega y devolución de la IA." },
  { id: "publicar", name: "Publicar", scope: "activity", tab: "configuracion", target: "accion-principal", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad en borrador, el botón «Publicar» arriba a la derecha (activa el enlace para los alumnos)." },
  { id: "compartir_enlace", name: "Compartir", scope: "activity", tab: "compartir", target: "paso-compartir", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad publicada, paso 2 «Compartir»: el enlace, el código y el QR para los alumnos." },
  { id: "actividad_en_vivo", name: "En vivo", scope: "activity", tab: "en-vivo", target: "paso-en-vivo", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad, paso 3 «En vivo»: el progreso de cada alumno mientras trabaja." },
  { id: "actividad_revisar", name: "Revisar", scope: "activity", tab: "fortalezas", target: "paso-revisar", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad, paso 4 «Revisar»: habilidades y fortalezas del grupo, «Elegir habilidades» y «Reevaluar habilidades»." },
  { id: "actividad_avisos", name: "Avisos", scope: "activity", tab: "alertas", target: "paso-avisos", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad, «Avisos» (al lado de los 4 pasos): los avisos del tutor sobre esa actividad." },
  { id: "actividad_menu", name: "Más acciones", scope: "activity", target: "mas-acciones", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad, el botón «⋯» arriba a la derecha: duplicar, volver a borrador, reiniciar, archivar, eliminar." },

  { id: "aula_alumnos", name: "Alumnos", scope: "classroom", tab: "alumnos", target: "aula-alumnos", fallback: OPEN_CLASSROOM, where: "Dentro de un aula, pestaña «Alumnos»: la lista, cargar alumnos, divisiones, corregir nombres." },
  { id: "aula_avisos", name: "Qué te avisa el tutor", scope: "classroom", tab: "alertas", target: "aula-alertas", fallback: OPEN_CLASSROOM, where: "Dentro de un aula, pestaña «Qué te avisa el tutor»: las alertas que detecta el tutor en esa aula y las propias." },
  { id: "compartir_aula", name: "Compartir aula", scope: "classroom", target: "compartir-aula", fallback: OPEN_CLASSROOM, where: "Dentro de un aula, el botón «Compartir» (al lado de «Nueva actividad»): sumar a otro docente con un rol." },
  { id: "aula_nueva_actividad", name: "Nueva actividad", scope: "classroom", target: "nueva-actividad", fallback: OPEN_CLASSROOM, where: "Dentro de un aula, el botón «Nueva actividad»." },

  { id: "classroom_conectar", name: "Google Classroom", to: "/app/cuenta", target: "classroom-cuenta", where: "Mi espacio › Google Classroom: conectar o desconectar la cuenta de Google para usar Classroom." },
  { id: "classroom_tarea", name: "Subir a Classroom", scope: "activity", tab: "compartir", target: "classroom", fallback: OPEN_ACTIVITY, where: "Dentro de una actividad publicada, paso 2 «Compartir» › Google Classroom: subirla como tarea a un curso (con puntos y fecha de entrega) y después «Pasar notas a Classroom» con la nota que sale de la rúbrica." },
  { id: "classroom_alumnos", name: "Traer de Classroom", scope: "classroom", tab: "alumnos", target: "aula-alumnos", fallback: OPEN_CLASSROOM, where: "Dentro de un aula › Alumnos › «Traer de Classroom»: suma los alumnos de un curso de Classroom." },

  { id: "trabajo_evaluacion", name: "Evaluación", scope: "session", tab: "evaluacion", target: "trabajo-evaluacion", fallback: { to: "/app/alertas", target: "nav-revisar" }, where: "En el trabajo de un alumno, pestaña «Evaluación»: la rúbrica sugerida por la IA, para confirmar o corregir." },
];

export const HELP_PLACE_IDS = new Set(HELP_PLACES.map((p) => p.id));

export function helpPlace(id: string | null | undefined): HelpPlace | null {
  return HELP_PLACES.find((p) => p.id === id) ?? null;
}

const SCOPE_PATH: Record<HelpScope, RegExp> = {
  activity: /^\/app\/actividades\/[0-9a-f-]{36}\/?$/,
  classroom: /^\/app\/aulas\/[0-9a-f-]{36}\/?$/,
  session: /^\/app\/sesiones\/[0-9a-f-]{36}\/?$/,
};

/** Where "Llevame" goes from the current screen, and what it lights up. */
export function resolvePlace(place: HelpPlace, pathname: string): { href: string | null; target: string; inScope: boolean } {
  if (place.scope) {
    if (SCOPE_PATH[place.scope].test(pathname)) {
      return { href: place.tab ? `${pathname.replace(/\/$/, "")}?tab=${place.tab}` : null, target: place.target, inScope: true };
    }
    const fb = place.fallback!;
    return { href: fb.to, target: fb.target, inScope: false };
  }
  return { href: place.to && place.to !== pathname ? place.to : null, target: place.target, inScope: true };
}
