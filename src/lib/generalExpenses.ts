import type { Enums } from "@/integrations/supabase/types";

export type GeneralExpense = {
  id: string;
  expense_date: string;
  category: string;
  expense_type: string;
  status: string;
  payee: string | null;
  description: string;
  amount: number | string;
  payment_method: Enums<"payment_method">;
  payment_account_id: string;
  other_payment_account_detail: string | null;
  receipt_url: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PaymentAccount = {
  id: string;
  name: string;
  type: string;
  active: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type GeneralExpensePeriod =
  | "this_month"
  | "previous_month"
  | "last_3_months"
  | "this_year"
  | "custom"
  | "all";

export type GeneralExpenseFilters = {
  period: GeneralExpensePeriod;
  customFrom?: string;
  customTo?: string;
  category: string;
  expenseType: string;
  status: string;
  paymentMethod: string;
  paymentAccountId: string;
  search: string;
};

const numberValue = (value: number | string) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function getGeneralExpensePeriodRange(
  period: GeneralExpensePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
) {
  if (period === "all") return { from: undefined, to: undefined };
  if (period === "custom") return { from: customFrom || undefined, to: customTo || undefined };

  let from = new Date(now.getFullYear(), now.getMonth(), 1);
  let to = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  if (period === "previous_month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === "last_3_months") {
    from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  } else if (period === "this_year") {
    from = new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), 11, 31);
  }

  return { from: dateKey(from), to: dateKey(to) };
}

const searchable = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function filterGeneralExpenses(expenses: GeneralExpense[], filters: GeneralExpenseFilters) {
  const { from, to } = getGeneralExpensePeriodRange(
    filters.period,
    filters.customFrom,
    filters.customTo,
  );
  const query = searchable(filters.search.trim());

  return expenses.filter((expense) => {
    if (from && expense.expense_date < from) return false;
    if (to && expense.expense_date > to) return false;
    if (filters.category !== "all" && expense.category !== filters.category) return false;
    if (filters.expenseType !== "all" && expense.expense_type !== filters.expenseType) return false;
    if (filters.status !== "all" && expense.status !== filters.status) return false;
    if (filters.paymentMethod !== "all" && expense.payment_method !== filters.paymentMethod)
      return false;
    if (
      filters.paymentAccountId !== "all" &&
      expense.payment_account_id !== filters.paymentAccountId
    )
      return false;
    if (
      query &&
      !searchable(expense.payee).includes(query) &&
      !searchable(expense.description).includes(query)
    )
      return false;
    return true;
  });
}

export const activeGeneralExpenses = (expenses: GeneralExpense[]) =>
  expenses.filter((expense) => expense.status !== "cancelled");

export const totalGeneralExpenses = (expenses: GeneralExpense[]) =>
  activeGeneralExpenses(expenses).reduce(
    (total, expense) => total + numberValue(expense.amount),
    0,
  );

export const pendingGeneralExpenses = (expenses: GeneralExpense[]) =>
  expenses
    .filter((expense) => expense.status === "pending")
    .reduce((total, expense) => total + numberValue(expense.amount), 0);

export const totalGeneralExpensesByType = (expenses: GeneralExpense[], expenseType: string) =>
  activeGeneralExpenses(expenses)
    .filter((expense) => expense.expense_type === expenseType)
    .reduce((total, expense) => total + numberValue(expense.amount), 0);

export function totalGeneralExpensesByCategory(expenses: GeneralExpense[]) {
  return activeGeneralExpenses(expenses).reduce<Record<string, number>>((totals, expense) => {
    totals[expense.category] = (totals[expense.category] ?? 0) + numberValue(expense.amount);
    return totals;
  }, {});
}

export function getTopGeneralExpenseCategory(expenses: GeneralExpense[]) {
  const entries = Object.entries(totalGeneralExpensesByCategory(expenses));
  if (!entries.length) return null;
  return entries.reduce((top, current) => (current[1] > top[1] ? current : top))[0];
}

const csvCell = (value: string | number | null | undefined) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;

export function generalExpensesToCsv(
  expenses: GeneralExpense[],
  accountNames: Record<string, string>,
  labels: {
    categories: Record<string, string>;
    types: Record<string, string>;
    statuses: Record<string, string>;
    paymentMethods: Record<string, string>;
  },
) {
  const header = [
    "Fecha",
    "Categoría",
    "Tipo de gasto",
    "Estado",
    "Proveedor / destinatario",
    "Descripción",
    "Monto",
    "Método de pago",
    "Cuenta de pago",
    "Detalle de otra cuenta",
    "Observaciones",
  ];

  const rows = expenses.map((expense) => [
    expense.expense_date,
    labels.categories[expense.category] ?? expense.category,
    labels.types[expense.expense_type] ?? expense.expense_type,
    labels.statuses[expense.status] ?? expense.status,
    expense.payee,
    expense.description,
    numberValue(expense.amount).toFixed(2),
    labels.paymentMethods[expense.payment_method] ?? expense.payment_method,
    accountNames[expense.payment_account_id] ?? "",
    expense.other_payment_account_detail,
    expense.notes,
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
