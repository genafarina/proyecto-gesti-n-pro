export const normalizeFinancialSearch = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function matchesFinancialSearch(query: string, values: unknown[]) {
  const haystack = values.map(normalizeFinancialSearch).join(" ");
  return normalizeFinancialSearch(query)
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
