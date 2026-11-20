import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { observeDataSync, type DataSyncSnapshot } from "./dataSyncStatus";

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const snapshots: DataSyncSnapshot[] = [];
  const monitor = observeDataSync(client, true, (snapshot) => snapshots.push(snapshot));
  return { client, monitor, status: () => snapshots.at(-1)! };
}

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("observación de operaciones de datos", () => {
  test("empieza sin verificar, ignora cambios locales y confirma la primera lectura", async () => {
    const { client, monitor, status } = setup();
    expect(status()).toEqual({
      online: true, pending: false, readFailed: false, failedWrites: 0, confirmed: null,
    });
    client.setQueryData(["local"], "cached");
    await client.fetchQuery({
      queryKey: ["schema-probe"],
      meta: { confirmsDataSync: false },
      queryFn: async () => false,
    });
    expect(status().confirmed).toBeNull();

    const request = deferred();
    const reading = client.fetchQuery({ queryKey: ["remote"], queryFn: () => request.promise });
    expect(status()).toMatchObject({ pending: true, confirmed: null });

    request.resolve("remote");
    await reading;
    expect(status()).toMatchObject({ pending: false, confirmed: "read" });
    monitor.stop();
  });

  test("pierde la verificación al desconectarse y exige una respuesta tras reconectar", async () => {
    const { client, monitor, status } = setup();
    const read = () => client.fetchQuery({ queryKey: ["remote"], queryFn: async () => "remote" });
    await read();
    monitor.setOnline(false);
    expect(status()).toMatchObject({ online: false, confirmed: null });
    monitor.setOnline(true);
    expect(status()).toMatchObject({ online: true, confirmed: null });
    await read();
    expect(status()).toMatchObject({ online: true, confirmed: "read" });
    monitor.stop();
  });

  test("distingue error de lectura y recuperación de esa consulta", async () => {
    const { client, monitor, status } = setup();
    const queryKey = ["remote"];
    const error = new Error("Error de Supabase");
    await expect(client.fetchQuery({
      queryKey, queryFn: async () => { throw error; },
    })).rejects.toThrow(error.message);
    expect(status()).toMatchObject({ online: true, pending: false, readFailed: true, confirmed: null });
    await client.fetchQuery({ queryKey, queryFn: async () => "recovered" });
    expect(status()).toMatchObject({ readFailed: false, confirmed: "read" });
    monitor.stop();
  });

  test("una escritura solo se confirma cuando termina exitosamente", async () => {
    const { client, monitor, status } = setup();
    const request = deferred();
    const mutation = client.getMutationCache().build(client, { mutationFn: () => request.promise });
    const writing = mutation.execute(undefined);
    expect(status()).toMatchObject({ pending: true, confirmed: null });
    request.resolve("saved");
    await writing;
    expect(status()).toMatchObject({ pending: false, failedWrites: 0, confirmed: "write" });
    monitor.stop();
  });

  test("un fallo de escritura persiste después de salir de caché y volver a estar en línea", async () => {
    const { client, monitor, status } = setup();
    const cache = client.getMutationCache();
    const error = new Error("Error de Supabase");
    const mutation = cache.build(client, { mutationFn: async () => { throw error; } });
    await expect(mutation.execute(undefined)).rejects.toThrow(error.message);
    expect(status()).toMatchObject({ pending: false, failedWrites: 1, confirmed: null });
    cache.remove(mutation);
    monitor.setOnline(false);
    monitor.setOnline(true);
    expect(status().failedWrites).toBe(1);
    monitor.dismissWriteFailures();
    expect(status()).toMatchObject({ failedWrites: 0, confirmed: null });
    monitor.stop();
  });

  test.each([true, false])("escrituras simultáneas conservan el fallo (éxito primero: %s)", async (successFirst) => {
    const { client, monitor, status } = setup();
    const goodRequest = deferred();
    const badRequest = deferred();
    const cache = client.getMutationCache();
    const good = cache.build(client, { mutationFn: () => goodRequest.promise }).execute(undefined);
    const bad = cache.build(client, { mutationFn: () => badRequest.promise }).execute(undefined);
    const failed = expect(bad).rejects.toThrow("write failed");

    if (successFirst) {
      goodRequest.resolve("saved");
      await good;
      expect(status()).toMatchObject({ pending: true, confirmed: "write", failedWrites: 0 });
    }

    badRequest.reject(new Error("write failed"));
    await failed;
    expect(status()).toMatchObject({ pending: !successFirst, failedWrites: 1 });

    if (!successFirst) {
      goodRequest.resolve("saved");
      await good;
    }

    expect(status()).toMatchObject({ pending: false, confirmed: "write", failedWrites: 1 });
    monitor.stop();
  });
});
