export type CurrencyCode = "ARS" | "USD";
export type InvoiceStatus = "issued" | "cancelled";
export type InvoicePaymentStatus = "pending" | "partial" | "paid" | "credited";
export type CreditNoteStatus = "active" | "cancelled";

export type InvoiceBalance = {
  id: string;
  client_id: string;
  project_id: string;
  document_type: string;
  point_of_sale: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  concept: string;
  net_amount: number | string | null;
  vat_amount: number | string | null;
  total_amount: number | string;
  currency: CurrencyCode;
  pdf_path: string | null;
  notes: string | null;
  status: InvoiceStatus;
  allocated_amount: number | string;
  balance_due: number | string;
  gross_amount: number | string;
  credit_note_amount: number | string;
  net_billed_amount: number | string;
  credit_balance: number | string;
  payment_status: InvoicePaymentStatus;
  project_ids: string[];
  project_count: number;
  created_at?: string;
  updated_at?: string;
};

export type InvoiceProject = {
  invoice_id: string;
  project_id: string;
  amount: number | string;
};

export type InvoiceProjectBalance = {
  invoice_id: string;
  project_id: string;
  client_id: string;
  document_type: string;
  point_of_sale: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  concept: string;
  currency: CurrencyCode;
  status: InvoiceStatus;
  project_amount: number | string;
  allocated_amount: number | string;
  balance_due: number | string;
  project_gross_amount: number | string;
  credit_note_amount: number | string;
  net_billed_amount: number | string;
  credit_balance: number | string;
  payment_status: InvoicePaymentStatus;
};

