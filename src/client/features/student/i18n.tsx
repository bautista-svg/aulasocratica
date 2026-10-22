// Texts of the student's screens in the activity's language ("es" or "en"). The Spanish values
// are the app's original texts, unchanged (the E2E tests match them); English is plain, warm and
// simple, for school students. The teacher's screens never use this.
// API errors keep the server's message in Spanish; in English the known student-facing codes and
// field messages get an English text (anything unknown falls back to the server's message).
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ApiError, errorMessage } from "@client/lib/api";
import type { LinkAvailability } from "@shared/domain/access-rules";
import { LINK_AVAILABILITY_MESSAGE_EN, type ActivityLanguage } from "@shared/domain/language";
import {
  DELIVERABLE_KINDS,
  DELIVERABLE_URL_MAX,
  MAX_DELIVERABLE_BYTES,
  MAX_DELIVERABLE_LABEL,
  deliverableKindLabel,
  type DeliverableKind,
} from "@shared/domain/deliverables";
import { MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, classifyFile, fileExtension, formatBytes } from "@shared/domain/files";
import type { DraftField } from "./hooks";

/** Wraps a fragment of a sentence in the screen's own <strong>. */
type Bold = (text: string) => ReactNode;
type ClosedAvailability = Exclude<LinkAvailability, "available">;
type StepState = "done" | "current" | null;
type FileLike = { name: string; type: string; size: number };
/** What the error translators need from an ApiError (or a chat stream error event). */
type ErrorLike = { code: string; message: string; status?: number; fields?: Record<string, string> };

// ── Dates ──

const dateEs = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });
const timeEs = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateEn = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const timeEn = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Spanish (the original texts) ──

