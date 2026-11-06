import { describe, expect, test } from "bun:test";
import { calculateDashboardPeriodSummary, filterProjectRowsByCurrency } from "./dashboardFinance";

describe("Dashboard financiero por moneda", () => {
  const projects = [
    { id: "project-ars", currency: "ARS" as const },
    { id: "project-usd", currency: "USD" as const },
  ];
  const collections = [
    { project_id: "project-ars", amount: 1_000, collection_date: "2026-11-05" },
    { project_id: "project-usd", amount: 500, collection_date: "2026-11-05" },
  ];
  const expenses = [
    { project_id: "project-ars", amount: 300, expense_date: "2026-11-05" },
    { project_id: "project-usd", amount: 100, expense_date: "2026-11-05" },
  ];

  test("separa cobros y gastos de proyectos ARS y USD sin convertirlos ni sumarlos", () => {
    const ars = calculateDashboardPeriodSummary(
      filterProjectRowsByCurrency(collections, projects, "ARS"),
      filterProjectRowsByCurrency(expenses, projects, "ARS"),
      [],
      { period: "all" },
    );
    const usd = calculateDashboardPeriodSummary(
      filterProjectRowsByCurrency(collections, projects, "USD"),
      filterProjectRowsByCurrency(expenses, projects, "USD"),
      [],
      { period: "all" },
    );

    expect(ars.totalProjectCollections).toBe(1_000);
    expect(ars.totalProjectExpenses).toBe(300);
    expect(ars.projectResult).toBe(700);
    expect(usd.totalProjectCollections).toBe(500);
    expect(usd.totalProjectExpenses).toBe(100);
    expect(usd.projectResult).toBe(400);
  });
});
