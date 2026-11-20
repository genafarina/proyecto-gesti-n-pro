import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { observeDataSync, type DataSyncSnapshot } from "@/lib/dataSyncStatus";
import { cn } from "@/lib/utils";

export function DataSyncStatus() {
  const client = useQueryClient();
  const monitor = useRef<ReturnType<typeof observeDataSync> | null>(null);
  const [status, setStatus] = useState<DataSyncSnapshot>({
    online: typeof navigator === "undefined" || navigator.onLine,
    pending: false,
    readFailed: false,
    failedWrites: 0,
    confirmed: null,
  });

  useEffect(() => {
    const observer = observeDataSync(client, navigator.onLine, setStatus);
    monitor.current = observer;
    const updateConnection = () => observer.setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      observer.stop();
      monitor.current = null;
    };
  }, [client]);

  const confirmation = status.confirmed === "write" ? "Escritura confirmada" : "Lectura confirmada";
  const activity = status.pending ? "Operaciones pendientes" : null;
  const syncLabel = status.confirmed ? confirmation : "Supabase sin verificar";
  const error = status.readFailed || status.failedWrites > 0;
  const writeWarning = status.failedWrites === 1
    ? "1 escritura fallida"
    : `${status.failedWrites} escrituras fallidas`;
  const label = [
    !status.online ? "Sin conexión del navegador" : null,
    activity,
    status.online && !activity && !error ? syncLabel : null,
    status.readFailed ? "Error de lectura" : null,
    status.failedWrites > 0 ? writeWarning : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <div role="status" className="flex min-w-0 items-center gap-1.5" title={label}>
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full bg-muted-foreground",
            error && "bg-destructive",
            !error && !status.online && "bg-amber-500",
            !error && status.online && status.pending && "motion-safe:animate-pulse bg-sky-500",
            !error && status.online && !status.pending && status.confirmed && "bg-emerald-600",
          )}
        />
        <span className="leading-tight">{label}</span>
      </div>
      {status.failedWrites > 0 && (
        <button
          type="button"
          className="shrink-0 rounded p-1 hover:bg-muted focus-visible:outline-2"
          aria-label="Descartar avisos de escrituras fallidas"
          title="Descartar avisos de escrituras fallidas"
          onClick={() => monitor.current?.dismissWriteFailures()}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
