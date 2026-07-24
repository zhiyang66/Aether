import { useWorkbenchStore } from "../store/workbenchStore";

export function Toast() {
  const toast = useWorkbenchStore((s) => s.toast);
  return (
    <div className={`toast${toast.visible ? " show" : ""}`} role="status">
      {toast.message}
    </div>
  );
}
