// "Novedades": a notice every teacher sees once, the first time they open the app after a
// release. The server remembers the last release the teacher saw (teachers.news_seen), so the
// notice never comes back, on any device; after a new release it shows only what is new to them.

export type NewsKey =
  | "alerts"
  | "deliverables"
  | "aspects"
  | "rubric"
  | "links"
  | "tutors"
  | "scans"
  | "english"
  | "consignas"
  | "closing"
  | "ending"
  | "tutorRules"
  | "signin"
  | "google"
  | "skills";

/** Releases in order; adding one shows its items to everyone who has not seen them. */
export const NEWS_RELEASES = ["2026-10-22", "2026-10-22b", "2026-10-22c", "2026-10-23", "2026-10-23b", "2026-10-23c"] as const;
export type NewsRelease = (typeof NEWS_RELEASES)[number];

export interface NewsItem {
  key: NewsKey;
  release: NewsRelease;
  title: string;
  text: string;
  /** Where to try it, when there is one place for it. */
  link?: { to: "/app/alertas"; label: string };
  /** Not shown together with this one (which already tells the same). */
  coveredBy?: NewsKey;
}

export const NEWS_ITEMS: NewsItem[] = [
  {
    key: "alerts",
    release: "2026-10-22",
    title: "Todas las alertas, juntas",
    text: "Un panel con las alertas de todos tus alumnos y aulas, con filtros y para marcarlas como revisadas.",
    link: { to: "/app/alertas", label: "Ver las alertas" },
  },
  {
    key: "deliverables",
    release: "2026-10-22",
    title: "Entregas al terminar",
    text: "El alumno puede subir su trabajo (PDF, foto o documento) o pegar un enlace de Drive, y la IA lo analiza con tu rúbrica. Se ajusta en Configuración de cada actividad.",
  },
  {
    key: "aspects",
    release: "2026-10-22",
    title: "Fortalezas y aspectos a reforzar",
    text: "En qué se destacó cada alumno y el grupo, como la redacción, y qué conviene reforzar, como el uso de los materiales.",
  },
  {
    key: "rubric",
    release: "2026-10-22",
    title: "La rúbrica, a tu manera",
    text: "Borrá la sugerencia de la IA y evaluá vos. Y ahora sugiere niveles pensando en lo que se espera del curso.",
  },
  {
    key: "tutors",
    release: "2026-10-22b",
    title: "Varios tutores en una actividad",
    text: "Combiná hasta tres tipos de tutor, por ejemplo Comprensión lectora y Pensamiento crítico: el alumno habla con un tutor que mezcla los enfoques.",
  },
  {
    key: "links",
    release: "2026-10-22b",
    title: "Entregas con enlace",
    text: "Además de un archivo, el alumno puede pegar un enlace (Drive, Docs, Canva…). Si es de Google y está compartido, la IA lo lee.",
    coveredBy: "deliverables",
  },
  {
    key: "english",
    release: "2026-10-22c",
    title: "Actividades en inglés",
    text: "Elegí «English» al crear la actividad o en Configuración → Idioma: los alumnos la ven en inglés y el tutor les responde en inglés.",
  },
  {
    key: "consignas",
    release: "2026-10-22c",
    title: "Varias consignas",
    text: "Con «Agregar consigna», los alumnos resuelven varias en orden, con el mismo tutor, y escriben una respuesta por consigna.",
  },
  {
    key: "closing",
    release: "2026-10-22c",
    title: "La respuesta final, a tu manera",
    text: "Pedila o no, y cambiá la pregunta «¿Qué pensás ahora?», en Configuración → Respuesta final.",
  },
  {
    key: "scans",
    release: "2026-10-22b",
    title: "Libros escaneados y fotos",
    text: "Si subís páginas de un libro, la IA arma apuntes completos con sus palabras para que el tutor los use.",
  },
  {
    key: "ending",
    release: "2026-10-23",
    title: "Un cierre a tu manera",
    text: "Apagá la reflexión final si no la necesitás, y dejales a tus alumnos un mensaje para leer al terminar, sin nada que responder. En Configuración → Reflexión final y Mensaje final.",
  },
  {
    key: "tutorRules",
    release: "2026-10-23",
    title: "Indicaciones largas para el tutor",
    text: "Ahora entran hasta 4.000 palabras, en un cuadro más grande para leer lo que escribiste.",
  },
  {
    key: "signin",
    release: "2026-10-23",
    title: "Entrá con tu cuenta",
    text: "Si ya tenés cuenta, tocá «Entrar con mi cuenta» desde cualquier dispositivo: lo que hayas hecho en ese dispositivo se suma a tu cuenta.",
    coveredBy: "google",
  },
  {
    key: "skills",
    release: "2026-10-23c",
    title: "Habilidades con niveles y evidencias",
    text: "Fortalezas ahora evalúa cada habilidad en cuatro niveles, con sus indicadores y una cita real de cada alumno, y la página de cada alumno muestra cómo evoluciona. Con «Elegir habilidades» decidís cuáles se evalúan y sumás las tuyas.",
  },
  {
    key: "google",
    release: "2026-10-23b",
    title: "Entrá con Google",
    text: "Con «Continuar con Google» entrás o creás tu cuenta sin contraseña, desde cualquier dispositivo. Si ya tenías cuenta con ese correo, entrás a la misma y no se pierde nada.",
  },
];

export const NEWS = {
  /** The latest release: what a teacher has seen after the notice opens. */
  id: NEWS_RELEASES[NEWS_RELEASES.length - 1]!,
  when: "Octubre 2026",
  title: "Nuevos cambios en la aplicación",
  intro: "Sumamos lo que nos pidieron las docentes que usan Aula Socrática. Esto es lo nuevo:",
} as const;

/** The items a teacher has not seen yet ("" = none seen). */
export function unseenNews(seen: string): NewsItem[] {
  const after = (NEWS_RELEASES as readonly string[]).indexOf(seen);
  const fresh = NEWS_ITEMS.filter((i) => NEWS_RELEASES.indexOf(i.release) > after);
  const keys = new Set(fresh.map((i) => i.key));
  return fresh.filter((i) => !i.coveredBy || !keys.has(i.coveredBy));
}
