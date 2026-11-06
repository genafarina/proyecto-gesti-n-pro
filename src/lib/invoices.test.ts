import { describe, expect, test } from "bun:test";
import {
  buildCurrencyFinancialSummary,
  calculateInvoiceTotal,
  filterInvoices,
  formatInvoiceNumber,
  maximumAllocation,
  maximumProjectAllocation,
  openSignedPdf,
  validateInvoiceProjectBreakdown,
  type CollectionAllocationSummary,
  type InvoiceBalance,
  type InvoiceProjectBalance,
} from "./invoices";

const invoice = (overrides: Partial<InvoiceBalance> = {}): InvoiceBalance => ({
  id: "invoice-1",
  client_id: "client-1",
  project_id: "project-1",
  document_type: "C",
  point_of_sale: "00001",
  invoice_number: "00000042",
  issue_date: "2026-11-05",
  due_date: null,
  concept: "Certificado de obra",
  net_amount: null,
  vat_amount: null,
  total_amount: 1_000,
  currency: "ARS",
  pdf_path: null,
  notes: null,
  status: "issued",
  allocated_amount: 0,
  balance_due: 1_000,
  payment_status: "pending",
  project_ids: ["project-1"],
  project_count: 1,
  ...overrides,
});

const invoiceProject = (overrides: Partial<InvoiceProjectBalance> = {}): InvoiceProjectBalance => ({
  invoice_id: "invoice-1",
  project_id: "project-1",
  client_id: "client-1",
  document_type: "C",
  point_of_sale: "00001",
  invoice_number: "00000042",
  issue_date: "2026-11-05",
  due_date: null,
  concept: "Certificado de obra",
  currency: "ARS",
  status: "issued",
  project_amount: 600,
  allocated_amount: 100,
  balance_due: 500,
  payment_status: "partial",
  ...overrides,
});

const collection = (
  overrides: Partial<CollectionAllocationSummary> = {},
): CollectionAllocationSummary => ({
  id: "collection-1",
  client_id: "client-1",
  project_id: "project-1",
  collection_date: "2026-11-05",
  amount: 800,
  currency: "ARS",
  allocated_amount: 200,
  unallocated_amount: 600,
  ...overrides,
});

