import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatDate } from "@/lib/finance";
import {
  formatInvoiceNumber,
  invoiceDocumentTypeLabel,
  invoicePaymentStatusLabel,
  invoiceStatusLabel,
  projectCurrencyFinancialSummary,
  type CollectionAllocationSummary,
  type CurrencyCode,
  type InvoiceProjectBalance,
} from "@/lib/invoices";
import { ExternalLink } from "lucide-react";

export function ProjectInvoicesSection({
  project,
}: {
  project: {
    id: string;
    currency: CurrencyCode;
    contracted_amount: number | string;
  };
}) {
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["project-invoice-balances", project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_project_balances")
        .select("*")
        .eq("project_id", project.id)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InvoiceProjectBalance[];
    },
  });

  const { data: collections = [] } = useQuery({
    queryKey: ["project-collection-allocation-summary", project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collection_allocation_summary")
        .select("*")
        .eq("project_id", project.id)
        .order("collection_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CollectionAllocationSummary[];
    },
  });

  const summaries = projectCurrencyFinancialSummary(
    project.id,
    [project],
    invoices.map((invoice) => ({
      project_id: invoice.project_id,
      currency: invoice.currency,
      total_amount: invoice.project_gross_amount,
      gross_amount: invoice.project_gross_amount,
      credit_note_amount: invoice.credit_note_amount,
      net_billed_amount: invoice.net_billed_amount,
      credit_balance: invoice.credit_balance,
      allocated_amount: invoice.allocated_amount,
      balance_due: invoice.balance_due,
      status: invoice.status,
    })),
    collections,
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline">
          <Link to="/facturacion">
            Abrir módulo Facturación <ExternalLink className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {summaries.map((summary) => {
          const contractualPending =
            summary.currency === project.currency
              ? Math.max(summary.contracted - summary.netInvoiced, 0)
              : 0;
          return (
            <Card key={summary.currency}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumen {summary.currency}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Data
                  label="Monto contratado"
                  value={formatARS(summary.contracted, summary.currency)}
                />
                <Data
                  label="Facturación bruta"
                  value={formatARS(summary.grossInvoiced, summary.currency)}
                />
                <Data
                  label="Notas de crédito"
                  value={formatARS(summary.creditNotes, summary.currency)}
                />
                <Data
                  label="Facturación neta"
                  value={formatARS(summary.netInvoiced, summary.currency)}
                />
                <Data
                  label="Total cobrado"
                  value={formatARS(summary.collected, summary.currency)}
                />
                <Data
                  label="Cobrado e imputado"
                  value={formatARS(summary.allocated, summary.currency)}
                />
                <Data
                  label="Saldo pendiente de facturas"
                  value={formatARS(summary.invoiceBalance, summary.currency)}
                />
                <Data
                  label="Cobros no imputados"
                  value={formatARS(summary.unallocated, summary.currency)}
                />
                <Data
                  label="Crédito a favor / a devolver"
                  value={formatARS(summary.customerCredit, summary.currency)}
                />
                {summary.currency === project.currency && (
                  <Data
                    label="Saldo contractual sin facturar"
                    value={formatARS(contractualPending, summary.currency)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facturas del proyecto</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Comprobante</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Cobranza</TableHead>
                <TableHead className="text-right">Bruto / neto</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loadingInvoices && invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    Este proyecto todavía no tiene facturas registradas.
                  </TableCell>
                </TableRow>
              )}
              {invoices.map((invoice) => (
                <TableRow key={invoice.invoice_id}>
                  <TableCell>
                    <div>{invoiceDocumentTypeLabel[invoice.document_type]}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(invoice.issue_date)}</TableCell>
                  <TableCell>{invoice.concept}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{invoiceStatusLabel[invoice.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    {invoice.status === "cancelled"
                      ? "No aplica"
                      : invoicePaymentStatusLabel[invoice.payment_status]}
                  </TableCell>
                  <TableCell className="text-right">
                    <div>{formatARS(Number(invoice.project_gross_amount), invoice.currency)}</div>
                    {Number(invoice.credit_note_amount) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Neto {formatARS(Number(invoice.net_billed_amount), invoice.currency)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div>{formatARS(Number(invoice.balance_due), invoice.currency)}</div>
                    {Number(invoice.credit_balance) > 0 && (
                      <div className="text-xs text-amber-600">
                        A favor {formatARS(Number(invoice.credit_balance), invoice.currency)}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Data({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
