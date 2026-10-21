// Owned by the "live monitor" module. Rendered inside the activity page ("En vivo" tab).
// Contract: shows ONLY the students who joined THIS activity (its learning sessions).
export function LivePanel({ activityId }: { activityId: string }) {
  return <p className="text-text-2">Vista en vivo pendiente ({activityId}).</p>;
}
