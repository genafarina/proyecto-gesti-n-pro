import { describe, expect, test } from "bun:test";
import {
  clearFinancialFilters,
  updateFinancialFilter,
  filterFinancialRows,
  financialTotals,
  initialFinancialFilters,
} from "./financialFilters";
import { filterGeneralExpenses, type GeneralExpense } from "./generalExpenses";

const rows = [
  {
    id: "1",
    date: "2026-11-01",
    search: ["Certificación Árbol", "Cliente Norte", "AVA-02", "00001-0042"],
    fields: {
      projectId: ["p1", "p2"],
      clientId: "c1",
      category: "materials",
      currency: "ARS",
      status: "issued",
    },
    amount: 100.1,
  },
  {
    id: "2",
    date: "2026-11-30",
    search: ["Certificación final"],
    fields: {
      projectId: ["p2"],
      clientId: "c2",
      category: "materials",
      currency: "USD",
      status: "cancelled",
    },
    amount: 200.2,
  },
  {
    id: "3",
    date: "2026-10-31",
    search: ["Otra factura"],
    fields: {
      projectId: ["p1"],
      clientId: "c1",
      category: "labor",
      currency: "ARS",
      status: "issued",
    },
    amount: 200.2,
  },
];
const describeRow = (row: (typeof rows)[number]) => row;
describe("filtros financieros combinados", () => {
  test("combina cliente, proyecto multiproyecto, categoría, moneda, estado y búsqueda sin tildes", () => {
    const result = filterFinancialRows(
      rows,
      {
        ...initialFinancialFilters,
        clientId: "c1",
        projectId: "p2",
        category: "materials",
        currency: "ARS",
        status: "issued",
        query: "arbol ava 0042",
      },
      describeRow,
    );
    expect(result.map((row) => row.id)).toEqual(["1"]);
  });
  test("fechas inclusivas, períodos comunes y rango invertido", () => {
    const filters = {
      ...initialFinancialFilters,
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-30",
    };
    expect(filterFinancialRows(rows, filters, describeRow).map((row) => row.id)).toEqual([
      "1",
      "2",
    ]);
    expect(filterFinancialRows(rows, { ...filters, from: "2026-12-01" }, describeRow)).toEqual([]);
    expect(
      filterFinancialRows(
        rows,
        { ...initialFinancialFilters, period: "this_month" },
        describeRow,
        new Date(2026, 10, 15),
      ).length,
    ).toBe(2);
    expect(
      filterFinancialRows(
        rows,
        { ...initialFinancialFilters, period: "previous_month" },
        describeRow,
        new Date(2026, 10, 15),
      ).map((row) => row.id),
    ).toEqual(["3"]);
  });
  test("limpiar devuelve todos los registros sin mutarlos", () => {
    const before = JSON.stringify(rows);
    const cleared = clearFinancialFilters({
      ...initialFinancialFilters,
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-30",
      query: "arbol",
      status: "issued",
      projectId: "p2",
    });
    expect(filterFinancialRows(rows, cleared, describeRow)).toEqual(rows);
    expect(
      updateFinancialFilter(
        { ...initialFinancialFilters, projectId: "p1", invoiceId: "i1" },
        "clientId",
        "c2",
      ),
    ).toMatchObject({ clientId: "c2", projectId: "all", invoiceId: "all" });
    expect(
      filterFinancialRows(
        rows,
        { ...initialFinancialFilters, status: "all", projectId: "all" },
        describeRow,
      ),
    ).toEqual(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
  test("total filtrado en centavos sin mezclar monedas ni modificar el origen", () => {
    expect(
      financialTotals(
        rows,
        (row) => row.amount,
        (row) => row.fields.currency,
      ),
    ).toEqual([
      { currency: "ARS", amount: 300.3 },
      { currency: "USD", amount: 200.2 },
    ]);
    const filtered = filterFinancialRows(
      rows,
      { ...initialFinancialFilters, currency: "USD" },
      describeRow,
    );
    expect(
      financialTotals(
        filtered,
        (row) => row.amount,
        (row) => row.fields.currency,
      ),
    ).toEqual([{ currency: "USD", amount: 200.2 }]);
  });
  test("campos ausentes no coinciden con una cuenta concreta", () => {
    expect(
      filterFinancialRows(
        rows,
        { ...initialFinancialFilters, paymentAccountId: "account" },
        describeRow,
      ),
    ).toEqual([]);
  });
  test("gastos generales conserva filtros y busca por cuenta y observaciones", () => {
    const expense: GeneralExpense = {
      id: "g1",
      expense_date: "2026-11-10",
      category: "other",
      expense_type: "operational",
      status: "paid",
      payee: "Proveedor",
      description: "Servicio",
      amount: 10,
      payment_method: "bank_transfer",
      payment_account_id: "a1",
      other_payment_account_detail: null,
      receipt_url: null,
      notes: "Mantenimiento",
    };
    const filters = {
      period: "all" as const,
      category: "all",
      expenseType: "all",
      status: "paid",
      paymentMethod: "all",
      paymentAccountId: "a1",
      search: "banco mantenimiento",
    };
    expect(filterGeneralExpenses([expense], filters, { a1: "Banco" })).toEqual([expense]);
    expect(
      filterGeneralExpenses([expense], { ...filters, status: "pending" }, { a1: "Banco" }),
    ).toEqual([]);
  });
});
