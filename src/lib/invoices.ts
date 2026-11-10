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
    const amount = Math.round(numberValue(project.amount) * 100) / 100;
    if (!project.project_id || amount <= 0) {
      throw new Error("Cada proyecto debe tener un importe mayor a cero.");
    }
    return { project_id: project.project_id, amount };
  });
  const distributed = Math.round(
    normalized.reduce((sum, project) => sum + project.amount, 0) * 100,
  );
  const total = Math.round(totalAmount * 100);
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
  const normalized = validateInvoiceProjectBreakdown(projects, totalAmount);
  normalized.forEach((project) => {
    if (!(project.project_id in availableByProject)) {
      throw new Error("Cada proyecto de la nota debe integrar la factura seleccionada.");
    }
    if (project.amount > availableByProject[project.project_id]) {
      throw new Error("El importe acreditado supera el disponible del proyecto en la factura.");
    }
  });
  return normalized;
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
    contracted: projects
      .filter((project) => project.currency === currency)
      .reduce((sum, project) => sum + numberValue(project.contracted_amount), 0),
    grossInvoiced: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.total_amount), 0),
    creditNotes: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.credit_note_amount), 0),
    netInvoiced: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.net_billed_amount), 0),
    invoiced: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.net_billed_amount), 0),
    collected: collections
      .filter((collection) => collection.currency === currency)
      .reduce((sum, collection) => sum + numberValue(collection.amount), 0),
    allocated: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.allocated_amount), 0),
    invoiceBalance: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.balance_due), 0),
    customerCredit: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.credit_balance), 0),
    unallocated: collections
      .filter((collection) => collection.currency === currency)
      .reduce((sum, collection) => sum + numberValue(collection.unallocated_amount), 0),
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
