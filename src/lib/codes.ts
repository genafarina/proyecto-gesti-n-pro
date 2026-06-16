// Lógica centralizada para códigos automáticos de clientes y proyectos.
// Única fuente de verdad: no duplicar en componentes.

import { supabase } from "@/integrations/supabase/client";

/** Mayúsculas, sin acentos, sin caracteres especiales, espacios colapsados. */
export function normalizeClientName(name: string): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Genera el código base de un cliente desde su nombre (sin resolver colisiones). */
export function generateClientCode(name: string): string {
  const s = normalizeClientName(name);
  if (!s) return "XX";
  const parts = s.split(" ").filter(Boolean);
  if (parts.length === 1) {
    const w = parts[0];
    return (w.length >= 2 ? w.slice(0, 2) : (w + "X").slice(0, 2));
  }
  let initials = parts.map((p) => p[0]).join("");
  if (initials.length < 2) initials = (initials + "X").slice(0, 2);
  return initials;
}

/** Resuelve unicidad agregando sufijo numérico (PD, PD2, PD3, ...). */
export function resolveUniqueClientCode(base: string, existing: Iterable<string>): string {
  const set = new Set(Array.from(existing).map((c) => c.toUpperCase()));
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(base + n)) n++;
  return base + n;
}

/** Formatea código de proyecto: CLIENTCODE-NN con padding 2 dígitos. */
export function formatProjectCode(clientCode: string, projectNumber: number): string {
  return `${clientCode}-${String(projectNumber).padStart(2, "0")}`;
}

/** Próximo número correlativo de proyecto para un cliente. */
export async function getNextProjectNumber(clientId: string): Promise<number> {
  const { data, error } = await supabase
    .from("projects")
    .select("project_number")
    .eq("client_id", clientId)
    .order("project_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.project_number ?? 0;
  return (max || 0) + 1;
}

/** Sanitiza un código tipeado por el usuario. */
export function sanitizeCode(code: string): string {
  return (code || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}
