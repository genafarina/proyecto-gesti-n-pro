import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

type SyncState = "offline" | "syncing" | "error" | "synced";

const SYNC_COPY: Record<SyncState, { label: string; dot: string }> = {
  offline: {
    label: "Supabase sin conexión",
    dot: "bg-amber-500",
  },
  syncing: {
    label: "Sincronizando con Supabase…",
    dot: "animate-pulse bg-sky-400",
  },
  error: {
    label: "Error de sincronización",
    dot: "bg-destructive",
  },
  synced: {
    label: "Datos sincronizados",
    dot: "bg-emerald-500",
  },
};

export function DataSyncStatus() {
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const updateErrorState = () => {
      const queryFailed = queryClient
        .getQueryCache()
        .getAll()
        .some((query) => query.state.status === "error");
      let latestMutationStatus: string | undefined;
      let latestMutationAt = -1;

      for (const mutation of queryClient.getMutationCache().getAll()) {
        if (mutation.state.submittedAt > latestMutationAt) {
          latestMutationAt = mutation.state.submittedAt;
          latestMutationStatus = mutation.state.status;
        }
      }

      setHasError(queryFailed || latestMutationStatus === "error");
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const unsubscribeQueries = queryClient.getQueryCache().subscribe(updateErrorState);
    const unsubscribeMutations = queryClient.getMutationCache().subscribe(updateErrorState);

    updateErrorState();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient]);

  const state: SyncState = !online
    ? "offline"
    : fetching > 0 || mutating > 0
      ? "syncing"
      : hasError
        ? "error"
        : "synced";
  const copy = SYNC_COPY[state];

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-[11px] text-sidebar-foreground/75"
      role="status"
      aria-live="polite"
      title="Estado de sincronización de datos con Supabase"
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", copy.dot)}
        aria-hidden="true"
      />
      <span className="truncate">{copy.label}</span>
    </div>
  );
}
