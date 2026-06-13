import { supabase } from "@/integrations/supabase/client";

export const normalizeClientName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export const normalizeEntityCode = (code: string) =>
  normalizeClientName(code).replace(/\s+/g, "");

export const generateClientCode = (name: string) => {
  const normalized = normalizeClientName(name);
  if (!normalized) return "";

  const words = normalized.split(" ");
  if (words.length === 1) return words[0].slice(0, 2);
  return words.map((word) => word[0]).join("");
};

export const makeUniqueClientCode = (
  name: string,
  existingCodes: Iterable<string>,
) => {
  const baseCode = generateClientCode(name);
  if (!baseCode) return "";

  const usedCodes = new Set(
    Array.from(existingCodes, normalizeEntityCode).filter(Boolean),
  );
  if (!usedCodes.has(baseCode)) return baseCode;

  let suffix = 2;
  while (usedCodes.has(`${baseCode}${suffix}`)) suffix += 1;
  return `${baseCode}${suffix}`;
};

export const formatProjectCode = (
  clientCode: string,
  projectNumber: number,
) => `${normalizeEntityCode(clientCode)}-${String(projectNumber).padStart(2, "0")}`;

export const formatProjectLabel = (code: string, name: string) =>
  `${code} - ${name}`;

export const getNextProjectNumber = async (clientId: string) => {
  const { data, error } = await supabase
    .from("projects")
    .select("project_number")
    .eq("client_id", clientId)
    .order("project_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.project_number ?? 0) + 1;
};

export const isDuplicateCodeError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "23505" ||
    candidate.message?.toLowerCase().includes("duplicate") === true
  );
};
