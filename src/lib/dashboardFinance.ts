import { getGeneralExpensePeriodRange, type GeneralExpensePeriod } from "@/lib/generalExpenses";

export type DashboardPeriod = GeneralExpensePeriod;

export type DashboardPeriodSelection = {
  period: DashboardPeriod;
  customFrom?: string;
  customTo?: string;
};

export type PeriodDateRange = {
  from?: string;
  to?: string;
};

export type ProjectCollectionForDashboard = {
  amount: number | string;
  collection_date: string;
};

export type ProjectExpenseForDashboard = {
  amount: number | string;
  expense_date: string;
};

export type GeneralExpenseForDashboard = {
  amount: number | string;
  expense_date: string;
  expense_type: string;
  status: string;
};

export type DashboardPeriodSummary = {
  totalProjectCollections: number;
  totalProjectExpenses: number;
  projectResult: number;
  totalGeneralExpenses: number;
  generalOperationalExpenses: number;
  generalPersonalExpenses: number;
  generalInvestmentExpenses: number;
  pendingGeneralExpenses: number;
  operatingResult: number;
  finalResult: number;
};

const numberValue = (value: number | string) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function getPeriodDateRange(
  period: DashboardPeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): PeriodDateRange {
  return getGeneralExpensePeriodRange(period, customFrom, customTo, now);
}

export function filterByPeriod<T>(rows: T[], getDate: (row: T) => string, range: PeriodDateRange) {
  return rows.filter((row) => {
    const date = getDate(row);
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  });
}

const sumAmounts = (rows: { amount: number | string }[]) =>
  rows.reduce((total, row) => total + numberValue(row.amount), 0);

export function sumProjectCollectionsForPeriod(
  collections: ProjectCollectionForDashboard[],
  range: PeriodDateRange,
) {
  return sumAmounts(filterByPeriod(collections, (collection) => collection.collection_date, range));
}

export function sumProjectExpensesForPeriod(
  expenses: ProjectExpenseForDashboard[],
  range: PeriodDateRange,
) {
  return sumAmounts(filterByPeriod(expenses, (expense) => expense.expense_date, range));
}

export function sumGeneralExpensesForPeriod(
  expenses: GeneralExpenseForDashboard[],
  range: PeriodDateRange,
  options: { expenseType?: string; status?: string } = {},
) {
  return sumAmounts(
    filterByPeriod(expenses, (expense) => expense.expense_date, range).filter((expense) => {
      if (expense.status === "cancelled") return false;
      if (options.expenseType && expense.expense_type !== options.expenseType) return false;
      if (options.status && expense.status !== options.status) return false;
      return true;
    }),
  );
}

export const calculateProjectResult = (collections: number, expenses: number) =>
  collections - expenses;

export const calculateOperatingResult = (projectResult: number, operationalExpenses: number) =>
  projectResult - operationalExpenses;

export const calculateFinalResult = (
  operatingResult: number,
  personalExpenses: number,
  investmentExpenses: number,
) => operatingResult - personalExpenses - investmentExpenses;

export function calculateDashboardPeriodSummary(
  collections: ProjectCollectionForDashboard[],
  projectExpenses: ProjectExpenseForDashboard[],
  generalExpenses: GeneralExpenseForDashboard[],
  selection: DashboardPeriodSelection,
): DashboardPeriodSummary {
  const range = getPeriodDateRange(selection.period, selection.customFrom, selection.customTo);
  const totalProjectCollections = sumProjectCollectionsForPeriod(collections, range);
  const totalProjectExpenses = sumProjectExpensesForPeriod(projectExpenses, range);
  const projectResult = calculateProjectResult(totalProjectCollections, totalProjectExpenses);
  const totalGeneralExpenses = sumGeneralExpensesForPeriod(generalExpenses, range);
  const generalOperationalExpenses = sumGeneralExpensesForPeriod(generalExpenses, range, {
    expenseType: "operational",
  });
  const generalPersonalExpenses = sumGeneralExpensesForPeriod(generalExpenses, range, {
    expenseType: "personal",
  });
  const generalInvestmentExpenses = sumGeneralExpensesForPeriod(generalExpenses, range, {
    expenseType: "investment",
  });
  const pendingGeneralExpenses = sumGeneralExpensesForPeriod(generalExpenses, range, {
    status: "pending",
  });
  const operatingResult = calculateOperatingResult(projectResult, generalOperationalExpenses);
  const finalResult = calculateFinalResult(
    operatingResult,
    generalPersonalExpenses,
    generalInvestmentExpenses,
  );

  return {
    totalProjectCollections,
    totalProjectExpenses,
    projectResult,
    totalGeneralExpenses,
    generalOperationalExpenses,
    generalPersonalExpenses,
    generalInvestmentExpenses,
    pendingGeneralExpenses,
    operatingResult,
    finalResult,
  };
}
