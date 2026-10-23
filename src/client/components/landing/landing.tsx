// The public landing. It is a pure component (plain anchors, a real <form>) so it can be
// prerendered to static HTML at build time and works before JavaScript loads.
import type { FormEvent } from "react";
import { Logo, LogoMark } from "../brand/logo";
import { buttonClass } from "../ui/button";

export interface LandingProps {
  hasWorkspace?: boolean;
  /** The workspace open on this device has an account (email + password). */
  hasAccount?: boolean;
  starting?: boolean;
  startError?: string | null;
  onStart?: (e: FormEvent<HTMLFormElement>) => void;
}

const EXAMPLE: { who: "student" | "tutor"; label?: string; text: string }[] = [
  { who: "student", label: "Respuesta inicial", text: "Creo que en la montaña el agua hierve más rápido porque hace más frío." },
  { who: "tutor", text: "¿Qué cambia en el aire cuando subís a una montaña alta?" },
  { who: "student", text: "Hay menos aire… ¿menos presión?" },
  { who: "tutor", text: "¿Y cómo pensás que esa presión se relaciona con el momento en que el agua empieza a hervir?" },
  {
    who: "student",
    label: "Respuesta final",
    text: "En la montaña el agua hierve a menos temperatura porque hay menos presión del aire, no porque haga frío.",
  },
];

const STEPS = [
  {
    title: "Creá la actividad",
    body: "Escribí la consigna y los objetivos, y sumá tu material: PDF, Word o fotos. Si querés, la IA te propone actividades a partir de ese material y vos revisás todo antes de publicar.",
  },
  {
    title: "Compartí el enlace",
    body: "Con un enlace o un código QR. Cada alumno entra con su nombre, desde el celular o la compu, sin cuentas ni contraseñas.",
  },
  {
    title: "Mirá cómo piensan",
    body: "En vivo ves en qué etapa está cada alumno y qué ayuda pidió. Después tenés el recorrido completo de cada uno, para leer o descargar en PDF.",
  },
];