const es = {
  page: {
    loading: "Actividad",
    notFound: "Enlace no encontrado",
    offline: "Sin conexión",
    join: "Entrar",
    closed: {
      inactive: "Cerrada",
      not_started: "Todavía no empezó",
      expired: "Terminada",
      unpublished: "No disponible",
      archived: "No disponible",
    } as Record<ClosedAvailability, string>,
  },
  entry: {
    loadingLabel: "Cargando la actividad",
    linkReplacedTitle: "Este enlace ya no funciona",
    notFoundTitle: "No encontramos esta actividad",
    linkReplacedBody: "Tu docente generó un enlace nuevo para esta actividad (o la quitó). Pedile el enlace nuevo: tu trabajo no se pierde.",
    notFoundBody: "Revisá que el enlace esté completo. Si lo está, puede que tu docente lo haya cambiado por uno nuevo: pedíselo.",
    offlineTitle: "Sin conexión",
    openFailedTitle: "No pudimos abrir la actividad",
    retry: "Reintentar",
    eyebrow: "Actividad",
    withTeacher: (name: string) => `Con ${name}`,
    opensAt: (iso: string) => `${dateEs.format(new Date(iso))} a las ${timeEs.format(new Date(iso))}`,
    opensBefore: "Abre el ",
    opensAfter: ". Si dejás esta página abierta, se va a actualizar sola.",
    closedSaved: "Lo que ya habías enviado quedó guardado. ",
    closedMistake: "Si creés que es un error, avisale a tu docente.",
    checkAgain: "Volver a fijarme",
    unsentField: {
      chat: "tu último mensaje para el tutor",
      initial: "tu primera idea",
      final: "tu respuesta final",
      finals: "tus respuestas finales",
      reflection: "tu reflexión",
    } as Record<DraftField, string>,
    unsentList: (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : names[0]!),
    unsentTitle: (list: string, plural: boolean) => `${capitalize(list)} no ${plural ? "se enviaron" : "se envió"}.`,
    unsentBody: (plural: boolean, reopenable: boolean) =>
      reopenable
        ? `${plural ? "Quedaron guardados" : "Quedó guardado"} en este dispositivo y ${plural ? "van" : "va"} a volver a aparecer si tu docente vuelve a abrir la actividad.`
        : `${plural ? "Quedaron guardados" : "Quedó guardado"} solo en este dispositivo; tu docente no ${plural ? "los" : "lo"} puede ver.`,
  },
  join: {
    failed: "No pudimos entrar. Probá de nuevo.",
    nameRequired: "Escribí tu nombre y apellido.",
    footer:
      "Solo se guarda tu nombre y lo que escribís en la actividad. Mientras trabajás también se registra si pegás texto copiado de afuera o si salís de la página por un rato.",
    privacy: "Privacidad",
    resumeRequired: (b: Bold, name: string): ReactNode => (
      <>
        {"Ya hay un trabajo empezado como "}
        {b(`«${name}»`)}
        {". Si sos vos, escribí el código que te mostramos al empezar. Si no lo tenés, pedíselo a tu docente."}
      </>
    ),
    notYou: (b: Bold): ReactNode => (
      <>
        {b("¿No empezaste vos?")}
        {" Puede que otra persona haya entrado con tu nombre. Avisale a tu docente: puede ver ese trabajo, darte el código o borrarlo para que entres vos."}
      </>
    ),
    resumeChosen: "Escribí tu nombre como lo pusiste al empezar y el código de 6 letras y números que te mostramos.",
    yourName: "Tu nombre",
    whatsYourName: "¿Cómo te llamás?",
    nameHint: "Escribí tu nombre y apellido. Tu docente va a ver tu trabajo con este nombre.",
    yourCode: "Tu código",
    codeHint: "Son 6 letras y números, por ejemplo K7M2QX.",
    continueWork: "Seguir mi trabajo",
    submit: "Entrar a la actividad",
    notMeOtherName: "No soy yo: entrar con otro nombre",
    back: "Volver",
    useCode: "¿Empezaste en otro dispositivo? Usá tu código",
    howItWorksLabel: "Cómo funciona",
    howItWorks: (b: Bold): ReactNode => (
      <>
        {"Vas a conversar con un "}
        {b("tutor de IA")}
        {" que te ayuda a pensar con preguntas, sin darte la respuesta. Al final escribís tu respuesta y contás cómo lo pensaste."}
      </>
    ),
  },
  ws: {
    workingAs: "Trabajando como ",
    notMe: (name: string) => `No soy ${name}`,
    leaveLabel: "Salir de este dispositivo",
    leaveBody: (b: Bold, fullName: string, firstName: string): ReactNode => (
      <>
        {"¿No sos "}
        {b(fullName)}
        {`? Vamos a cerrar su sesión en este dispositivo para que entres con tu nombre. Su trabajo queda guardado; para volver a entrar como ${firstName} hace falta su código.`}
      </>
    ),
    leaveFailed: "No pudimos cerrar la sesión. Revisá tu conexión y probá de nuevo.",
    leaveConfirm: "Salir de este dispositivo",
    cancel: "Cancelar",
    closedStill: "Igual podés ver tu trabajo en este dispositivo.",
    progressLabel: "Progreso de la actividad",
    steps: { initial: "Tu idea", tutor: "Conversación", closing: "Cierre" } as Record<"initial" | "tutor" | "closing", string>,
    stepSr: (n: number, total: number, state: StepState) =>
      `Paso ${n} de ${total}${state === "done" ? " (hecho)" : state === "current" ? " (actual)" : ""}: `,
    noInstructions: "Tu docente no escribió una consigna: conversá con el tutor sobre el tema de la actividad.",
    tasksTitle: (n: number) => `Consignas (${n})`,
    taskTitle: "Consigna",
    taskN: (n: number) => `Consigna ${n}`,
    objectives: "Lo que vas a aprender",
    material: "Material para leer",
    showLess: "Mostrar menos",
    showAllTasks: "Ver todas las consignas",
    showFullTask: "Ver la consigna completa",
    size: (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`),
    filesTitle: "Archivos de la actividad",
    filesTitleCount: (n: number) => `Archivos de la actividad (${n})`,
    openFile: (name: string) => `Abrir ${name} (se abre en otra pestaña)`,
    downloadFile: (name: string) => `Descargar ${name}`,
    audioUnsupported: "Tu navegador no puede reproducir este audio. Descargalo con el botón de al lado.",
    codeCard: "Tu código para seguir en otro dispositivo:",
    show: "Ver",
    hide: "Ocultar",
    yourCodeIs: "Tu código es ",
    writeItDown: "Anotalo: lo vas a necesitar si querés seguir en otro dispositivo. Tu docente también lo tiene.",
    dismissCode: "Ya lo anoté, cerrar aviso",
    integrity: "Mientras trabajás se registra si pegás texto copiado de afuera o si salís de esta página por un rato, y tu docente lo puede ver.",
    voicePrivacy:
      "El dictado lo hace tu navegador: el audio puede procesarse en servidores de Google o Apple para pasarlo a texto. Aula Socrática no guarda audio, solo el texto que enviás.",
  },
  chat: {
    tutorReplied: (text: string) => `El tutor respondió: ${text}`,
    sendFailed: "No pudimos enviar tu mensaje. Probá de nuevo.",
    replyCut: "Se cortó la conexión mientras el tutor respondía.",
    tooLong: (max: number) => `Tu mensaje puede tener hasta ${max} caracteres. Acortalo un poco.`,
    emptyWithIdea: "Ya guardaste tu primera idea. Contale al tutor cómo llegaste a ella, o pedile que la revise con vos.",
    emptyNoIdea: "Contale al tutor qué pensás de la consigna o qué duda tenés. Te va a responder con preguntas para ayudarte a pensar.",
    stuck: "Si te trabás, usá los botones de ayuda de abajo.",
    subtitlePractice: "Practicá inglés: podés escribir o dictar tus mensajes.",
    subtitleDictation: "Podés escribirle o dictarle con el micrófono.",
    subtitle: "Te ayuda a pensar con preguntas, sin darte la respuesta.",
    title: "Conversación con el tutor",
    messagesLabel: "Mensajes",
    finishing: "El tutor está terminando de responder…",
    noReply: "El tutor no llegó a responder tu último mensaje.",
    retry: "Reintentar",
    finishHintNoAnswer: "Cuando quieras terminar, tocá Terminar para completar el cierre.",
    finishHintEmpty: "Cuando quieras terminar, vas a escribir tu respuesta final y una reflexión.",
    finishHint: "¿Ya sabés qué responder? Cuando quieras, terminá y escribí tu respuesta final.",
    finish: "Terminar",
    helpLabel: "Pedile ayuda al tutor",
    composerLabel: "Tu mensaje para el tutor",
    placeholderBusy: "Podés ir escribiendo…",
    placeholder: "Escribí tu respuesta o tu duda…",
    sendWait: "Esperá a que el tutor termine de responder",
    send: "Enviar",
    listening: (elapsed: string, max: string) => `Escuchando… ${elapsed} / ${max}. Revisá el texto antes de enviarlo.`,
    charCount: (n: number, max: number) => `${n}/${max} caracteres`,
    enterHint: "Enter envía · Shift + Enter hace un salto de línea",
  },
  thread: {
    tutorSays: "El tutor dice:",
    thinking: "El tutor está pensando",
    you: "Vos:",
    dictated: "Dictado",
    firstIdea: "Tu primera idea",
    noConversation: "No hubo conversación con el tutor.",
  },
  voice: {
    notAllowed:
      "Tu navegador no tiene permiso para usar el micrófono. Tocá el candado de la barra de direcciones, permití el micrófono y probá de nuevo.",
    noSpeech: "No se escuchó nada. Acercate al micrófono y probá de nuevo.",
    audioCapture: "No encontramos un micrófono en este dispositivo.",
    network: "El dictado necesita conexión a internet. Probá de nuevo o escribí tu mensaje.",
    languageNotSupported: "Tu navegador no puede dictar en este idioma. Escribí tu mensaje.",
    generic: "No pudimos usar el dictado. Escribí tu mensaje o probá de nuevo.",
    stopDictation: "Detener el dictado",
    dictate: "Dictar tu mensaje",
    stop: "Detener",
    listen: "Escuchar",
  },
  steps: {
    initialFailed: "No pudimos guardar tu respuesta.",
    beforeChat: "Antes de conversar",
    whatDoYouThink: "¿Qué pensás vos?",
    initialIntro:
      "Escribí tu primera idea sobre la consigna, aunque no estés seguro. Cuando la guardes ya no se puede cambiar: al final vas a escribir tu respuesta mejorada.",
    firstIdea: "Tu primera idea",
    savedHint: "Se guarda en este dispositivo mientras escribís, aunque cierres la página.",
    savedHintPlural: "Se guardan en este dispositivo mientras escribís, aunque cierres la página.",
    initialPlaceholder: "Yo creo que…",
    saveAndStart: "Guardar y empezar a conversar",
    finishFailed: "No pudimos enviar tu trabajo. Probá de nuevo.",
    backToChat: "Volver a la conversación",
    toFinish: "Para terminar",
    beforeSend: "Antes de enviar tu trabajo",
    closingIntroAsk:
      "Escribí tu respuesta final con tus palabras y contá cómo lo pensaste. Cuando la envíes ya no vas a poder cambiarla, y tu docente va a poder leerla.",
    closingIntro: "Completá lo que te pide tu docente y enviá tu trabajo. Cuando lo envíes ya no vas a poder cambiarlo.",
    answerEachTask: "Tu respuesta a cada consigna",
    taskN: (n: number) => `Consigna ${n}`,
    finalPlaceholder: "Ahora pienso que…",
    finalAnswer: "Tu respuesta final",
    reflection: "Tu reflexión",
    reflectionIntro: "Contá cómo fue tu forma de pensar. Podés responder las que quieras.",
    optional: "(opcional)",
    missingFile: "Subí tu archivo o pegá el enlace para poder enviar tu trabajo.",
    keepChatting: "Seguir conversando",
    sendWork: "Enviar mi trabajo",
  },
  done: {
    endedTitle: "Tu docente cerró tu sesión",
    doneTitle: "¡Terminaste la actividad!",
    endedWithAnswer: "Ya no se pueden agregar respuestas. Tu trabajo quedó guardado y tu docente lo puede ver.",
    endedNoAnswer: "Ya no se pueden agregar respuestas. Lo que escribiste hasta acá quedó guardado y tu docente lo puede ver.",
    body: "Tu trabajo quedó guardado y tu docente lo puede ver.",
    thoughtBefore: "Al empezar pensabas",
    thinkNow: "Ahora pensás",
    taskN: (n: number) => `Consigna ${n}`,
    deliverable: "Tu entrega",
    reflection: "Tu reflexión",
    codeLine: (b: Bold, code: string, linkOpen: boolean): ReactNode => (
      <>
        {"Tu código es "}
        {b(code)}
        {`. Con él podés volver a ver tu trabajo desde otro dispositivo${linkOpen ? "" : " cuando tu docente vuelva a abrir la actividad"}.`}
      </>
    ),
    seeChat: "Ver la conversación con el tutor",
    show: "Mostrar",
    hide: "Ocultar",
  },
  deliv: {
    kind: (kind: DeliverableKind) => deliverableKindLabel(kind),
    /** A link's name is a label the server wrote ("Documento de Google"). */
    linkName: (name: string) => name,
    title: "Tu entrega",
    required: "obligatoria",
    optional: "opcional",
    defaultPrompt: "Subí el archivo con tu trabajo o pegá el enlace.",
    change: "Cambiar",
    remove: "Quitar",
    chooseFile: "Elegir un archivo o sacar una foto",
    pasteLink: "Pegar un enlace",
    cancel: "Cancelar",
    linkLabel: "Enlace a tu trabajo (Google Drive, Docs, Canva…)",
    saveLink: "Guardar enlace",
    driveHint: "Si es de Google Drive, compartilo como «Cualquier persona con el enlace» para que tu docente lo pueda abrir.",
    uploading: (pct: number) => `Subiendo… ${pct} %`,
    help: `PDF, Word, texto o una foto (JPG, PNG, WEBP), hasta ${MAX_DELIVERABLE_LABEL}, o un enlace. Lo ve tu docente junto con tu respuesta.`,
    uploadFailed: "No se pudo subir el archivo. Probá de nuevo.",
    linkFailed: "No se pudo guardar el enlace. Probá de nuevo.",
    removeFailed: "No se pudo quitar la entrega.",
    /** Why a picked file cannot be handed in (`error` is validateDeliverable's own message). */
    fileProblem: (_file: FileLike, error: string) => error,
    /** Why a pasted link cannot be saved (`error` is validateDeliverableLink's own message). */
    linkProblem: (_raw: string, error: string) => error,
  },
  /** The message to show for an error (the server's own message, as before). */
  error: (err: unknown): string => errorMessage(err),
  /** A chat stream error event ({ message, code }). */
  streamError: (e: { message: string; code: string }): string => e.message,
  /** A per-field message of an API error (or of a check made before sending). */
  fieldError: (_field: string, message: string): string => message,
  /** The message of a closed link. */
  availability: (_availability: LinkAvailability, message: string | null): string | null => message,
};

export type StudentStrings = typeof es;

// ── English ──

const LINK_LABEL_EN: Record<string, string> = {
  "Documento de Google": "Google Doc",
  "Presentación de Google": "Google Slides",
  "Hoja de cálculo de Google": "Google Sheet",
  "Formulario de Google": "Google Form",
  "Archivo de Google": "Google file",
  "Carpeta de Google Drive": "Google Drive folder",
  "Archivo de Google Drive": "Google Drive file",
  "Diseño de Canva": "Canva design",
  "Video de YouTube": "YouTube video",
  Enlace: "Link",
};

const KIND_EN: Record<DeliverableKind, string> = { pdf: "PDF", image: "Image", docx: "Word", text: "Text", audio: "Audio", link: "Link" };

const ACCEPTED_EN = "you can upload PDF, Word (.docx), text files and photos (JPG, PNG, WEBP).";

/** English for a file validateDeliverable rejected (same checks, in the same order). */
export function deliverableFileProblemEn(file: FileLike): string {
  const name = `"${file.name}"`;
  const ext = fileExtension(file.name);
  const c = classifyFile(file.name, file.type);
  if (!c || c.kind === "audio") {
    if (ext === "doc") return `${name} is an old Word file (.doc). Save it as .docx or as a PDF and upload it again.`;
    if (ext === "heic" || ext === "heif") return `${name}: HEIC photos can't be read. Take the photo as a JPG or export it as a JPG.`;
    return `${name}: ${ACCEPTED_EN}`;
  }
  if (file.size <= 0) return `${name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${name} is bigger than 60 MB.`;
  if (!DELIVERABLE_KINDS.includes(c.kind)) return `${name}: ${ACCEPTED_EN}`;
  if (c.kind === "image" && file.size > MAX_IMAGE_BYTES) {
    return `${name} is ${formatBytes(file.size)}: photos can be up to 5 MB. Take it at a lower resolution or send it as a PDF.`;
  }
  if (file.size > MAX_DELIVERABLE_BYTES) return `${name} is ${formatBytes(file.size)}: the limit is ${MAX_DELIVERABLE_LABEL}.`;
  return `${name} can't be uploaded. Try another file.`;
}

/** English for a link validateDeliverableLink rejected. */
export function deliverableLinkProblemEn(raw: string): string {
  const url = raw.trim();
  if (!url) return "Paste the link to your work.";
  if (url.length > DELIVERABLE_URL_MAX) return "The link is too long.";
  return "Check the link: copy all of it, starting with https://";
}

/** Known Spanish messages (server and shared checks) → English. */
const KNOWN_EN: Record<string, string> = {
  // Names and resume codes
  "Escribí tu nombre.": "Write your name.",
  "Escribí tu nombre y apellido.": "Write your first and last name.",
  "El nombre es demasiado largo.": "That name is too long.",
  "Escribí tu nombre con letras.": "Write your name using letters.",
  "Escribí tu código.": "Type your code.",
  "Falta 1 letra o número: el código tiene 6.": "1 letter or number is missing: the code has 6.",
  "Sobran letras o números: el código tiene 6.": "There are too many letters or numbers: the code has 6.",
  "Revisá el código: nunca lleva 0, O, 1 ni I.": "Check the code: it never has 0, O, 1 or I.",
  "El código tiene 6 letras y números.": "The code has 6 letters and numbers.",
  // Answers and messages
  "Escribí al menos unas palabras.": "Write at least a few words.",
  "Escribí un mensaje.": "Write a message.",
  "Escribí tu respuesta final.": "Write your final answer.",
  "Escribí tu respuesta a esta consigna.": "Write your answer to this task.",
  "Respondé cada consigna antes de enviar tu trabajo.": "Answer every task before you send your work.",
  "Primero escribí tu respuesta inicial.": "First, write your first idea.",
  // Hand-in
  "Pegá el enlace a tu trabajo.": "Paste the link to your work.",
  "El enlace es demasiado largo.": "The link is too long.",
  "Revisá el enlace: copialo completo, empezando con https://": "Check the link: copy all of it, starting with https://",
  "Esta actividad no pide una entrega.": "This activity doesn't ask you to hand in anything.",
  "Elegí un archivo.": "Choose a file.",
  "Elegí al menos un archivo.": "Choose at least one file.",
  "No pudimos leer el archivo enviado. Probá de nuevo.": "We couldn't read the file you sent. Try again.",
  "Este archivo ya no está disponible.": "This file isn't available anymore.",
  "Este archivo ya no está disponible. Avisale a tu docente.": "This file isn't available anymore. Tell your teacher.",
  // Connection and generic
  "Revisá los datos ingresados.": "Check what you wrote.",
  "El cuerpo de la solicitud no es JSON válido.": "Something went wrong while sending. Try again.",
  "No hay conexión con el servidor. Revisá tu internet y probá de nuevo.": "Can't connect to the server. Check your internet connection and try again.",
  "Se cortó la conexión mientras el tutor respondía.": "The connection dropped while the tutor was replying.",
  "Se cortó la conexión mientras se subía el archivo.": "The connection dropped while your file was uploading.",
  "El servidor tuvo un problema. Probá de nuevo en unos segundos.": "The server had a problem. Try again in a few seconds.",
  "No se pudo completar la acción.": "That didn't work. Try again.",
  "No se pudo subir el archivo.": "The file couldn't be uploaded.",
  "No pudimos enviar tu mensaje. Probá de nuevo.": "We couldn't send your message. Try again.",
  "El tutor no pudo responder.": "The tutor couldn't answer.",
  "No pudimos guardar la respuesta del tutor. Tocá «Reintentar».": "We couldn't save the tutor's reply. Tap “Try again”.",
  "Ocurrió un error inesperado.": "Something unexpected went wrong.",
  "Ocurrió un error inesperado. Probá de nuevo en unos segundos.": "Something unexpected went wrong. Try again in a few seconds.",
  "El archivo o los datos enviados son demasiado grandes.": "The file or what you sent is too big.",
  "No tenés permiso para hacer esto.": "You don't have permission to do this.",
  "Demasiados intentos. Esperá un momento y volvé a probar.": "Too many tries. Wait a moment and try again.",
};

const NOT_FOUND_EN =
  "We couldn't find this activity. Check that the link is complete. If it is, your teacher may have replaced it with a new one: ask them for it.";
const LOCKED_EN = "You tried too many codes for this name. Wait 15 minutes and try again with the code your teacher gives you.";

/** English for a per-field message (known messages, then the length limits). */
function fieldErrorEn(field: string, message: string): string {
  const known = KNOWN_EN[message];
  if (known) return known;
  const missing = /^Faltan (\d+) letras o números/.exec(message)?.[1];
  if (field === "code" && missing) return `${missing} letters or numbers are missing: the code has 6.`;
  const max = /hasta (\d+) caracteres/.exec(message)?.[1];
  if (max) {
    if (field === "text") return `Your message can be up to ${max} characters.`;
    if (field.startsWith("reflection")) return `Each answer can be up to ${max} characters.`;
    return `Your answer can be up to ${max} characters.`;
  }
  return message;
}

/** English for an API error of the student routes; unknown ones keep the server's message. */
function errorEn(e: ErrorLike): string {
  const m = e.message;
  const known = KNOWN_EN[m];
  if (known) return known;
  switch (e.code) {
    case "network":
      return /archivo/.test(m)
        ? KNOWN_EN["Se cortó la conexión mientras se subía el archivo."]!
        : /tutor/.test(m)
          ? KNOWN_EN["Se cortó la conexión mientras el tutor respondía."]!
          : KNOWN_EN["No hay conexión con el servidor. Revisá tu internet y probá de nuevo."]!;
    case "not_found":
      return /archivo/i.test(m) ? "This file isn't available anymore. Tell your teacher." : NOT_FOUND_EN;
    case "unavailable": {
      const av = e.fields?.availability as ClosedAvailability | undefined;
      return (av && LINK_AVAILABILITY_MESSAGE_EN[av]) || "This activity isn't available right now.";
    }
    case "no_session":
      return "Your session on this device ended. Join again with your name.";
    case "resume_required": {
      const name = /«(.+)»/.exec(m)?.[1];
      return (
        `There's already work started as ${name ? `“${name}”` : "this name"} in this activity. If it's you, type your code to continue on this device. ` +
        "If you didn't start it, tell your teacher: they can give you your code or delete that entry so you can join."
      );
    }
    case "wrong_code": {
      if (/Probaste demasiados/.test(m)) return `That name and code don't match. ${LOCKED_EN}`;
      const left = /queda 1 intento/.test(m) ? 1 : Number(/quedan (\d+) intentos/.exec(m)?.[1] ?? 0);
      return (
        "That name and code don't match any work in this activity. Check both, or ask your teacher for your code" +
        (left ? ` (${left === 1 ? "1 try left" : `${left} tries left`}).` : ".")
      );
    }
    case "locked":
      return LOCKED_EN;
    case "read_only":
      return /cerró/.test(m)
        ? "Your teacher closed your session: you can't add more answers."
        : "You already finished this activity: your work is saved.";
    case "initial_required":
      return "First, write your first idea.";
    case "busy":
      return "The tutor is still answering your last message.";
    case "nothing_to_retry":
      return "There's no message of yours waiting for an answer.";
    case "rate_limited":
      if (/mensajes seguidos/.test(m)) return "You sent a lot of messages in a row. Take a moment to think and keep going in a minute.";
      if (/ingresos/.test(m)) return "Too many people joined from this connection. Wait a few minutes and try again.";
      if (/entrega/.test(m)) return "You changed what you're handing in many times in a row. Wait a few minutes and try again.";
      if (/intentos desde esta conexión/.test(m)) return "Too many tries from this connection. Wait a few minutes and try again.";
      return "Too many tries. Wait a moment and try again.";
    case "student_quota":
      return "You reached today's limit of messages with the tutor in this activity. Tell your teacher.";
    case "full":
      return "This activity already has the most participants it can have. Tell your teacher.";
    case "join_failed":
      return /registrar/.test(m) ? "We couldn't save your name. Try again." : "We couldn't open your work. Try again.";
    case "deliverable_required":
      return "Upload your file before you send your work.";
    case "ai_quota":
      return "The tutor reached today's usage limit for this class. It starts again at 9 PM (Argentina time).";
    case "ai_quota_global":
      return "The tutor reached today's usage limit. It starts again at 9 PM (Argentina time).";
    case "ai_not_configured":
    case "ai_config":
      return "The tutor isn't available right now because of a problem on the server. Tell your teacher.";
    case "ai_busy":
      return "The tutor is getting a lot of requests. Try again in a minute.";
    case "ai_unavailable":
    case "ai_unreachable":
      return "We couldn't reach the tutor. Try again in a few seconds.";
    case "ai_failed":
      return "The tutor couldn't answer. Try again in a few seconds.";
    case "ai_incomplete":
      return "The tutor's answer came in incomplete. Try again.";
    case "ai_rejected":
    case "ai_refused":
    case "ai_content_filtered":
      return "The tutor couldn't work with this. Try again, or say it in a different way.";
    case "too_large":
      return KNOWN_EN["El archivo o los datos enviados son demasiado grandes."]!;
    case "storage_quota":
      return "Your teacher's space is full, so this file can't be uploaded. Tell your teacher.";
    case "link_not_public":
      return "The link couldn't be opened: it has to be shared as “Anyone with the link”. Share it that way, or upload the file.";
    case "link_too_big":
      return "The file in the link is too big. Upload a smaller version or a PDF.";
    case "link_unsupported":
      return "That Drive file can't be read. Upload it as a PDF.";
    case "link_unreachable":
      return "Google didn't respond when opening the link. Try again in a while.";
    case "forbidden":
      return KNOWN_EN["No tenés permiso para hacer esto."]!;
    case "internal":
      return /respuesta del tutor/.test(m)
        ? KNOWN_EN["No pudimos guardar la respuesta del tutor. Tocá «Reintentar»."]!
        : KNOWN_EN["Ocurrió un error inesperado. Probá de nuevo en unos segundos."]!;
    case "invalid": {
      const first = Object.entries(e.fields ?? {}).find(([k]) => k !== "availability");
      return first ? fieldErrorEn(first[0], first[1]) : m;
    }
    default:
      return (e.status ?? 0) >= 500 ? KNOWN_EN["El servidor tuvo un problema. Probá de nuevo en unos segundos."]! : m;
  }
}

const en: StudentStrings = {
  page: {
    loading: "Activity",
    notFound: "Link not found",
    offline: "No connection",
    join: "Join",
    closed: {
      inactive: "Closed",
      not_started: "Not started yet",
      expired: "Ended",
      unpublished: "Not available",
      archived: "Not available",
    },
  },
  entry: {
    loadingLabel: "Loading the activity",
    linkReplacedTitle: "This link doesn't work anymore",
    notFoundTitle: "We couldn't find this activity",
    linkReplacedBody: "Your teacher made a new link for this activity (or removed it). Ask them for the new link: your work isn't lost.",
    notFoundBody: "Check that the link is complete. If it is, your teacher may have replaced it with a new one: ask them for it.",
    offlineTitle: "No connection",
    openFailedTitle: "We couldn't open the activity",
    retry: "Try again",
    eyebrow: "Activity",
    withTeacher: (name: string) => `With ${name}`,
    opensAt: (iso: string) => `${dateEn.format(new Date(iso))} at ${timeEn.format(new Date(iso))}`,
    opensBefore: "It opens on ",
    opensAfter: ". If you leave this page open, it will update by itself.",
    closedSaved: "Everything you had already sent is saved. ",
    closedMistake: "If you think this is a mistake, tell your teacher.",
    checkAgain: "Check again",
    unsentField: {
      chat: "your last message to the tutor",
      initial: "your first idea",
      final: "your final answer",
      finals: "your final answers",
      reflection: "your reflection",
    },
    unsentList: (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!),
    unsentTitle: (list: string, plural: boolean) => `${capitalize(list)} ${plural ? "weren't" : "wasn't"} sent.`,
    unsentBody: (plural: boolean, reopenable: boolean) =>
      reopenable
        ? `${plural ? "They're" : "It's"} saved on this device and will show up again if your teacher opens the activity again.`
        : `${plural ? "They're" : "It's"} saved only on this device; your teacher can't see ${plural ? "them" : "it"}.`,
  },
  join: {
    failed: "We couldn't let you in. Try again.",
    nameRequired: "Write your first and last name.",
    footer:
      "We only save your name and what you write in the activity. While you work, we also note if you paste text copied from somewhere else or leave the page for a while.",
    privacy: "Privacy",
    resumeRequired: (b: Bold, name: string): ReactNode => (
      <>
        {"There's already work started as "}
        {b(`“${name}”`)}
        {". If it's you, type the code we showed you when you started. If you don't have it, ask your teacher."}
      </>
    ),
    notYou: (b: Bold): ReactNode => (
      <>
        {b("Didn't start it?")}
        {" Someone else may have joined with your name. Tell your teacher: they can see that work, give you the code or delete it so you can join."}
      </>
    ),
    resumeChosen: "Type your name the way you wrote it when you started, and the 6-character code (letters and numbers) we showed you.",
    yourName: "Your name",
    whatsYourName: "What's your name?",
    nameHint: "Write your first and last name. Your teacher will see your work under this name.",
    yourCode: "Your code",
    codeHint: "It has 6 letters and numbers, for example K7M2QX.",
    continueWork: "Continue my work",
    submit: "Join the activity",
    notMeOtherName: "That's not me: join with another name",
    back: "Back",
    useCode: "Started on another device? Use your code",
    howItWorksLabel: "How it works",
    howItWorks: (b: Bold): ReactNode => (
      <>
        {"You'll chat with an "}
        {b("AI tutor")}
        {" that helps you think by asking questions, without giving you the answer. At the end, you write your answer and explain how you thought about it."}
      </>
    ),
  },
  ws: {
    workingAs: "Working as ",
    notMe: (name: string) => `I'm not ${name}`,
    leaveLabel: "Leave this device",
    leaveBody: (b: Bold, fullName: string, firstName: string): ReactNode => (
      <>
        {"Not "}
        {b(fullName)}
        {`? We'll sign them out on this device so you can join with your name. Their work stays saved; to come back as ${firstName}, they'll need their code.`}
      </>
    ),
    leaveFailed: "We couldn't sign out. Check your connection and try again.",
    leaveConfirm: "Leave this device",
    cancel: "Cancel",
    closedStill: "You can still see your work on this device.",
    progressLabel: "Activity progress",
    steps: { initial: "Your idea", tutor: "Chat", closing: "Wrap-up" },
    stepSr: (n: number, total: number, state: StepState) =>
      `Step ${n} of ${total}${state === "done" ? " (done)" : state === "current" ? " (current)" : ""}: `,
    noInstructions: "Your teacher didn't write a task: chat with the tutor about the activity's topic.",
    tasksTitle: (n: number) => `Tasks (${n})`,
    taskTitle: "Task",
    taskN: (n: number) => `Task ${n}`,
    objectives: "What you'll learn",
    material: "Reading material",
    showLess: "Show less",
    showAllTasks: "See all the tasks",
    showFullTask: "See the whole task",
    size: (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`),
    filesTitle: "Activity files",
    filesTitleCount: (n: number) => `Activity files (${n})`,
    openFile: (name: string) => `Open ${name} (opens in a new tab)`,
    downloadFile: (name: string) => `Download ${name}`,
    audioUnsupported: "Your browser can't play this audio. Download it with the button next to it.",
    codeCard: "Your code to continue on another device:",
    show: "Show",
    hide: "Hide",
    yourCodeIs: "Your code is ",
    writeItDown: "Write it down: you'll need it if you want to continue on another device. Your teacher has it too.",
    dismissCode: "I wrote it down, close this notice",
    integrity: "While you work, we note if you paste text copied from somewhere else or leave this page for a while, and your teacher can see it.",
    voicePrivacy:
      "Dictation is done by your browser: the audio may be processed on Google or Apple servers to turn it into text. Aula Socrática doesn't save any audio, only the text you send.",
  },
  chat: {
    tutorReplied: (text: string) => `The tutor replied: ${text}`,
    sendFailed: "We couldn't send your message. Try again.",
    replyCut: "The connection dropped while the tutor was replying.",
    tooLong: (max: number) => `Your message can be up to ${max} characters. Make it a little shorter.`,
    emptyWithIdea: "You already saved your first idea. Tell the tutor how you came up with it, or ask them to go over it with you.",
    emptyNoIdea: "Tell the tutor what you think about the task or what you're not sure about. They'll answer with questions to help you think.",
    stuck: "If you get stuck, use the help buttons below.",
    subtitlePractice: "Practice your English: you can type or dictate your messages.",
    subtitleDictation: "You can type or use the microphone to dictate.",
    subtitle: "It helps you think with questions, without giving you the answer.",
    title: "Chat with the tutor",
    messagesLabel: "Messages",
    finishing: "The tutor is finishing their reply…",
    noReply: "The tutor didn't get to answer your last message.",
    retry: "Try again",
    finishHintNoAnswer: "When you want to finish, tap Finish to complete the wrap-up.",
    finishHintEmpty: "When you want to finish, you'll write your final answer and a reflection.",
    finishHint: "Do you know what to answer? Whenever you're ready, finish and write your final answer.",
    finish: "Finish",
    helpLabel: "Ask the tutor for help",
    composerLabel: "Your message to the tutor",
    placeholderBusy: "You can keep typing…",
    placeholder: "Write your answer or your question…",
    sendWait: "Wait for the tutor to finish replying",
    send: "Send",
    listening: (elapsed: string, max: string) => `Listening… ${elapsed} / ${max}. Check the text before you send it.`,
    charCount: (n: number, max: number) => `${n}/${max} characters`,
    enterHint: "Enter sends · Shift + Enter starts a new line",
  },
  thread: {
    tutorSays: "The tutor says:",
    thinking: "The tutor is thinking",
    you: "You:",
    dictated: "Dictated",
    firstIdea: "Your first idea",
    noConversation: "There was no chat with the tutor.",
  },
  voice: {
    notAllowed: "Your browser doesn't have permission to use the microphone. Tap the lock in the address bar, allow the microphone and try again.",
    noSpeech: "We didn't hear anything. Move closer to the microphone and try again.",
    audioCapture: "We couldn't find a microphone on this device.",
    network: "Dictation needs an internet connection. Try again or type your message.",
    languageNotSupported: "Your browser can't dictate in this language. Type your message.",
    generic: "We couldn't use dictation. Type your message or try again.",
    stopDictation: "Stop dictating",
    dictate: "Dictate your message",
    stop: "Stop",
    listen: "Listen",
  },
  steps: {
    initialFailed: "We couldn't save your answer.",
    beforeChat: "Before you chat",
    whatDoYouThink: "What do you think?",
    initialIntro:
      "Write your first idea about the task, even if you're not sure. Once you save it, you can't change it: at the end you'll write your improved answer.",
    firstIdea: "Your first idea",
    savedHint: "It's saved on this device as you type, even if you close the page.",
    savedHintPlural: "They're saved on this device as you type, even if you close the page.",
    initialPlaceholder: "I think that…",
    saveAndStart: "Save and start chatting",
    finishFailed: "We couldn't send your work. Try again.",
    backToChat: "Back to the chat",
    toFinish: "To finish",
    beforeSend: "Before you send your work",
    closingIntroAsk:
      "Write your final answer in your own words and explain how you thought about it. Once you send it, you won't be able to change it, and your teacher will be able to read it.",
    closingIntro: "Do what your teacher asks and send your work. Once you send it, you won't be able to change it.",
    answerEachTask: "Your answer to each task",
    taskN: (n: number) => `Task ${n}`,
    finalPlaceholder: "Now I think that…",
    finalAnswer: "Your final answer",
    reflection: "Your reflection",
    reflectionIntro: "Tell us how you thought it through. You can answer as many as you want.",
    optional: "(optional)",
    missingFile: "Upload your file or paste the link so you can send your work.",
    keepChatting: "Keep chatting",
    sendWork: "Send my work",
  },
  done: {
    endedTitle: "Your teacher closed your session",
    doneTitle: "You finished the activity!",
    endedWithAnswer: "You can't add more answers. Your work is saved and your teacher can see it.",
    endedNoAnswer: "You can't add more answers. What you wrote so far is saved and your teacher can see it.",
    body: "Your work is saved and your teacher can see it.",
    thoughtBefore: "When you started, you thought",
    thinkNow: "Now you think",
    taskN: (n: number) => `Task ${n}`,
    deliverable: "What you handed in",
    reflection: "Your reflection",
    codeLine: (b: Bold, code: string, linkOpen: boolean): ReactNode => (
      <>
        {"Your code is "}
        {b(code)}
        {`. With it you can see your work again from another device${linkOpen ? "" : " when your teacher opens the activity again"}.`}
      </>
    ),
    seeChat: "See the chat with the tutor",
    show: "Show",
    hide: "Hide",
  },
  deliv: {
    kind: (kind: DeliverableKind) => KIND_EN[kind] ?? deliverableKindLabel(kind),
    linkName: (name: string) => LINK_LABEL_EN[name] ?? name,
    title: "Hand in your work",
    required: "required",
    optional: "optional",
    defaultPrompt: "Upload the file with your work or paste the link.",
    change: "Change",
    remove: "Remove",
    chooseFile: "Choose a file or take a photo",
    pasteLink: "Paste a link",
    cancel: "Cancel",
    linkLabel: "Link to your work (Google Drive, Docs, Canva…)",
    saveLink: "Save link",
    driveHint: "If it's on Google Drive, share it as “Anyone with the link” so your teacher can open it.",
    uploading: (pct: number) => `Uploading… ${pct}%`,
    help: `PDF, Word, text or a photo (JPG, PNG, WEBP), up to ${MAX_DELIVERABLE_LABEL}, or a link. Your teacher sees it together with your answer.`,
    uploadFailed: "The file couldn't be uploaded. Try again.",
    linkFailed: "The link couldn't be saved. Try again.",
    removeFailed: "It couldn't be removed. Try again.",
    fileProblem: (file: FileLike) => deliverableFileProblemEn(file),
    linkProblem: (raw: string) => deliverableLinkProblemEn(raw),
  },
  error: (err: unknown): string => {
    if (err instanceof ApiError) return errorEn({ code: err.code, message: err.message, status: err.status, fields: err.fields });
    if (err instanceof Error && err.name === "AbortError") return "";
    return KNOWN_EN["Ocurrió un error inesperado."]!;
  },
  streamError: (e: { message: string; code: string }): string => errorEn(e),
  fieldError: (field: string, message: string): string => fieldErrorEn(field, message),
  availability: (availability: LinkAvailability, message: string | null): string | null =>
    availability === "available" ? message : LINK_AVAILABILITY_MESSAGE_EN[availability],
};

export const STUDENT_STRINGS: Record<ActivityLanguage, StudentStrings> = { es, en };

// ── Context ──

const StudentLangContext = createContext<ActivityLanguage>("es");

/**
 * The language of the student's screens. While an English activity is shown, <html lang> says
 * so (screen readers pick the right voice); it goes back when the page closes.
 */
export function StudentLangProvider({ lang, children }: { lang: ActivityLanguage; children: ReactNode }) {
  useEffect(() => {
    if (lang !== "en") return;
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = "en";
    return () => {
      root.lang = previous || "es";
    };
  }, [lang]);
  return <StudentLangContext.Provider value={lang}>{children}</StudentLangContext.Provider>;
}

export const useStudentLang = (): ActivityLanguage => useContext(StudentLangContext);

/** The student's screen texts in the activity's language. */
export const useT = (): StudentStrings => STUDENT_STRINGS[useContext(StudentLangContext)];
