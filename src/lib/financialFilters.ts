import { getGeneralExpensePeriodRange, type GeneralExpensePeriod } from "./generalExpenses";
import { matchesFinancialSearch } from "./financialSearch";
import { moneyCents } from "./invoices";

export type FinancialFiltersValue = Record<string, string>;
export const initialFinancialFilters = { period: "all", from: "", to: "", query: "" };
export function clearFinancialFilters(value: FinancialFiltersValue): FinancialFiltersValue {
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, ["from", "to", "query"].includes(key) ? "" : "all"]),
  );
}
export function updateFinancialFilter(
  value: FinancialFiltersValue,
  key: string,
  next: string,
): FinancialFiltersValue {
  return {
    ...value,
    [key]: next,
    ...(key === "clientId"
      ? { projectId: "all", ...("invoiceId" in value ? { invoiceId: "all" } : {}) }
      : {}),
  };
}
export const financialPeriodLabels: Record<GeneralExpensePeriod, string> = {
  this_month: "Este mes",
  previous_month: "Mes anterior",
  last_3_months: "Últimos 3 meses",
  this_year: "Este año",
  custom: "Rango personalizado",
  all: "Todos",
};
type FilterRecord = {
  date: string;
  search: unknown[];
  fields: Record<string, string | string[] | null | undefined>;
};
export function filterFinancialRows<T>(
  rows: T[],
  filters: FinancialFiltersValue,
  describe: (row: T) => FilterRecord,
  now = new Date(),
) {
  const range = getGeneralExpensePeriodRange(
    filters.period as GeneralExpensePeriod,
    filters.from,
    filters.to,
    now,
  );
  return rows.filter((row) => {
    const record = describe(row);
    if ((range.from && record.date < range.from) || (range.to && record.date > range.to))
      return false;
    if (!matchesFinancialSearch(filters.query ?? "", record.search)) return false;
    return Object.entries(filters).every(([key, value]) => {
      if (["period", "from", "to", "query"].includes(key) || !value || value === "all") return true;
      const field = record.fields[key];
      return Array.isArray(field) ? field.includes(value) : field === value;
    });
  });
}

export function financialTotals<T>(
  rows: T[],
  amount: (row: T) => number | string,
  currency: (row: T) => string,
) {
  const totals: Record<string, number> = {};
  rows.forEach((row) => {
    const code = currency(row);
    totals[code] = (totals[code] ?? 0) + moneyCents(amount(row));
  });
  return Object.entries(totals)
    .sort()
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }));
}
