import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Landing } from "@client/components/landing/landing";
import { useMe, useStartWorkspace } from "@client/lib/session";
import { errorMessage } from "@client/lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const me = useMe();
  const start = useStartWorkspace();
  const navigate = useNavigate();
  return (
    <Landing
      hasWorkspace={Boolean(me.data?.teacher)}
      starting={start.isPending}
      startError={start.isError ? errorMessage(start.error) : null}
      onStart={(e) => {
        e.preventDefault();
        start.mutate(undefined, { onSuccess: () => void navigate({ to: "/app" }) });
      }}
    />
  );
}
