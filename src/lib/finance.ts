// Cálculos financieros y de avance centralizados.
// Única fuente de verdad para todas las pantallas.

export type ProjectRow = {
  id: string;
  contracted_amount: number | string;
  estimated_cost: number | string;
  planned_end_date: string | null;
  status: string;
};

export type TaskRow = {
  progress_percentage: number | string;
  status: string;
  planned_end_date: string | null;
};

const n = (v: unknown): number => {
  if (v == null) return 0;
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

export const totalCollected = (collections: { amount: number | string }[]) =>
  collections.reduce((s, c) => s + n(c.amount), 0);

export const totalSpent = (expenses: { amount: number | string }[]) =>
  expenses.reduce((s, e) => s + n(e.amount), 0);

export const projectProgress = (tasks: TaskRow[]) => {
  if (!tasks.length) return 0;
  return tasks.reduce((s, t) => s + n(t.progress_percentage), 0) / tasks.length;
};

export const pendingToCollect = (contracted: number | string, collected: number) =>
  Math.max(n(contracted) - collected, 0);

export const currentResult = (collected: number, spent: number) => collected - spent;

export const currentMarginPct = (collected: number, spent: number) => {
  if (collected <= 0) return 0;
  return ((collected - spent) / collected) * 100;
};

export const estimatedMargin = (contracted: number | string, estCost: number | string) =>
  n(contracted) - n(estCost);

export const estimatedMarginPct = (contracted: number | string, estCost: number | string) => {
  const c = n(contracted);
  if (c <= 0) return 0;
  return ((c - n(estCost)) / c) * 100;
};

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const isOverdueProject = (p: ProjectRow) => {
  if (!p.planned_end_date) return false;
  if (p.status === "completed" || p.status === "cancelled") return false;
  return new Date(p.planned_end_date) < today();
};

export const isOverdueTask = (t: TaskRow) => {
  if (!t.planned_end_date) return false;
  if (t.status === "completed" || t.status === "cancelled") return false;
  return new Date(t.planned_end_date) < today();
};

export const formatARS = (v: number, currency: string = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number.isFinite(v) ? v : 0,
  );

export const formatPct = (v: number) =>
  `${(Number.isFinite(v) ? v : 0).toFixed(1).replace(".0", "")}%`;

export const formatDate = (d: string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR");
};
