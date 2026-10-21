// The app's toast container (sonner). Loaded on demand from the root route so sonner is not part
// of the entry chunk; toasts created before it mounts are replayed by sonner when it subscribes.
import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      closeButton
      containerAriaLabel="Avisos"
      toastOptions={{
        closeButtonAriaLabel: "Cerrar aviso",
        classNames: {
          toast: "!rounded-md !border !border-line !bg-surface !text-text !shadow-pop !font-sans",
          title: "!text-[15px] !font-semibold",
          description: "!text-sm !text-text-2",
          error: "!border-rose/30",
          success: "!border-leaf/30",
        },
      }}
    />
  );
}