export type CreditNote = {
  id: string;
  invoice_id: string;
  client_id: string;
  document_type: string;
  point_of_sale: string;
  credit_note_number: string;
  issue_date: string;
  amount: number | string;
  currency: "ARS";
  reason: string;
  pdf_path: string | null;
  status: CreditNoteStatus;
  cancelled_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CreditNoteProject = {
  credit_note_id: string;
  invoice_id: string;
  project_id: string;
  amount: number | string;
};

export type CreditNoteFilters = {
  clientId: string;
  projectId: string;
  from: string;
  to: string;
  invoice: string;
};

export type CollectionAllocationSummary = {
  id: string;
  client_id: string;
  project_id: string;
  collection_date: string;
  amount: number | string;
  currency: CurrencyCode;
  allocated_amount: number | string;
  unallocated_amount: number | string;
  description?: string | null;
  payment_method?: string;
};

export type InvoiceFilters = {
  clientId: string;
  projectId: string;
  status: string;
  from: string;
  to: string;
  number: string;
};

export type CurrencyFinancialSummary = {
  currency: CurrencyCode;
  contracted: number;
  invoiced: number;
  grossInvoiced: number;
  creditNotes: number;
  netInvoiced: number;
  collected: number;
  allocated: number;
  invoiceBalance: number;
  customerCredit: number;
  unallocated: number;
};

const numberValue = (value: number | string | null | undefined) => {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const invoiceDocumentTypeLabel: Record<string, string> = {
  A: "Factura A",
  B: "Factura B",
  C: "Factura C",
  E: "Factura E",
  M: "Factura M",
  OTHER: "Otro comprobante",
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  issued: "Emitida",
  cancelled: "Anulada",
};

export const invoicePaymentStatusLabel: Record<InvoicePaymentStatus, string> = {
  pending: "Pendiente",
  partial: "Parcialmente cobrada",
  paid: "Pagada",
  credited: "Acreditada totalmente",
};

export const creditNoteStatusLabel: Record<CreditNoteStatus, string> = {
  active: "Activa",
  cancelled: "Anulada",
};

export function formatInvoiceNumber(pointOfSale: string, invoiceNumber: string) {
  return `${pointOfSale}-${invoiceNumber}`;
}

export function optionalAmount(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} debe ser un número igual o mayor a cero.`);
  }
  return parsed;
}

export function calculateInvoiceTotal(
  netAmount: unknown,
  vatAmount: unknown,
  manualTotal: unknown,
) {
  const net = optionalAmount(netAmount, "El importe neto");
  const vat = optionalAmount(vatAmount, "El IVA");
  if (net != null && vat != null) return Math.round((net + vat) * 100) / 100;

  const total = Number(manualTotal);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("El importe total debe ser mayor a cero.");
  }
  return Math.round(total * 100) / 100;
}

export function filterInvoices(invoices: InvoiceBalance[], filters: InvoiceFilters) {
  const number = filters.number.trim().toLowerCase();
  return invoices.filter((invoice) => {
    if (filters.clientId !== "all" && invoice.client_id !== filters.clientId) return false;
    if (filters.projectId !== "all" && !invoice.project_ids.includes(filters.projectId)) {
      return false;
    }
    if (filters.status !== "all" && invoice.status !== filters.status) return false;
    if (filters.from && invoice.issue_date < filters.from) return false;
    if (filters.to && invoice.issue_date > filters.to) return false;
    if (
      number &&
      !formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)
        .toLowerCase()
        .includes(number) &&
      !invoice.invoice_number.toLowerCase().includes(number)
    ) {
      return false;
    }
    return true;
  });
}

export function filterCreditNotes(
  creditNotes: CreditNote[],
  projects: CreditNoteProject[],
  invoices: InvoiceBalance[],
  filters: CreditNoteFilters,
) {
  const invoiceNumber = filters.invoice.trim().toLowerCase();
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const projectsByNote = new Map<string, Set<string>>();
  projects.forEach((line) => {
    const ids = projectsByNote.get(line.credit_note_id) ?? new Set<string>();
    ids.add(line.project_id);
    projectsByNote.set(line.credit_note_id, ids);
  });

  return creditNotes.filter((note) => {
    const invoice = invoiceMap.get(note.invoice_id);
    if (filters.clientId !== "all" && note.client_id !== filters.clientId) return false;
    if (filters.projectId !== "all" && !projectsByNote.get(note.id)?.has(filters.projectId)) {
      return false;
    }
    if (filters.from && note.issue_date < filters.from) return false;
    if (filters.to && note.issue_date > filters.to) return false;
    if (
      invoiceNumber &&
      (!invoice ||
        !formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)
          .toLowerCase()
          .includes(invoiceNumber))
    ) {
      return false;
    }
    return true;
  });
}

export function maximumAllocation(
  invoice: Pick<InvoiceBalance, "balance_due" | "status" | "currency" | "client_id">,
  collection: Pick<CollectionAllocationSummary, "unallocated_amount" | "currency" | "client_id">,
) {
  if (invoice.status === "cancelled") return 0;
  if (invoice.client_id !== collection.client_id) return 0;
  if (invoice.currency !== collection.currency) return 0;
  return Math.max(
    0,
    Math.min(numberValue(invoice.balance_due), numberValue(collection.unallocated_amount)),
  );
}

export function maximumProjectAllocation(
  invoice: Pick<InvoiceBalance, "status" | "currency" | "client_id">,
  project: Pick<InvoiceProjectBalance, "balance_due">,
  collection: Pick<CollectionAllocationSummary, "unallocated_amount" | "currency" | "client_id">,
) {
  if (invoice.status === "cancelled") return 0;
  if (invoice.client_id !== collection.client_id) return 0;
  if (invoice.currency !== collection.currency) return 0;
  return Math.max(
    0,
    Math.min(numberValue(project.balance_due), numberValue(collection.unallocated_amount)),
  );
}

export function validateInvoiceProjectBreakdown(
  projects: { project_id: string; amount: number | string }[],
  totalAmount: number,
) {
  if (projects.length === 0) throw new Error("Seleccioná al menos un proyecto.");
  if (new Set(projects.map((project) => project.project_id)).size !== projects.length) {
    throw new Error("No se puede repetir un proyecto en el desglose.");
  }

  const normalized = projects.map((project) => {
    const amount = moneyCents(project.amount) / 100;
    if (!project.project_id || amount <= 0) {
      throw new Error("Cada proyecto debe tener un importe mayor a cero.");
    }
    return { project_id: project.project_id, amount };
  });
  const distributed = normalized.reduce((sum, project) => sum + moneyCents(project.amount), 0);
  const total = moneyCents(totalAmount);
  if (distributed !== total) {
    throw new Error("La suma por proyecto debe coincidir exactamente con el total de la factura.");
  }
  return normalized;
}

export function validateCreditNoteProjectBreakdown(
  projects: { project_id: string; amount: number | string }[],
  totalAmount: number,
  availableByProject: Record<string, number>,
) {
  const normalized = validateInvoiceProjectBreakdown(positiveCreditProjects(projects), totalAmount);
  normalized.forEach((project) => {
    if (!(project.project_id in availableByProject)) {
      throw new Error("Cada proyecto de la nota debe integrar la factura seleccionada.");
    }
    if (moneyCents(project.amount) > moneyCents(availableByProject[project.project_id])) {
      throw new Error("El importe acreditado supera el disponible del proyecto en la factura.");
    }
  });
  return normalized;
}

/** Parse decimal money without accumulating binary floating-point fractions. */
export function moneyCents(value: number | string | null | undefined): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^-?\d+(\.\d*)?$/.test(text)) throw new Error("El importe debe tener hasta dos decimales.");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const cents =
    Number(whole) * 100 +
    Number(fraction.padEnd(2, "0").slice(0, 2)) +
    (Number(fraction[2] ?? "0") >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw new Error("Importe fuera de rango.");
  return negative ? -cents : cents;
}

type CreditProjectInput = { project_id: string; amount: number | string };

export function positiveCreditProjects(projects: CreditProjectInput[]) {
  return projects.filter((line) => {
    const cents = moneyCents(line.amount);
    if (cents < 0) throw new Error("El descuento no puede ser negativo.");
    return cents > 0;
  });
}

export function setCreditProjectAmount(
  projects: CreditProjectInput[],
  projectId: string,
  amount: string,
) {
  if (!/^\d{0,12}(\.\d{0,2})?$/.test(amount)) return projects;
  return [
    ...projects.filter((line) => line.project_id !== projectId),
    { project_id: projectId, amount },
  ];
}

// Before the additive migration, these views still expose the original totals.
// Preserve them rather than interpreting absent accounting columns as zero.
export function normalizeInvoiceBalance(row: InvoiceBalance): InvoiceBalance {
  return {
    ...row,
    gross_amount: row.gross_amount ?? row.total_amount,
    credit_note_amount: row.credit_note_amount ?? 0,
    net_billed_amount: row.net_billed_amount ?? row.total_amount,
    credit_balance: row.credit_balance ?? 0,
  };
}

export function normalizeInvoiceProjectBalance(row: InvoiceProjectBalance): InvoiceProjectBalance {
  return {
    ...row,
    project_gross_amount: row.project_gross_amount ?? row.project_amount,
    credit_note_amount: row.credit_note_amount ?? 0,
    net_billed_amount: row.net_billed_amount ?? row.project_amount,
    credit_balance: row.credit_balance ?? 0,
  };
}

export function isMissingCreditNoteSchema(error: { code?: string }) {
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "");
}

export async function openSignedPdf(
  createSignedUrl: () => Promise<string>,
  navigate: (url: string) => void,
) {
  // Navigate in the current tab once Storage has authorized the signed URL.
  // This avoids popup blockers while keeping the bucket private.
  navigate(await createSignedUrl());
}

export function buildCurrencyFinancialSummary(
  projects: { id: string; currency: CurrencyCode; contracted_amount: number | string }[],
  invoices: Pick<
    InvoiceBalance,
    | "project_id"
    | "currency"
    | "total_amount"
    | "credit_note_amount"
    | "net_billed_amount"
    | "allocated_amount"
    | "balance_due"
    | "credit_balance"
    | "status"
  >[],
  collections: Pick<
    CollectionAllocationSummary,
    "project_id" | "currency" | "amount" | "allocated_amount" | "unallocated_amount"
  >[],
) {
  const currencies = new Set<CurrencyCode>();
  projects.forEach((project) => currencies.add(project.currency));
  invoices.forEach((invoice) => currencies.add(invoice.currency));
  collections.forEach((collection) => currencies.add(collection.currency));

  return [...currencies].sort().map<CurrencyFinancialSummary>((currency) => ({
    currency,
    contracted:
      projects
        .filter((project) => project.currency === currency)
        .reduce((sum, project) => sum + moneyCents(project.contracted_amount), 0) / 100,
    grossInvoiced:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.total_amount), 0) / 100,
    creditNotes:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.credit_note_amount), 0) / 100,
    netInvoiced:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.net_billed_amount), 0) / 100,
    invoiced:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.net_billed_amount), 0) / 100,
    collected:
      collections
        .filter((collection) => collection.currency === currency)
        .reduce((sum, collection) => sum + moneyCents(collection.amount), 0) / 100,
    allocated:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.allocated_amount), 0) / 100,
    invoiceBalance:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.balance_due), 0) / 100,
    customerCredit:
      invoices
        .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + moneyCents(invoice.credit_balance), 0) / 100,
    unallocated:
      collections
        .filter((collection) => collection.currency === currency)
        .reduce((sum, collection) => sum + moneyCents(collection.unallocated_amount), 0) / 100,
  }));
}

export function projectCurrencyFinancialSummary(
  projectId: string,
  projects: { id: string; currency: CurrencyCode; contracted_amount: number | string }[],
  invoices: Pick<
    InvoiceBalance,
    | "project_id"
    | "currency"
    | "total_amount"
    | "credit_note_amount"
    | "net_billed_amount"
    | "allocated_amount"
    | "balance_due"
    | "credit_balance"
    | "status"
  >[],
  collections: Pick<
    CollectionAllocationSummary,
    "project_id" | "currency" | "amount" | "allocated_amount" | "unallocated_amount"
  >[],
) {
  return buildCurrencyFinancialSummary(
    projects.filter((project) => project.id === projectId),
    invoices.filter((invoice) => invoice.project_id === projectId),
    collections.filter((collection) => collection.project_id === projectId),
  );
}