describe("facturación manual", () => {
  test("conserva ceros iniciales en el número visible", () => {
    expect(formatInvoiceNumber("00001", "00000042")).toBe("00001-00000042");
  });

  test("calcula el total cuando neto e IVA están informados", () => {
    expect(calculateInvoiceTotal("1000.10", "210.02", "9999")).toBe(1210.12);
  });

  test("permite total manual cuando el detalle fiscal no está informado", () => {
    expect(calculateInvoiceTotal("", "", "1500.50")).toBe(1500.5);
  });

  test("rechaza importes totales no positivos", () => {
    expect(() => calculateInvoiceTotal(null, null, 0)).toThrow("mayor a cero");
  });

  test("filtra por cliente, proyecto, fecha, estado y número", () => {
    const rows = [
      invoice(),
      invoice({
        id: "invoice-2",
        client_id: "client-2",
        project_id: "project-2",
        project_ids: ["project-2"],
        issue_date: "2026-10-01",
        invoice_number: "00000099",
        status: "cancelled",
      }),
    ];
    expect(
      filterInvoices(rows, {
        clientId: "client-1",
        projectId: "project-1",
        status: "issued",
        from: "2026-11-01",
        to: "2026-11-30",
        number: "0042",
      }).map((row) => row.id),
    ).toEqual(["invoice-1"]);
  });

  test("encuentra una factura por cualquiera de sus proyectos", () => {
    expect(
      filterInvoices([invoice({ project_ids: ["project-1", "project-2"], project_count: 2 })], {
        clientId: "all",
        projectId: "project-2",
        status: "all",
        from: "",
        to: "",
        number: "",
      }).map((row) => row.id),
    ).toEqual(["invoice-1"]);
  });

  test("limita una imputación al menor saldo disponible", () => {
    expect(maximumAllocation(invoice({ balance_due: 1_000 }), collection())).toBe(600);
    expect(
      maximumAllocation(invoice({ balance_due: 300 }), collection({ unallocated_amount: 600 })),
    ).toBe(300);
  });

  test("permite otro proyecto del cliente pero rechaza cliente o moneda incompatibles", () => {
    expect(maximumAllocation(invoice(), collection({ project_id: "project-2" }))).toBe(600);
    expect(maximumAllocation(invoice(), collection({ client_id: "client-2" }))).toBe(0);
    expect(maximumAllocation(invoice(), collection({ currency: "USD" }))).toBe(0);
  });

  test("limita cada distribución al saldo del proyecto dentro de la factura", () => {
    expect(maximumProjectAllocation(invoice(), invoiceProject(), collection())).toBe(500);
    expect(
      maximumProjectAllocation(
        invoice(),
        invoiceProject({ balance_due: 900 }),
        collection({ unallocated_amount: 300 }),
      ),
    ).toBe(300);
  });

  test("valida que el desglose de varios proyectos coincida exactamente con el total", () => {
    expect(
      validateInvoiceProjectBreakdown(
        [
          { project_id: "project-1", amount: "600.25" },
          { project_id: "project-2", amount: 399.75 },
        ],
        1_000,
      ),
    ).toEqual([
      { project_id: "project-1", amount: 600.25 },
      { project_id: "project-2", amount: 399.75 },
    ]);
    expect(() =>
      validateInvoiceProjectBreakdown([{ project_id: "project-1", amount: 999.99 }], 1_000),
    ).toThrow("coincidir exactamente");
  });

  test("no permite imputar una factura anulada", () => {
    expect(maximumAllocation(invoice({ status: "cancelled" }), collection())).toBe(0);
  });

  test("separa los indicadores por moneda y excluye facturas anuladas", () => {
    const result = buildCurrencyFinancialSummary(
      [
        { id: "project-1", currency: "ARS", contracted_amount: 5_000 },
        { id: "project-2", currency: "USD", contracted_amount: 2_000 },
      ],
      [
        invoice({ total_amount: 1_000, allocated_amount: 400, balance_due: 600 }),
        invoice({
          id: "invoice-2",
          currency: "USD",
          project_id: "project-2",
          total_amount: 700,
          allocated_amount: 0,
          balance_due: 700,
        }),
        invoice({
          id: "invoice-3",
          total_amount: 999,
          balance_due: 999,
          status: "cancelled",
        }),
      ],
      [
        collection({ amount: 800, allocated_amount: 400, unallocated_amount: 400 }),
        collection({
          id: "collection-2",
          currency: "USD",
          project_id: "project-2",
          amount: 500,
          allocated_amount: 0,
          unallocated_amount: 500,
        }),
      ],
    );

    expect(result).toEqual([
      {
        currency: "ARS",
        contracted: 5_000,
        invoiced: 1_000,
        collected: 800,
        allocated: 400,
        invoiceBalance: 600,
        unallocated: 400,
      },
      {
        currency: "USD",
        contracted: 2_000,
        invoiced: 700,
        collected: 500,
        allocated: 0,
        invoiceBalance: 700,
        unallocated: 500,
      },
    ]);
  });

  test("no suma la factura ni sus imputaciones como ingresos de caja adicionales", () => {
    const [summary] = buildCurrencyFinancialSummary(
      [{ id: "project-1", currency: "ARS", contracted_amount: 2_000 }],
      [invoice({ total_amount: 1_000, allocated_amount: 600, balance_due: 400 })],
      [collection({ amount: 800, allocated_amount: 600, unallocated_amount: 200 })],
    );

    expect(summary.collected).toBe(800);
    expect(summary.invoiced).toBe(1_000);
    expect(summary.allocated).toBe(600);
  });

  test("navega a la URL firmada sin abrir una ventana emergente", async () => {
    const events: string[] = [];

    await openSignedPdf(
      async () => {
        events.push("signed");
        return "https://signed.example.test/invoice.pdf";
      },
      (url) => events.push(`navigate:${url}`),
    );

    expect(events).toEqual(["signed", "navigate:https://signed.example.test/invoice.pdf"]);

    await expect(
      openSignedPdf(
        async () => {
          throw new Error("sin permiso");
        },
        (url) => events.push(`navigate:${url}`),
      ),
    ).rejects.toThrow("sin permiso");
    expect(events).toEqual(["signed", "navigate:https://signed.example.test/invoice.pdf"]);
  });
});
