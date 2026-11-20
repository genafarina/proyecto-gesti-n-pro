import type { QueryClient } from "@tanstack/react-query";

export type DataSyncSnapshot = {
  online: boolean;
  pending: boolean;
  readFailed: boolean;
  failedWrites: number;
  confirmed: "read" | "write" | null;
};

export function observeDataSync(
  client: QueryClient,
  online: boolean,
  onChange: (snapshot: DataSyncSnapshot) => void,
) {
  const queries = client.getQueryCache();
  const mutations = client.getMutationCache();
  // Keep failures even after React Query removes the corresponding cache entry.
  const failedWrites = new Set(
    mutations
      .getAll()
      .filter((mutation) => mutation.state.status === "error")
      .map((mutation) => mutation.mutationId),
  );
  let confirmed: DataSyncSnapshot["confirmed"] = null;

  function publish() {
    const reads = queries.getAll();
    onChange({
      online,
      pending:
        reads.some((query) => query.state.fetchStatus !== "idle") || client.isMutating() > 0,
      readFailed: reads.some((query) => query.state.status === "error"),
      failedWrites: failedWrites.size,
      confirmed,
    });
  }

  const unsubscribeQueries = queries.subscribe((event) => {
    if (
      online &&
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual &&
      event.query.meta?.confirmsDataSync !== false
    ) {
      confirmed = "read";
    }
    publish();
  });

  const unsubscribeMutations = mutations.subscribe((event) => {
    if (event.type === "updated") {
      if (event.action.type === "error") failedWrites.add(event.mutation.mutationId);
      if (event.action.type === "success") {
        failedWrites.delete(event.mutation.mutationId);
        if (online) confirmed = "write";
      }
    }
    publish();
  });

  publish();

  return {
    setOnline(next: boolean) {
      if (online === next) return;
      online = next;
      confirmed = null;
      publish();
    },
    dismissWriteFailures() {
      failedWrites.clear();
      publish();
    },
    stop() {
      unsubscribeQueries();
      unsubscribeMutations();
    },
  };
}
