export type CurrencyCode = "ARS" | "USD";
export type InvoiceStatus = "issued" | "cancelled";
export type InvoicePaymentStatus = "pending" | "partial" | "paid";

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
  payment_status: InvoicePaymentStatus;
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
  collected: number;
  allocated: number;
  invoiceBalance: number;
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
    "project_id" | "currency" | "total_amount" | "allocated_amount" | "balance_due" | "status"
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
    invoiced: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.total_amount), 0),
    collected: collections
      .filter((collection) => collection.currency === currency)
      .reduce((sum, collection) => sum + numberValue(collection.amount), 0),
    allocated: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.allocated_amount), 0),
    invoiceBalance: invoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelled")
      .reduce((sum, invoice) => sum + numberValue(invoice.balance_due), 0),
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
    "project_id" | "currency" | "total_amount" | "allocated_amount" | "balance_due" | "status"
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
