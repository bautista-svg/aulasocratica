// "Novedades": a notice every teacher sees once, the first time they open the app after a
// release. The server remembers the id of the last notice shown (teachers.news_seen), so it
// never comes back, on any device. A new notice = a new id.

export type NewsKey = "alerts" | "deliverables" | "aspects" | "rubric";

export interface NewsItem {
  key: NewsKey;
  title: string;
  text: string;
  /** Where to try it, when there is one place for it. */
  link?: { to: "/app/alertas"; label: string };
}

export const NEWS = {
  id: "2026-10-22",
  when: "Octubre 2026",
  title: "Nuevos cambios en la aplicación",
  intro: "Sumamos lo que nos pidieron las docentes que usan Aula Socrática. Esto es lo nuevo:",
  items: [
    {
      key: "alerts",
      title: "Todas las alertas, juntas",
      text: "Un panel con las alertas de todos tus alumnos y aulas, con filtros y para marcarlas como revisadas.",
      link: { to: "/app/alertas", label: "Ver las alertas" },
    },
    {
      key: "deliverables",
      title: "Entrega de archivos",
      text: "Al final de la actividad, el alumno puede subir su trabajo (PDF, foto o documento) y la IA lo analiza con tu rúbrica.",
    },
    {
      key: "aspects",
      title: "Fortalezas y aspectos a reforzar",
      text: "En qué se destacó cada alumno y el grupo, como la redacción, y qué conviene reforzar, como el uso de los materiales.",
    },
    {
      key: "rubric",
      title: "La rúbrica, a tu manera",
      text: "Borrá la sugerencia de la IA y evaluá vos. Y ahora sugiere niveles pensando en lo que se espera del curso.",
    },
  ] satisfies NewsItem[],
} as const;