export function Landing({ hasWorkspace, hasAccount, starting, startError, onStart }: LandingProps) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <a href="/" aria-label="Aula Socrática, inicio" className="inline-flex min-h-11 items-center">
          <Logo />
        </a>
        <nav aria-label="Cuenta" className="flex items-center gap-1">
          {/* A workspace without an account on this device must not hide signing in to an existing account. */}
          {/* On phones the hero already shows this button right below. */}
          {hasWorkspace && !hasAccount ? (
            <a href="/ingresar" className={buttonClass("ghost", "sm", "max-sm:hidden")}>
              Entrar con mi cuenta
            </a>
          ) : null}
          {hasWorkspace ? (
            <a href="/app" className={buttonClass("ghost", "sm")}>
              Mi espacio
            </a>
          ) : (
            <a href="/ingresar" className={buttonClass("ghost", "sm")}>
              Ya tengo cuenta
            </a>
          )}
        </nav>
      </header>

      <main id="contenido">
        <section className="mx-auto grid max-w-[1120px] gap-12 px-5 pt-8 pb-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pt-16 lg:pb-24">
          <div>
            <p className="mb-4 text-sm font-semibold tracking-wide text-lilac-ink">Para docentes de primaria y secundaria</p>
            <h1 className="font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-ink sm:text-[56px] lg:text-[64px]">
              Un tutor que pregunta <em className="font-medium text-lilac-ink">en vez de responder.</em>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-7 text-text-2 sm:text-lg sm:leading-8">
              Armá una actividad con tu material, compartí un enlace y tus alumnos la resuelven conversando con un tutor de IA
              que los guía con preguntas. Vos ves, en vivo, cómo cambia lo que piensan.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              {hasWorkspace ? (
                <a href="/app" className={buttonClass("primary", "lg", "sm:min-w-56")}>
                  Abrir mi espacio
                </a>
              ) : (
                <form method="post" action="/api/auth/start" onSubmit={onStart}>
                  <button type="submit" className={buttonClass("primary", "lg", "w-full sm:min-w-56")} disabled={starting} aria-busy={starting || undefined}>
                    {starting ? "Abriendo tu espacio…" : "Empezar sin cuenta"}
                  </button>
                </form>
              )}
              {hasWorkspace && !hasAccount ? (
                <a href="/ingresar" className={buttonClass("secondary", "lg")}>
                  Entrar con mi cuenta
                </a>
              ) : (
                <a href="#como-funciona" className={buttonClass("secondary", "lg")}>
                  Cómo funciona
                </a>
              )}
            </div>
            {startError ? (
              <p role="alert" className="mt-3 text-sm font-medium text-rose">
                {startError}
              </p>
            ) : null}
            <p className="mt-4 max-w-md text-sm leading-6 text-text-3">
              Sin registrarte: tu espacio queda guardado en este dispositivo. Cuando quieras, le agregás un correo y una contraseña
              para abrirlo desde otros.
            </p>

            <div className="mt-10 rounded-lg border border-line bg-surface px-4 py-3.5 text-[15px] text-text-2 shadow-1">
              <span className="font-semibold text-ink">¿Sos alumno o alumna?</span> Abrí el enlace que te pasó tu docente y escribí tu
              nombre. No hace falta nada más.
            </div>
          </div>

          {/* Signature: a student's thinking path, the way the teacher sees it. */}
          <figure className="relative">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Recorrido del pensamiento</span>
                <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-semibold text-text-2">Ejemplo ilustrativo</span>
              </div>
              <ol className="thread space-y-4">
                {EXAMPLE.map((m, i) => (
                  <li key={i} className="relative pl-9">
                    <span
                      aria-hidden="true"
                      className={
                        m.who === "tutor"
                          ? "absolute top-1.5 left-[5px] size-3.5 rounded-full border-2 border-lilac bg-surface"
                          : m.label === "Respuesta final"
                            ? "absolute top-1.5 left-[5px] size-3.5 rounded-full bg-leaf-bright"
                            : "absolute top-1.5 left-[5px] size-3.5 rounded-full bg-ink"
                      }
                    />
                    {m.who === "tutor" ? (
                      <>
                        <span className="sr-only">Pregunta del tutor: </span>
                        <p className="q-hang text-[17px] leading-7">{m.text}</p>
                      </>
                    ) : (
                      <div>
                        {m.label ? <p className="mb-0.5 text-xs font-semibold tracking-wide text-text-3 uppercase">{m.label}</p> : null}
                        <p className="text-[15px] leading-6 text-text">
                          <span className="sr-only">Alumno: </span>
                          {m.text}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <figcaption className="mt-3 px-1 text-sm leading-6 text-text-3">
              Así ve el docente cada trabajo: la primera idea, las preguntas del tutor y la respuesta final, en orden.
            </figcaption>
          </figure>
        </section>

        <section id="como-funciona" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-5 py-16 sm:px-8 lg:py-20">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Cómo funciona</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="font-display text-sm font-semibold text-lilac-ink italic">Paso {i + 1}</span>
                  <h3 className="mt-1.5 text-lg font-semibold text-ink">{s.title}</h3>
                  <p className="mt-2 leading-7 text-text-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-5 py-16 sm:px-8 lg:py-20">
          <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Lo que conviene saber</h2>
          <dl className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink">El tutor es una inteligencia artificial</dt>
              <dd className="mt-1.5 leading-7 text-text-2">
                Está instruido para no dar la respuesta y guiar con una pregunta por vez, pero puede equivocarse. Por eso todas las
                conversaciones quedan a tu disposición para revisarlas.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Las sugerencias de la IA son propuestas</dt>
              <dd className="mt-1.5 leading-7 text-text-2">
                Rúbricas, resúmenes, alertas e interpretaciones aparecen marcadas como sugerencias. Nada se califica ni se publica
                sin que lo confirmes vos.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Tu material, completo</dt>
              <dd className="mt-1.5 leading-7 text-text-2">
                Podés subir PDF de cualquier cantidad de páginas (hasta 60 MB), documentos de Word y fotos. El tutor trabaja con el
                texto que se lee de esos archivos.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Pocos datos de los alumnos</dt>
              <dd className="mt-1.5 leading-7 text-text-2">
                Los alumnos entran solo con su nombre: no pedimos correo, teléfono ni otros datos personales.{" "}
                <a
                  href="/privacidad"
                  className="-my-3 inline-flex min-h-11 items-center font-semibold text-ink underline decoration-lilac underline-offset-4"
                >
                  Cómo tratamos los datos
                </a>
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-8 text-sm text-text-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="size-5" /> Aula Socrática
          </span>
          <nav aria-label="Legal" className="flex gap-5">
            <a href="/privacidad" className="-my-3 inline-flex min-h-11 items-center hover:text-ink">
              Privacidad
            </a>
            <a href="/ingresar" className="-my-3 inline-flex min-h-11 items-center hover:text-ink">
              Ingresar
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
