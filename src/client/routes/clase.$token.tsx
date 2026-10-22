import { createFileRoute } from "@tanstack/react-router";
import type { StudentLinkInfo, StudentWorkspace } from "@shared/contracts/student";
import { languageOf } from "@shared/domain/language";
import { ApiError } from "@client/lib/api";
import { usePageTitle } from "@client/lib/page-title";
import { useStudentLink } from "@client/features/student/api";
import { ClosedScreen, EntryError, EntryLoading, JoinScreen } from "@client/features/student/entry";
import { STUDENT_STRINGS, StudentLangProvider } from "@client/features/student/i18n";
import { Workspace } from "@client/features/student/workspace";

// Student page opened from the activity link (phones first). No account: name + device cookie.
// Every screen follows the activity's language: from the link info before joining, from the
// workspace after (Spanish while loading or when the link has no activity details).
export const Route = createFileRoute("/clase/$token")({
  component: StudentPage,
});

function StudentPage() {
  const { token } = Route.useParams();
  const q = useStudentLink(token);
  const info = q.data;
  const lang = languageOf(info?.workspace?.activity.language ?? info?.activity?.language);
  const t = STUDENT_STRINGS[lang].page;
  // A failed heartbeat (no signal for a moment) keeps the last good screen; only a link that
  // no longer exists, or a first load that failed, replaces it.
  const gone = q.error instanceof ApiError && q.error.status === 404;
  const failed = q.isError && (gone || !info);
  const title = info?.activity?.title;

  usePageTitle(
    q.isPending
      ? t.loading
      : failed
        ? gone
          ? t.notFound
          : t.offline
        : info?.workspace
          ? [title, info.availability !== "available" ? t.closed[info.availability] : null]
          : info && info.availability !== "available"
            ? [title, t.closed[info.availability]]
            : [title, t.join],
    { noindex: true },
  );

  let screen;
  if (q.isPending) screen = <EntryLoading />;
  else if (failed || !info) screen = <EntryError token={token} error={q.error} onRetry={() => void q.refetch()} />;
  // A finished work stays readable on its own device after the teacher closes the link.
  else if (info.workspace) {
    screen = (
      <Workspace key={info.workspace.resumeCode} token={token} info={info as StudentLinkInfo & { workspace: StudentWorkspace }} />
    );
  } else if (info.availability !== "available") {
    screen = <ClosedScreen token={token} info={info} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  } else screen = <JoinScreen token={token} info={info} />;
  return <StudentLangProvider lang={lang}>{screen}</StudentLangProvider>;
}
