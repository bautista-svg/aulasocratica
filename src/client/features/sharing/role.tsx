// The teacher's role in the classroom on screen ("Compartir aula"). Pages that show one classroom
// (or something inside it) provide it; components below ask `useCan("edit" | "manage" | "own")` to
// hide the actions their role does not allow. The server checks the same rules on every change.
import { createContext, useContext, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { Notice } from "@client/components/ui/misc";
import { cn } from "@client/lib/cn";
import { can, type ClassroomAction, type ClassroomRole } from "@shared/domain/sharing";

const RoleContext = createContext<ClassroomRole>("owner");

export function RoleProvider({ role, children }: { role: ClassroomRole; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);

export function useCan(action: ClassroomAction): boolean {
  return can(useContext(RoleContext), action);
}

/**
 * Disables every control inside (a native disabled fieldset) when the role cannot edit: for panels
 * where almost everything is an action (evaluation, x-ray). Links keep working.
 */
export function EditGuard({ children, className }: { children: ReactNode; className?: string }) {
  const canEdit = useCan("edit");
  return (
    <fieldset disabled={!canEdit} className={cn("m-0 min-w-0 border-0 p-0", className)}>
      {children}
    </fieldset>
  );
}

/** Shown on a reader's screens: why there are no buttons to change things, and what to do. */
export function ReadOnlyNotice({ className }: { className?: string }) {
  const role = useRole();
  if (role !== "reader") return null;
  return (
    <Notice
      tone="lilac"
      className={className}
      title={
        <span className="inline-flex items-center gap-1.5">
          <Eye className="size-4" aria-hidden="true" />
          Tenés acceso de lectura a esta aula
        </span>
      }
    >
      Podés ver todo, pero no hacer cambios. Si necesitás editar, pedile a quien la comparte que te cambie el rol.
    </Notice>
  );
}
