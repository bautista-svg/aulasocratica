import { createFileRoute } from "@tanstack/react-router";
import type { StudentLinkInfo, StudentWorkspace } from "@shared/contracts/student";
import { useStudentLink } from "@client/features/student/api";
import { useStudentHead } from "@client/features/student/hooks";
import { ClosedScreen, EntryError, EntryLoading, JoinScreen } from "@client/features/student/entry";
import { Workspace } from "@client/features/student/workspace";

// Student page opened from the activity link (phones first). No account: name + device cookie.
export const Route = createFileRoute("/clase/$token")({
  component: StudentPage,
});

function StudentPage() {
  const { token } = Route.useParams();
  const q = useStudentLink(token);
  useStudentHead(q.data?.activity?.title ?? null);

  if (q.isPending) return <EntryLoading />;
  if (q.isError) return <EntryError error={q.error} onRetry={() => void q.refetch()} />;
  const info = q.data;
  if (info.availability !== "available") {
    return <ClosedScreen info={info} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  }
  if (!info.workspace) return <JoinScreen token={token} info={info} />;
  return <Workspace key={info.workspace.resumeCode} token={token} info={info as StudentLinkInfo & { workspace: StudentWorkspace }} />;
}
