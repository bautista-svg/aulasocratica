import { createFileRoute } from "@tanstack/react-router";
import type { LinkAvailability } from "@shared/domain/access-rules";
import type { StudentLinkInfo, StudentWorkspace } from "@shared/contracts/student";
import { ApiError } from "@client/lib/api";
import { usePageTitle } from "@client/lib/page-title";
import { useStudentLink } from "@client/features/student/api";
import { ClosedScreen, EntryError, EntryLoading, JoinScreen } from "@client/features/student/entry";
import { Workspace } from "@client/features/student/workspace";

// Student page opened from the activity link (phones first). No account: name + device cookie.
export const Route = createFileRoute("/clase/$token")({
  component: StudentPage,
});

const CLOSED_TITLE: Record<Exclude<LinkAvailability, "available">, string> = {
  inactive: "Cerrada",
  not_started: "Todavía no empezó",
  expired: "Terminada",
  unpublished: "No disponible",
  archived: "No disponible",
};

function StudentPage() {
  const { token } = Route.useParams();
  const q = useStudentLink(token);
  const info = q.data;
  // A failed heartbeat (no signal for a moment) keeps the last good screen; only a link that
  // no longer exists, or a first load that failed, replaces it.
  const gone = q.error instanceof ApiError && q.error.status === 404;
  const failed = q.isError && (gone || !info);
  const title = info?.activity?.title;

  usePageTitle(
    q.isPending
      ? "Actividad"
      : failed
        ? gone
          ? "Enlace no encontrado"
          : "Sin conexión"
        : info?.workspace
          ? [title, info.availability !== "available" ? CLOSED_TITLE[info.availability] : null]
          : info && info.availability !== "available"
            ? [title, CLOSED_TITLE[info.availability]]
            : [title, "Entrar"],
    { noindex: true },
  );

  if (q.isPending) return <EntryLoading />;
  if (failed || !info) return <EntryError token={token} error={q.error} onRetry={() => void q.refetch()} />;
  // A finished work stays readable on its own device after the teacher closes the link.
  if (info.workspace) {
    return (
      <Workspace key={info.workspace.resumeCode} token={token} info={info as StudentLinkInfo & { workspace: StudentWorkspace }} />
    );
  }
  if (info.availability !== "available") {
    return <ClosedScreen token={token} info={info} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  }
  return <JoinScreen token={token} info={info} />;
}
