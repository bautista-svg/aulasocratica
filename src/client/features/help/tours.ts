// The guided tours, one per screen. Targets are data-tour="…" marks on the real elements; a step
// whose element is not on screen (another size, a section the role cannot see) explains itself.
import type { TourStep } from "@client/components/app/tour";

/** The general one: the menu, from any screen without a tour of its own. */
export const SHELL_TOUR: TourStep[] = [
  { target: "nueva-aula", title: "Empezá creando un aula", body: "Un aula por curso. Tocá el + y ponele nombre: adentro van tus actividades y tus alumnos." },
  { target: "grupo-preparar", title: "Preparar", body: "Tus actividades, los tutores que preguntan por vos y tu biblioteca de materiales." },
  { target: "grupo-en-clase", title: "En clase", body: "Cuando hay alumnos trabajando, el punto verde late. Entrá para ver quién avanza y quién se traba." },
  { target: "grupo-revisar", title: "Revisar", body: "Los avisos del tutor, la radiografía de la clase y los informes en PDF." },
  { target: "buscar", title: "Buscá lo que sea", body: "Con Ctrl K encontrás un aula o una actividad y abrís cualquier sección sin moverte." },
  { target: "ayuda", title: "¿No encontrás algo?", body: "Preguntale a la ayuda dónde está y te lleva hasta el botón." },
];

export const HOME_TOUR: TourStep[] = [
  { target: "nueva-aula", title: "Empezá creando un aula", body: "Un aula por curso. Tocá el + y ponele nombre: adentro van tus actividades y tus alumnos." },
  { target: "momentos", title: "La app sigue el orden de una clase", body: "Preparás, das la clase y revisás. Desde acá entrás a cualquiera de los tres momentos." },
  { target: "grupo-preparar", title: "Preparar", body: "Tus actividades, los tutores que preguntan por vos y tu biblioteca de materiales." },
  { target: "grupo-en-clase", title: "En clase", body: "Cuando hay alumnos trabajando, el punto verde late. Entrá para ver quién avanza y quién se traba." },
  { target: "grupo-revisar", title: "Revisar", body: "Los avisos del tutor, la radiografía de la clase y los informes en PDF." },
  { target: "buscar", title: "Buscá lo que sea", body: "Con Ctrl K encontrás un aula o una actividad y abrís cualquier sección sin moverte." },
  { target: "ayuda", title: "¿No encontrás algo?", body: "Preguntale a la ayuda dónde está y te lleva hasta el botón. Este recorrido se repite desde «Recorrido guiado»." },
];

export const ACTIVITY_TOUR: TourStep[] = [
  { target: "pasos", title: "Cada actividad, en 4 pasos", body: "Preparar, Compartir, En vivo y Revisar. La línea de arriba marca en cuál estás." },
  { target: "paso-preparar", title: "1 · Preparar", body: "Consigna, material, tutor, rúbrica y qué pasa al terminar. Los cambios se guardan con «Guardar»." },
  { target: "accion-principal", title: "Publicá o compartí", body: "Con «Publicar» se activa el enlace. Después, este botón te lleva a compartirlo." },
  { target: "paso-compartir", title: "2 · Compartir", body: "El enlace, el código y el QR para tus alumnos. Entran con su nombre, sin cuenta." },
  { target: "paso-en-vivo", title: "3 · En vivo", body: "Cada alumno mientras trabaja: quién avanza, quién se trabó, quién pide ayuda." },
  { target: "paso-revisar", title: "4 · Revisar", body: "Lo que logró el grupo, habilidad por habilidad, con la cita de cada alumno." },
  { target: "mas-acciones", title: "Más acciones", body: "Duplicar, volver a borrador, reiniciar, archivar o eliminar la actividad." },
];

export const CLASSROOM_TOUR: TourStep[] = [
  { target: "nueva-actividad", title: "Creá una actividad", body: "Escribila vos o pedile a la IA que la arme con tu material." },
  { target: "aula-alumnos", title: "Tus alumnos", body: "Se suman solos cuando entran con el enlace. También podés cargarlos vos." },
  { target: "aula-alertas", title: "Qué te avisa el tutor", body: "Las señales que el tutor detecta en esta aula: si alguien se frustra, pide la respuesta o copia." },
  { target: "compartir-aula", title: "Compartí el aula", body: "Sumá a otro docente como administrador, editor o lector." },
];
