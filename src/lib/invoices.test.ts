import { describe, expect, test } from "bun:test";
import {
  buildCurrencyFinancialSummary,
  calculateInvoiceTotal,
  moneyCents,
  positiveCreditProjects,
  setCreditProjectAmount,
  normalizeInvoiceBalance,
  normalizeInvoiceProjectBalance,
  isMissingCreditNoteSchema,
  filterCreditNotes,
  filterInvoices,
  formatInvoiceNumber,
  maximumAllocation,
  maximumProjectAllocation,
  openSignedPdf,
  validateCreditNoteProjectBreakdown,
  validateInvoiceProjectBreakdown,
  type CollectionAllocationSummary,
  type CreditNote,
  type CreditNoteProject,
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
  gross_amount: 1_000,
  credit_note_amount: 0,
  net_billed_amount: 1_000,
  credit_balance: 0,
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
  project_gross_amount: 600,
  credit_note_amount: 0,
  net_billed_amount: 600,
  credit_balance: 0,
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

const creditNote = (overrides: Partial<CreditNote> = {}): CreditNote => ({
  id: "credit-note-1",
  invoice_id: "invoice-1",
  client_id: "client-1",
  document_type: "C",
  point_of_sale: "00001",
  credit_note_number: "00000001",
  issue_date: "2026-11-06",
  amount: 250,
  currency: "ARS",
  reason: "Ajuste parcial",
  pdf_path: null,
  status: "active",
  ...overrides,
});

const creditNoteProject = (overrides: Partial<CreditNoteProject> = {}): CreditNoteProject => ({
  credit_note_id: "credit-note-1",
  invoice_id: "invoice-1",
  project_id: "project-1",
  amount: 250,
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

  test("valida una nota parcial distribuida entre varios proyectos", () => {
    expect(
      validateCreditNoteProjectBreakdown(
        [
          { project_id: "project-1", amount: 150 },
          { project_id: "project-2", amount: 100 },
        ],
        250,
        { "project-1": 600, "project-2": 400 },
      ),
    ).toEqual([
      { project_id: "project-1", amount: 150 },
      { project_id: "project-2", amount: 100 },
    ]);
  });

  test("rechaza una nota que excede el disponible de un proyecto", () => {
    expect(() =>
      validateCreditNoteProjectBreakdown([{ project_id: "project-1", amount: 601 }], 601, {
        "project-1": 600,
      }),
    ).toThrow("supera el disponible");
  });

  test("filtra notas por cliente, proyecto, fecha y factura", () => {
    const notes = [
      creditNote(),
      creditNote({
        id: "credit-note-2",
        client_id: "client-2",
        invoice_id: "invoice-2",
        issue_date: "2026-10-01",
      }),
    ];
    const projects = [
      creditNoteProject(),
      creditNoteProject({
        credit_note_id: "credit-note-2",
        invoice_id: "invoice-2",
        project_id: "project-2",
      }),
    ];
    const invoices = [
      invoice(),
      invoice({ id: "invoice-2", client_id: "client-2", invoice_number: "00000099" }),
    ];

    expect(
      filterCreditNotes(notes, projects, invoices, {
        clientId: "client-1",
        projectId: "project-1",
        from: "2026-11-01",
        to: "2026-11-30",
        invoice: "0042",
      }).map((note) => note.id),
    ).toEqual(["credit-note-1"]);
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
        invoice({
          total_amount: 1_000,
          gross_amount: 1_000,
          credit_note_amount: 200,
          net_billed_amount: 800,
          allocated_amount: 400,
          balance_due: 400,
        }),
        invoice({
          id: "invoice-2",
          currency: "USD",
          project_id: "project-2",
          total_amount: 700,
          gross_amount: 700,
          net_billed_amount: 700,
          allocated_amount: 0,
          balance_due: 700,
        }),
        invoice({
          id: "invoice-3",
          total_amount: 999,
          gross_amount: 999,
          net_billed_amount: 999,
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
        invoiced: 800,
        grossInvoiced: 1_000,
        creditNotes: 200,
        netInvoiced: 800,
        collected: 800,
        allocated: 400,
        invoiceBalance: 400,
        customerCredit: 0,
        unallocated: 400,
      },
      {
        currency: "USD",
        contracted: 2_000,
        invoiced: 700,
        grossInvoiced: 700,
        creditNotes: 0,
        netInvoiced: 700,
        collected: 500,
        allocated: 0,
        invoiceBalance: 700,
        customerCredit: 0,
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

  test("expone crédito a favor sin transformar el saldo pendiente en deuda negativa", () => {
    const [summary] = buildCurrencyFinancialSummary(
      [{ id: "project-1", currency: "ARS", contracted_amount: 2_000 }],
      [
        invoice({
          total_amount: 1_000,
          gross_amount: 1_000,
          credit_note_amount: 300,
          net_billed_amount: 700,
          allocated_amount: 1_000,
          balance_due: 0,
          credit_balance: 300,
        }),
      ],
      [collection({ amount: 1_000, allocated_amount: 1_000, unallocated_amount: 0 })],
    );

    expect(summary.grossInvoiced).toBe(1_000);
    expect(summary.creditNotes).toBe(300);
    expect(summary.netInvoiced).toBe(700);
    expect(summary.invoiceBalance).toBe(0);
    expect(summary.customerCredit).toBe(300);
    expect(summary.collected).toBe(1_000);
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

describe("credit note audit regressions", () => {
  test("100,10 + 200,20 coinciden exactamente en centavos", () => {
    expect(moneyCents("100.10") + moneyCents("200.20")).toBe(moneyCents("300.30"));
    expect(moneyCents("1000") - moneyCents("100.10") - moneyCents("200.20")).toBe(69970);
  });
  test("acepta solo un proyecto afectado y elimina líneas vacías o cero", () => {
    expect(
      validateCreditNoteProjectBreakdown(
        [
          { project_id: "p1", amount: "100.10" },
          { project_id: "p2", amount: "" },
          { project_id: "p3", amount: 0 },
        ],
        100.1,
        { p1: 100.1, p2: 200, p3: 200 },
      ),
    ).toEqual([{ project_id: "p1", amount: 100.1 }]);
    expect(() => positiveCreditProjects([{ project_id: "p1", amount: -1 }])).toThrow();
  });
  test("permite agregar y quitar proyectos al editar", () => {
    let lines = [{ project_id: "p1", amount: "100" }];
    lines = setCreditProjectAmount(lines, "p2", "200");
    lines = setCreditProjectAmount(lines, "p1", "");
    expect(positiveCreditProjects(lines)).toEqual([{ project_id: "p2", amount: "200" }]);
  });
  test("conserva totales y saldos del esquema anterior", () => {
    const old = invoice();
    delete (old as Partial<InvoiceBalance>).gross_amount;
    delete (old as Partial<InvoiceBalance>).net_billed_amount;
    delete (old as Partial<InvoiceBalance>).credit_note_amount;
    delete (old as Partial<InvoiceBalance>).credit_balance;
    const normalized = normalizeInvoiceBalance(old);
    const [summary] = buildCurrencyFinancialSummary([], [normalized], []);
    expect(summary.grossInvoiced).toBe(1000);
    expect(summary.netInvoiced).toBe(1000);
    expect(summary.invoiceBalance).toBe(1000);
    const project = invoiceProject();
    delete (project as Partial<InvoiceProjectBalance>).project_gross_amount;
    expect(normalizeInvoiceProjectBalance(project).project_gross_amount).toBe(600);
    expect(isMissingCreditNoteSchema({ code: "42703" })).toBe(true);
    expect(isMissingCreditNoteSchema({ code: "42501" })).toBe(false);
  });
});
