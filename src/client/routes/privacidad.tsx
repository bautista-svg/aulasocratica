import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMe } from "@client/lib/session";
import { buttonClass } from "@client/components/ui/button";
import { PublicLayout } from "@client/features/account/public-layout";
import { usePageTitle } from "@client/lib/page-title";

export const Route = createFileRoute("/privacidad")({
  component: PrivacyPage,
});

const SECTIONS = [
  ["resumen", "En pocas palabras"],
  ["datos", "Qué datos se guardan"],
  ["para-que", "Para qué se usan"],
  ["quien", "Quién los procesa"],
  ["tiempo", "Cuánto tiempo se guardan"],
  ["borrar", "Cómo se borran"],
  ["menores", "Alumnos menores de edad"],
  ["derechos", "Tus derechos"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-6 border-t border-line pt-8">
      <h2 id={`${id}-t`} className="font-display text-2xl font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[16px] leading-7 text-text-2 [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function PrivacyPage() {
  usePageTitle("Privacidad");
  const me = useMe();
  const hasWorkspace = Boolean(me.data?.teacher);
  return (
    <PublicLayout
      nav={
        <Link to={hasWorkspace ? "/app" : "/ingresar"} className={buttonClass("ghost", "sm")}>
          {hasWorkspace ? "Mi espacio" : "Ya tengo cuenta"}
        </Link>
      }
    >
      <article className="mx-auto max-w-[720px] px-5 pt-6 pb-20 sm:px-8 sm:pt-12">
        <p className="mb-3 text-sm font-semibold text-lilac-ink">Privacidad</p>
        <h1 className="font-display text-[36px] leading-tight font-semibold text-ink sm:text-[44px]">Qué pasa con los datos</h1>
        <p className="mt-4 text-[17px] leading-8 text-text-2">
          Esta página explica, sin letra chica, qué guarda Aula Socrática, para qué, quién lo procesa, cuánto tiempo y cómo se borra.
        </p>

        <nav aria-label="En esta página" className="mt-8 rounded-lg border border-line bg-surface p-5 shadow-1">
          <p className="text-sm font-semibold text-text">En esta página</p>
          <ol className="mt-2 grid gap-1 text-[15px] sm:grid-cols-2">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-lilac">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          <Section id="resumen" title="En pocas palabras">
            <ul>
              <li>
                De los alumnos guardamos solo el nombre que escriben y lo que hacen en las actividades. No pedimos correo, teléfono, documento ni
                fotos.
              </li>
              <li>
                Los docentes pueden usar la app sin cuenta. Si crean una, guardamos su correo y una huella de su contraseña, nunca la contraseña.
              </li>
              <li>
                Para que el tutor converse, el contenido de la actividad y los mensajes se envían a Anthropic, la empresa que provee el modelo de IA.
              </li>
              <li>No hay publicidad ni herramientas de seguimiento de terceros, y los datos no se venden.</li>
              <li>El docente puede borrar en cualquier momento el trabajo de un alumno, una actividad, un aula o todo su espacio.</li>
            </ul>
          </Section>

          <Section id="datos" title="Qué datos se guardan">
            <p>
              <strong>Del docente</strong>
            </p>
            <ul>
              <li>
                El nombre que le pongas a tu espacio, si le ponés uno. Lo ven tus alumnos en la pantalla de entrada de tus actividades («Con Profe
                Laura»).
              </li>
              <li>
                Si creás una cuenta: tu correo, una huella (hash) de tu contraseña y otra del código de recuperación. Con esas huellas se puede
                comprobar que la contraseña es correcta, pero no se puede saber cuál es.
              </li>
              <li>
                Lo que creás: aulas, actividades, tutores, materiales, informes y los archivos que subís (PDF, Word, imágenes), junto con el texto que
                se lee de ellos.
              </li>
              <li>
                Una cookie en tu navegador que mantiene abierto tu espacio en ese dispositivo. No usamos cookies de publicidad ni de seguimiento.
              </li>
              <li>
                Registros de seguridad (por ejemplo, inicios de sesión, intentos fallidos, borrados) con la dirección IP desde la que se hicieron, y
                la cantidad de uso de IA de cada espacio (solo números, sin el contenido) para controlar el límite diario.
              </li>
            </ul>
            <p>
              <strong>De los alumnos</strong>
            </p>
            <ul>
              <li>El nombre que escriben al entrar a una actividad (o que carga el docente en la lista del aula).</li>
              <li>Sus respuestas: la respuesta inicial, la final y la reflexión.</li>
              <li>Los mensajes que intercambian con el tutor.</li>
              <li>Eventos de la actividad: cuándo entró, si pidió una pista, un ejemplo o dijo que no entendió, cuándo terminó.</li>
              <li>
                Dos señales que registra el navegador durante la actividad: si pegó un texto copiado de afuera y si salió de la actividad (otra
                pestaña u otra aplicación) por 10 segundos o más. Se registra que pasó, no qué estaba mirando.
              </li>
              <li>
                Sugerencias de la IA sobre su trabajo (resúmenes, niveles de rúbrica propuestos, alertas e interpretaciones) y lo que el docente
                decide sobre ellas: confirmarlas, editarlas o descartarlas.
              </li>
              <li>
                Un dato guardado en su dispositivo para poder seguir donde dejó (y lo que escribió y todavía no envió, que se borra al enviarlo o a
                los 30 días), y un código corto para continuar desde otro dispositivo.
              </li>
            </ul>
          </Section>

          <Section id="para-que" title="Para qué se usan">
            <ul>
              <li>Para que el tutor pueda conversar con cada alumno sobre la actividad.</li>
              <li>Para que el docente vea el trabajo en vivo, el recorrido de cada alumno y arme sus informes.</li>
              <li>Para la seguridad del servicio: evitar abusos, frenar intentos de adivinar contraseñas y controlar el costo de la IA.</li>
            </ul>
            <p>No se usan para publicidad, no se venden y no se comparten con nadie más que los proveedores que se nombran abajo.</p>
          </Section>

          <Section id="quien" title="Quién los procesa">
            <ul>
              <li>
                <strong>El servidor de la app.</strong> Aula Socrática funciona en un servidor privado que administra el responsable de este sitio.
                Ahí están la base de datos y los archivos. Como administrador del servidor tiene acceso técnico a esos datos; el panel de
                administración que usa para supervisar el servicio muestra solo cantidades (espacios, aulas, uso de IA) y correos enmascarados, sin
                nombres de alumnos ni conversaciones.
              </li>
              <li>
                <strong>Anthropic</strong>, la empresa que provee el modelo de IA (Claude). Para generar las respuestas del tutor y las sugerencias
                recibe la consigna, el material y los objetivos de la actividad, las respuestas y los mensajes del alumno y, cuando hace falta
                leerlos, los archivos que sube el docente. También recibe los datos de un informe (incluidos los nombres de los alumnos que figuran en
                él) cuando el docente pide una propuesta de texto. Anthropic trata ese contenido según sus condiciones para el uso de su servicio.
              </li>
              <li>
                <strong>Cloudflare</strong>, que entrega y protege el sitio. Todo el tráfico pasa por su red, y su medición de visitas (Cloudflare Web
                Analytics) registra datos agregados de las páginas, como cantidad de visitas y tiempos de carga, sin cookies.
              </li>
            </ul>
          </Section>

          <Section id="tiempo" title="Cuánto tiempo se guardan">
            <ul>
              <li>
                <strong>Espacio sin cuenta y vacío</strong> (sin aulas, materiales ni informes): se borra a los 30 días sin usarlo.
              </li>
              <li>
                <strong>Espacio sin cuenta con contenido:</strong> se borra a los 12 meses sin usarlo.
              </li>
              <li>
                <strong>Espacio con cuenta:</strong> se guarda hasta que el docente lo borre.
              </li>
              <li>Registros de seguridad: 180 días. Cantidades de uso de IA: 400 días.</li>
              <li>Las sesiones vencidas y las respuestas del tutor que quedaron cortadas se borran solas.</li>
            </ul>
            <p>Cuando se borra un espacio, se borra con todo lo que tiene adentro, incluidos los trabajos de sus alumnos.</p>
          </Section>

          <Section id="borrar" title="Cómo se borran">
            <ul>
              <li>
                El docente puede borrar el trabajo de un alumno, un alumno, una actividad, un aula o <strong>todo su espacio</strong> (en Mi espacio →
                Borrar mi espacio). Lo borrado se elimina de la base de datos y los archivos se eliminan del disco del servidor.
              </li>
              <li>
                Los informes guardados se actualizan solos: los datos de un alumno borrado desaparecen de ellos, su nombre se reemplaza en los textos
                del docente y los informes individuales de ese alumno se borran.
              </li>
              <li>Los alumnos pueden pedirle a su docente que borre su trabajo o su nombre.</li>
            </ul>
          </Section>

          <Section id="menores" title="Alumnos menores de edad">
            <p>
              La mayoría de los alumnos son menores de edad, por eso la app pide lo mínimo: solo un nombre, sin correo ni contraseña. Recomendamos que
              el docente les pida no escribir datos personales (dirección, teléfono, documento) en el chat. El docente puede leer todas las
              conversaciones, y las señales de seguridad (por ejemplo, un mensaje que sugiere una crisis) le aparecen como alertas para que las
              revise.
            </p>
          </Section>

          <Section id="derechos" title="Tus derechos">
            <p>
              En la Argentina, la Ley 25.326 de Protección de Datos Personales reconoce el derecho a acceder a los propios datos, a pedir que se
              corrijan y a pedir que se supriman. En Aula Socrática el docente puede ver, corregir y borrar todo lo de su espacio desde la app; los
              alumnos (o sus familias) pueden pedírselo a su docente. La autoridad de control de esa ley es la Agencia de Acceso a la Información
              Pública.
            </p>
          </Section>
        </div>

        <p className="mt-12 text-sm text-text-3">Última actualización: octubre de 2026.</p>
      </article>
    </PublicLayout>
  );
}
