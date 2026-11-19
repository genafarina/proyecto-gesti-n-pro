import { FinancialFilters } from "@/components/finance/FinancialFilters";
import {
  filterFinancialRows,
  initialFinancialFilters,
  type FinancialFiltersValue,
} from "@/lib/financialFilters";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { useCreditNoteSchema } from "@/components/invoices/use-credit-note-schema";
import { CreditNotesSection } from "@/components/invoices/CreditNotesSection";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatDate } from "@/lib/finance";
import { todayIsoDate } from "@/lib/dates";
import {
  calculateInvoiceTotal,
  normalizeInvoiceBalance,
  normalizeInvoiceProjectBalance,
  formatInvoiceNumber,
  invoiceDocumentTypeLabel,
  invoicePaymentStatusLabel,
  invoiceStatusLabel,
  maximumProjectAllocation,
  openSignedPdf,
  optionalAmount,
  validateInvoiceProjectBreakdown,
  type CollectionAllocationSummary,
  type CreditNote,
  type CreditNoteProject,
  type CurrencyCode,
  type InvoiceBalance,
  type InvoiceProjectBalance,
} from "@/lib/invoices";
import { paymentMethodLabel } from "@/lib/labels";
import { Ban, Eye, FileText, Link2, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/facturacion")({
  component: InvoicesPage,
});

type ProjectMin = {
  id: string;
  client_id: string;
  code: string;
  name: string;
  currency: CurrencyCode;
};

type ClientMin = { id: string; name: string };

type InvoiceAllocation = {
  id: string;
  invoice_id: string;
  collection_id: string;
  project_id: string;
  amount: number;
};

type InvoiceDraft = Partial<InvoiceBalance> & {
  net_amount?: number | string | null;
  vat_amount?: number | string | null;
  total_amount?: number | string;
  project_allocations: { project_id: string; amount: number | string }[];
};

const today = todayIsoDate;

function InvoicesPage() {
  const queryClient = useQueryClient();
  const schema = useCreditNoteSchema();
  const [filters, setFilters] = useState<FinancialFiltersValue>({
    ...initialFinancialFilters,
    clientId: "all",
    projectId: "all",
    status: "all",
    currency: "all",
    documentType: "all",
    paymentStatus: "all",
  });
  const [editing, setEditing] = useState<InvoiceDraft | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [removePdf, setRemovePdf] = useState(false);
  const [viewing, setViewing] = useState<InvoiceBalance | null>(null);
  const [allocating, setAllocating] = useState<InvoiceBalance | null>(null);
  const [toCancel, setToCancel] = useState<InvoiceBalance | null>(null);
  const [toDelete, setToDelete] = useState<InvoiceBalance | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoice-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_balances")
        .select("*")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as InvoiceBalance[]).map(normalizeInvoiceBalance);
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["invoice-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,client_id,code,name,currency")
        .order("code");
      if (error) throw error;
      return (data ?? []) as ProjectMin[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["invoice-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as ClientMin[];
    },
  });

  const { data: collections = [] } = useQuery({
    queryKey: ["collection-allocation-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collection_allocation_summary")
        .select("*")
        .order("collection_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CollectionAllocationSummary[];
    },
  });

  const { data: allocations = [] } = useQuery({
    queryKey: ["invoice-allocations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_allocations").select("*");
      if (error) throw error;
      return (data ?? []) as InvoiceAllocation[];
    },
  });

  const { data: invoiceProjects = [] } = useQuery({
    queryKey: ["invoice-project-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_project_balances").select("*");
      if (error) throw error;
      return ((data ?? []) as unknown as InvoiceProjectBalance[]).map(
        normalizeInvoiceProjectBalance,
      );
    },
  });

  const {
    data: creditNotes = [],
    error: notesError,
    isPending: notesPending,
  } = useQuery({
    queryKey: ["credit-notes"],
    enabled: schema.data === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_notes")
        .select("*")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CreditNote[];
    },
  });

  const {
    data: creditNoteProjects = [],
    error: noteProjectsError,
    isPending: noteProjectsPending,
  } = useQuery({
    queryKey: ["credit-note-projects"],
    enabled: schema.data === true,
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_note_projects").select("*");
      if (error) throw error;
      return (data ?? []) as CreditNoteProject[];
    },
  });

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project])),
    [projects],
  );
  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((client) => [client.id, client.name])),
    [clients],
  );
  const collectionMap = useMemo(
    () => Object.fromEntries(collections.map((collection) => [collection.id, collection])),
    [collections],
  );
  const invoiceProjectsByInvoice = useMemo(() => {
    const grouped: Record<string, InvoiceProjectBalance[]> = {};
    invoiceProjects.forEach((line) => {
      (grouped[line.invoice_id] ??= []).push(line);
    });
    return grouped;
  }, [invoiceProjects]);
  const filtered = useMemo(
    () =>
      filterFinancialRows(invoices, filters, (invoice) => ({
        date: invoice.issue_date,
        fields: {
          clientId: invoice.client_id,
          projectId: invoice.project_ids,
          status: invoice.status,
          currency: invoice.currency,
          documentType: invoice.document_type,
          paymentStatus: invoice.status === "cancelled" ? undefined : invoice.payment_status,
        },
        search: [
          invoice.concept,
          invoice.notes,
          invoice.invoice_number,
          formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number),
          clientMap[invoice.client_id],
          ...(invoice.project_ids ?? []).flatMap((id) => [
            projectMap[id]?.code,
            projectMap[id]?.name,
          ]),
        ],
      })),
    [filters, invoices, clientMap, projectMap],
  );
  const filteredProjects = useMemo(
    () =>
      filters.clientId === "all"
        ? projects
        : projects.filter((project) => project.client_id === filters.clientId),
    [filters.clientId, projects],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invoice-balances"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-project-balances"] });
    queryClient.invalidateQueries({ queryKey: ["collection-allocation-summary"] });
    queryClient.invalidateQueries({ queryKey: ["project-invoice-balances"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
    queryClient.invalidateQueries({ queryKey: ["credit-note-projects"] });
  };

  const save = useMutation({
    mutationFn: async ({
      draft,
      file,
      removeExisting,
    }: {
      draft: InvoiceDraft;
      file: File | null;
      removeExisting: boolean;
    }) => {
      if (!draft.project_allocations.length) throw new Error("Seleccioná al menos un proyecto.");
      const selectedProjects = draft.project_allocations.map((line) => projectMap[line.project_id]);
      if (selectedProjects.some((project) => !project)) {
        throw new Error("Uno de los proyectos seleccionados no existe.");
      }
      const [primaryProject] = selectedProjects as ProjectMin[];
      if (
        selectedProjects.some(
          (project) =>
            project?.client_id !== primaryProject.client_id ||
            project?.currency !== primaryProject.currency,
        )
      ) {
        throw new Error("Todos los proyectos deben pertenecer al mismo cliente y moneda.");
      }
      if (!draft.document_type) throw new Error("Seleccioná un tipo de comprobante.");
      if (!draft.point_of_sale?.match(/^\d{1,8}$/)) {
        throw new Error("El punto de venta debe contener únicamente números.");
      }
      if (!draft.invoice_number?.match(/^\d{1,20}$/)) {
        throw new Error("El número de factura debe contener únicamente números.");
      }
      if (!draft.issue_date) throw new Error("La fecha de emisión es obligatoria.");
      if (draft.due_date && draft.due_date < draft.issue_date) {
        throw new Error("La fecha de vencimiento no puede ser anterior a la emisión.");
      }
      if (!draft.concept?.trim()) throw new Error("El concepto es obligatorio.");

      const netAmount = optionalAmount(draft.net_amount, "El importe neto");
      const vatAmount = optionalAmount(draft.vat_amount, "El IVA");
      const totalAmount = calculateInvoiceTotal(netAmount, vatAmount, draft.total_amount);
      const projectAllocations = validateInvoiceProjectBreakdown(
        draft.project_allocations,
        totalAmount,
      );
      const invoiceId = draft.id ?? crypto.randomUUID();
      const previousPath = draft.pdf_path ?? null;
      let uploadedPath: string | null = null;

      if (file) uploadedPath = await uploadInvoicePdf(invoiceId, file);

      const payload = {
        id: invoiceId,
        client_id: primaryProject.client_id,
        document_type: draft.document_type,
        point_of_sale: draft.point_of_sale,
        invoice_number: draft.invoice_number,
        issue_date: draft.issue_date,
        due_date: draft.due_date || null,
        concept: draft.concept.trim(),
        net_amount: netAmount,
        vat_amount: vatAmount,
        total_amount: totalAmount,
        currency: primaryProject.currency as CurrencyCode,
        pdf_path: uploadedPath ?? (removeExisting ? null : previousPath),
        notes: draft.notes?.trim() || null,
        status: draft.status ?? "issued",
      };

      const result = await supabase.rpc("save_invoice_with_projects", {
        p_invoice: payload,
        p_projects: projectAllocations,
      });

      // Retain PDFs: paths may be shared and a network error can follow commit.
      if (result.error) throw result.error;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.draft.id ? "Factura actualizada." : "Factura registrada.");
      invalidate();
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar la factura."),
  });

  const cancelInvoice = useMutation({
    mutationFn: async (invoice: InvoiceBalance) => {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "cancelled" })
        .eq("id", invoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Factura anulada.");
      invalidate();
      setToCancel(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo anular la factura.");
      setToCancel(null);
    },
  });

  const deleteInvoice = useMutation({
    mutationFn: async (invoice: InvoiceBalance) => {
      const { error } = await supabase.from("invoices").delete().eq("id", invoice.id);
      if (error) throw error;
      // Retain the private PDF; another document may reference this object.
    },
    onSuccess: () => {
      toast.success("Registro de factura eliminado.");
      invalidate();
      setToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo eliminar la factura.");
      setToDelete(null);
    },
  });

  const addAllocation = useMutation({
    mutationFn: async ({
      invoiceId,
      collectionId,
      projects,
    }: {
      invoiceId: string;
      collectionId: string;
      projects: { project_id: string; amount: number }[];
    }) => {
      const { error } = await supabase.rpc("allocate_collection_to_invoice_projects", {
        p_invoice_id: invoiceId,
        p_collection_id: collectionId,
        p_projects: projects,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cobro imputado a la factura.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo imputar el cobro."),
  });

  const removeAllocationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Imputación eliminada; el cobro vuelve a quedar disponible.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo quitar la imputación."),
  });

  function closeForm() {
    setEditing(null);
    setPdfFile(null);
    setRemovePdf(false);
  }

  function startCreate() {
    const project = filters.projectId !== "all" ? projectMap[filters.projectId] : undefined;
    setEditing({
      project_id: project?.id,
      client_id: project?.client_id,
      currency: project?.currency ?? "ARS",
      project_allocations: project ? [{ project_id: project.id, amount: "" }] : [],
      document_type: "C",
      point_of_sale: "00001",
      invoice_number: "",
      issue_date: today(),
      concept: "",
      net_amount: null,
      vat_amount: null,
      total_amount: "",
      notes: null,
      status: "issued",
    });
  }

  function startEdit(invoice: InvoiceBalance) {
    setEditing({
      ...invoice,
      project_allocations: (invoiceProjectsByInvoice[invoice.id] ?? []).map((line) => ({
        project_id: line.project_id,
        amount: line.project_amount,
      })),
    });
  }

  async function openPdf(invoice: InvoiceBalance) {
    if (!invoice.pdf_path) return;
    try {
      await openSignedPdf(
        async () => {
          const { data, error } = await supabase.storage
            .from("invoice-documents")
            .createSignedUrl(invoice.pdf_path!, 60);
          if (error) throw error;
          if (!data?.signedUrl) throw new Error("Storage no devolvió una URL firmada para el PDF.");
          return data.signedUrl;
        },
        (signedUrl) => window.location.assign(signedUrl),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir el PDF.");
    }
  }

  const allocationsForInvoice = (invoiceId: string) =>
    allocations.filter((allocation) => allocation.invoice_id === invoiceId);
  const currentViewing = viewing
    ? (invoices.find((invoice) => invoice.id === viewing.id) ?? viewing)
    : null;
  const currentAllocating = allocating
    ? (invoices.find((invoice) => invoice.id === allocating.id) ?? allocating)
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Facturación manual</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Registro de comprobantes ya emitidos. No genera facturas fiscales ni duplica cobros.
            </p>
          </div>
          <Button size="sm" onClick={startCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nueva factura
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <FinancialFilters
            value={filters}
            onChange={setFilters}
            count={filtered.length}
            fields={[
              { key: "clientId", label: "Cliente", options: clientMap },
              {
                key: "projectId",
                label: "Proyecto",
                options: Object.fromEntries(
                  filteredProjects.map((p) => [p.id, p.code + " — " + p.name]),
                ),
              },
              { key: "status", label: "Estado", options: invoiceStatusLabel },
              { key: "paymentStatus", label: "Cobranza", options: invoicePaymentStatusLabel },
              {
                key: "documentType",
                label: "Tipo de comprobante",
                options: invoiceDocumentTypeLabel,
              },
              { key: "currency", label: "Moneda", options: { ARS: "ARS", USD: "USD" } },
            ]}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comprobante</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente / proyecto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cobranza</TableHead>
                  <TableHead className="text-right">Bruto / neto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No hay facturas para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((invoice) => {
                  const invoiceProjectLines = invoiceProjectsByInvoice[invoice.id] ?? [];
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <div className="font-medium">
                          {invoiceDocumentTypeLabel[invoice.document_type]}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(invoice.issue_date)}</TableCell>
                      <TableCell>
                        <div>{clientMap[invoice.client_id] ?? "—"}</div>
                        <div className="space-y-0.5">
                          {invoiceProjectLines.map((line) => {
                            const project = projectMap[line.project_id];
                            return project ? (
                              <Link
                                key={line.project_id}
                                to="/proyectos/$id"
                                params={{ id: project.id }}
                                className="block text-xs text-muted-foreground hover:underline"
                              >
                                {project.code} — {project.name}
                              </Link>
                            ) : null;
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={invoice.status === "cancelled" ? "secondary" : "outline"}>
                          {invoiceStatusLabel[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {invoice.status === "cancelled" ? (
                          <span className="text-sm text-muted-foreground">No aplica</span>
                        ) : (
                          <Badge
                            variant={invoice.payment_status === "paid" ? "default" : "outline"}
                          >
                            {invoicePaymentStatusLabel[invoice.payment_status]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{formatARS(Number(invoice.gross_amount), invoice.currency)}</div>
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
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ver"
                            onClick={() => setViewing(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {invoice.status !== "cancelled" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Imputar cobros"
                                onClick={() => setAllocating(invoice)}
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Editar"
                                onClick={() => startEdit(invoice)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Anular"
                                onClick={() => setToCancel(invoice)}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Eliminar registro cargado por error"
                            onClick={() => setToDelete(invoice)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {schema.data === true &&
      !notesError &&
      !noteProjectsError &&
      !notesPending &&
      !noteProjectsPending ? (
        <CreditNotesSection
          invoices={invoices}
          invoiceProjects={invoiceProjects}
          creditNotes={creditNotes}
          creditNoteProjects={creditNoteProjects}
          projects={projects}
          clients={clients}
          onChanged={invalidate}
        />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm" role="status">
            {schema.error || notesError || noteProjectsError
              ? "No se pudieron cargar las notas de crédito. Revisá la conexión y los permisos."
              : schema.isPending
                ? "Comprobando disponibilidad de notas de crédito..."
                : "Notas de crédito no disponibles: falta aplicar la migración. La facturación actual sigue disponible."}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        {editing && (
          <InvoiceForm
            draft={editing}
            setDraft={setEditing}
            projects={projects}
            clients={clients}
            file={pdfFile}
            setFile={setPdfFile}
            removePdf={removePdf}
            setRemovePdf={setRemovePdf}
            saving={save.isPending}
            onSubmit={() =>
              save.mutate({ draft: editing, file: pdfFile, removeExisting: removePdf })
            }
          />
        )}
      </Dialog>

      <Dialog
        open={!!currentViewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        {currentViewing && (
          <InvoiceDetails
            invoice={currentViewing}
            projects={invoiceProjectsByInvoice[currentViewing.id] ?? []}
            projectMap={projectMap}
            clientName={clientMap[currentViewing.client_id]}
            allocations={allocationsForInvoice(currentViewing.id)}
            creditNotes={creditNotes.filter((note) => note.invoice_id === currentViewing.id)}
            collections={collectionMap}
            onOpenPdf={() => openPdf(currentViewing)}
          />
        )}
      </Dialog>

      <Dialog
        open={!!currentAllocating}
        onOpenChange={(open) => {
          if (!open) setAllocating(null);
        }}
      >
        {currentAllocating && (
          <AllocationDialog
            invoice={currentAllocating}
            projects={invoiceProjectsByInvoice[currentAllocating.id] ?? []}
            projectMap={projectMap}
            collections={collections}
            allocations={allocationsForInvoice(currentAllocating.id)}
            collectionMap={collectionMap}
            adding={addAllocation.isPending}
            removing={removeAllocationMutation.isPending}
            onAdd={(collectionId, projectAmounts) =>
              addAllocation.mutate({
                invoiceId: currentAllocating.id,
                collectionId,
                projects: projectAmounts,
              })
            }
            onRemove={(id) => removeAllocationMutation.mutate(id)}
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!toCancel}
        onOpenChange={(open) => {
          if (!open) setToCancel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular factura</AlertDialogTitle>
            <AlertDialogDescription>
              La factura conservará su historial pero dejará de sumar en los indicadores. Si tiene
              cobros imputados, primero deberás desvincularlos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => toCancel && cancelInvoice.mutate(toCancel)}>
              Anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar registro de factura</AlertDialogTitle>
            <AlertDialogDescription>
              Usá esta acción únicamente para cargas erróneas. No se puede eliminar una factura con
              cobros imputados y esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && deleteInvoice.mutate(toDelete)}>
              Eliminar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvoiceForm({
  draft,
  setDraft,
  projects,
  clients,
  file,
  setFile,
  removePdf,
  setRemovePdf,
  saving,
  onSubmit,
}: {
  draft: InvoiceDraft;
  setDraft: (draft: InvoiceDraft | null) => void;
  projects: ProjectMin[];
  clients: ClientMin[];
  file: File | null;
  setFile: (file: File | null) => void;
  removePdf: boolean;
  setRemovePdf: (remove: boolean) => void;
  saving: boolean;
  onSubmit: () => void;
}) {
  const set = (key: keyof InvoiceDraft, value: unknown) => setDraft({ ...draft, [key]: value });
  const hasBreakdown =
    draft.net_amount !== "" &&
    draft.net_amount != null &&
    draft.vat_amount !== "" &&
    draft.vat_amount != null;
  const calculatedTotal =
    Math.round(
      (hasBreakdown
        ? Number(draft.net_amount) + Number(draft.vat_amount)
        : Number(draft.total_amount || 0)) * 100,
    ) / 100;
  const selectedProjects = draft.project_allocations
    .map((line) => projects.find((project) => project.id === line.project_id))
    .filter((project): project is ProjectMin => Boolean(project));
  const selectedCurrency = selectedProjects[0]?.currency ?? draft.currency ?? "ARS";
  const availableProjects = projects.filter(
    (project) =>
      project.client_id === draft.client_id &&
      (selectedProjects.length === 0 || project.currency === selectedCurrency),
  );
  const distributedTotal = draft.project_allocations.reduce(
    (sum, line) => sum + Number(line.amount || 0),
    0,
  );
  const distributionDifference = Math.round((calculatedTotal - distributedTotal) * 100) / 100;

  const toggleProject = (project: ProjectMin, checked: boolean) => {
    const projectAllocations = checked
      ? [
          ...draft.project_allocations,
          {
            project_id: project.id,
            amount:
              draft.project_allocations.length === 0 && calculatedTotal > 0 ? calculatedTotal : "",
          },
        ]
      : draft.project_allocations.filter((line) => line.project_id !== project.id);
    const primary = projects.find((item) => item.id === projectAllocations[0]?.project_id);
    setDraft({
      ...draft,
      project_allocations: projectAllocations,
      project_id: primary?.id,
      client_id: primary?.client_id ?? draft.client_id,
      currency: primary?.currency ?? draft.currency,
    });
  };

  const setProjectAmount = (projectId: string, amount: string) => {
    setDraft({
      ...draft,
      project_allocations: draft.project_allocations.map((line) =>
        line.project_id === projectId ? { ...line, amount } : line,
      ),
    });
  };

  return (
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{draft.id ? "Editar factura" : "Registrar factura"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Cliente *">
            <Select
              value={draft.client_id ?? ""}
              onValueChange={(value) => {
                setDraft({
                  ...draft,
                  client_id: value,
                  project_id: undefined,
                  project_allocations: [],
                });
              }}
              disabled={Boolean(draft.id && Number(draft.allocated_amount) > 0)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Moneda de los proyectos *">
            <Input value={selectedCurrency} readOnly disabled />
          </Field>
          <Field label="Tipo de comprobante *">
            <Select
              value={draft.document_type ?? "C"}
              onValueChange={(value) => set("document_type", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(invoiceDocumentTypeLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Punto de venta *">
              <Input
                inputMode="numeric"
                maxLength={8}
                value={draft.point_of_sale ?? ""}
                onChange={(event) => set("point_of_sale", event.target.value.replace(/\D/g, ""))}
                placeholder="00001"
                required
              />
            </Field>
            <Field label="Número *">
              <Input
                inputMode="numeric"
                maxLength={20}
                value={draft.invoice_number ?? ""}
                onChange={(event) => set("invoice_number", event.target.value.replace(/\D/g, ""))}
                placeholder="00000001"
                required
              />
            </Field>
          </div>
          <Field label="Fecha de emisión *">
            <DateInput
              value={draft.issue_date}
              onChange={(value) => set("issue_date", value)}
              required
            />
          </Field>
          <Field label="Fecha de vencimiento">
            <DateInput value={draft.due_date} onChange={(value) => set("due_date", value)} />
          </Field>
          <Field label="Importe neto (opcional)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draft.net_amount ?? ""}
              onChange={(event) => set("net_amount", event.target.value)}
            />
          </Field>
          <Field label="IVA (opcional)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draft.vat_amount ?? ""}
              onChange={(event) => set("vat_amount", event.target.value)}
            />
          </Field>
          <Field label={hasBreakdown ? "Total calculado" : "Importe total *"}>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={hasBreakdown ? String(calculatedTotal) : (draft.total_amount ?? "")}
              onChange={(event) => set("total_amount", event.target.value)}
              readOnly={hasBreakdown}
              required
            />
          </Field>
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Desglose por proyecto *</div>
            <p className="text-xs text-muted-foreground">
              Seleccioná una o más obras del mismo cliente y moneda. La suma debe coincidir con el
              total de la factura.
            </p>
          </div>
          {!draft.client_id && (
            <p className="text-sm text-muted-foreground">Seleccioná primero un cliente.</p>
          )}
          {draft.client_id && availableProjects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay proyectos compatibles para el cliente y la moneda seleccionados.
            </p>
          )}
          {availableProjects.map((project) => {
            const line = draft.project_allocations.find((item) => item.project_id === project.id);
            return (
              <div
                key={project.id}
                className="grid items-center gap-3 rounded-md border p-2 sm:grid-cols-[1fr_12rem]"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={Boolean(line)}
                    onCheckedChange={(checked) => toggleProject(project, checked === true)}
                  />
                  <span>
                    {project.code} — {project.name}
                  </span>
                </label>
                <Input
                  aria-label={`Importe para ${project.code}`}
                  type="number"
                  min={0.01}
                  step="0.01"
                  disabled={!line}
                  value={line?.amount ?? ""}
                  onChange={(event) => setProjectAmount(project.id, event.target.value)}
                  placeholder="Importe"
                />
              </div>
            );
          })}
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>Distribuido: {formatARS(distributedTotal, selectedCurrency)}</span>
            <span
              className={distributionDifference === 0 ? "text-emerald-600" : "text-destructive"}
            >
              {distributionDifference === 0
                ? "La suma coincide con el total"
                : `Diferencia: ${formatARS(distributionDifference, selectedCurrency)}`}
            </span>
          </div>
        </div>
        <Field label="Concepto / descripción *">
          <Textarea
            rows={2}
            value={draft.concept ?? ""}
            onChange={(event) => set("concept", event.target.value)}
            required
          />
        </Field>
        <Field label="PDF adjunto (máximo 10 MB)">
          <Input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              if (event.target.files?.[0]) setRemovePdf(false);
            }}
          />
          {file && <p className="text-xs text-muted-foreground">Nuevo archivo: {file.name}</p>}
          {draft.pdf_path && !file && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> PDF privado adjunto
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setRemovePdf(!removePdf)}
              >
                {removePdf ? "Conservar" : "Quitar"}
              </Button>
              {removePdf && <span className="text-destructive">Se quitará al guardar</span>}
            </div>
          )}
        </Field>
        <Field label="Observaciones">
          <Textarea
            rows={3}
            value={draft.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving ? "Guardando..." : "Guardar factura"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function InvoiceDetails({
  invoice,
  projects,
  projectMap,
  clientName,
  allocations,
  creditNotes,
  collections,
  onOpenPdf,
}: {
  invoice: InvoiceBalance;
  projects: InvoiceProjectBalance[];
  projectMap: Record<string, ProjectMin>;
  clientName?: string;
  allocations: InvoiceAllocation[];
  creditNotes: CreditNote[];
  collections: Record<string, CollectionAllocationSummary>;
  onOpenPdf: () => void;
}) {
  return (
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Detalle de factura</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Data
          label="Comprobante"
          value={`${invoiceDocumentTypeLabel[invoice.document_type]} ${formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)}`}
        />
        <Data label="Estado" value={invoiceStatusLabel[invoice.status]} />
        <Data label="Cliente" value={clientName ?? "—"} />
        <Data
          label="Proyectos"
          value={projects.length === 1 ? "1 proyecto" : `${projects.length} proyectos`}
        />
        <Data label="Emisión" value={formatDate(invoice.issue_date)} />
        <Data label="Vencimiento" value={formatDate(invoice.due_date)} />
        <Data
          label="Neto"
          value={
            invoice.net_amount == null
              ? "No informado"
              : formatARS(Number(invoice.net_amount), invoice.currency)
          }
        />
        <Data
          label="IVA"
          value={
            invoice.vat_amount == null
              ? "No informado"
              : formatARS(Number(invoice.vat_amount), invoice.currency)
          }
        />
        <Data
          label="Facturación bruta"
          value={formatARS(Number(invoice.gross_amount), invoice.currency)}
        />
        <Data
          label="Notas de crédito activas"
          value={formatARS(Number(invoice.credit_note_amount), invoice.currency)}
        />
        <Data
          label="Facturación neta"
          value={formatARS(Number(invoice.net_billed_amount), invoice.currency)}
        />
        <Data
          label="Cobrado e imputado"
          value={formatARS(Number(invoice.allocated_amount), invoice.currency)}
        />
        <Data
          label="Saldo pendiente"
          value={formatARS(Number(invoice.balance_due), invoice.currency)}
        />
        <Data
          label="Crédito a favor / a devolver"
          value={formatARS(Number(invoice.credit_balance), invoice.currency)}
        />
        <Data
          label="Estado de cobranza"
          value={
            invoice.status === "cancelled"
              ? "No aplica"
              : invoicePaymentStatusLabel[invoice.payment_status]
          }
        />
      </div>
      <Data label="Concepto" value={invoice.concept} />
      <Data label="Observaciones" value={invoice.notes || "—"} />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Desglose por proyecto</h3>
        {projects.map((line) => {
          const project = projectMap[line.project_id];
          return (
            <div key={line.project_id} className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {project ? `${project.code} — ${project.name}` : line.project_id}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <Data
                  label="Bruto"
                  value={formatARS(Number(line.project_gross_amount), invoice.currency)}
                />
                <Data
                  label="Notas"
                  value={formatARS(Number(line.credit_note_amount), invoice.currency)}
                />
                <Data
                  label="Neto"
                  value={formatARS(Number(line.net_billed_amount), invoice.currency)}
                />
                <Data
                  label="Cobrado"
                  value={formatARS(Number(line.allocated_amount), invoice.currency)}
                />
                <Data
                  label="Pendiente"
                  value={formatARS(Number(line.balance_due), invoice.currency)}
                />
                {Number(line.credit_balance) > 0 && (
                  <Data
                    label="A favor"
                    value={formatARS(Number(line.credit_balance), invoice.currency)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Notas de crédito vinculadas</h3>
        {creditNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay notas vinculadas.</p>
        ) : (
          creditNotes.map((note) => (
            <div key={note.id} className="flex justify-between rounded-md border p-2 text-sm">
              <span>
                {formatDate(note.issue_date)} · NC{" "}
                {note.document_type === "OTHER" ? "Otro" : note.document_type}{" "}
                {formatInvoiceNumber(note.point_of_sale, note.credit_note_number)}
                {note.status === "cancelled" ? " · Anulada" : ""}
              </span>
              <span className="font-medium">{formatARS(Number(note.amount), "ARS")}</span>
            </div>
          ))
        )}
      </div>
      {invoice.pdf_path && (
        <Button variant="outline" onClick={onOpenPdf}>
          <FileText className="mr-2 h-4 w-4" /> Abrir PDF privado
        </Button>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Cobros imputados</h3>
        {allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cobros vinculados.</p>
        ) : (
          allocations.map((allocation) => {
            const collection = collections[allocation.collection_id];
            return (
              <div
                key={allocation.id}
                className="flex justify-between rounded-md border p-2 text-sm"
              >
                <span>
                  {formatDate(collection?.collection_date)} · {collection?.description || "Cobro"}
                  {projectMap[allocation.project_id]
                    ? ` · ${projectMap[allocation.project_id].code}`
                    : ""}
                </span>
                <span className="font-medium">
                  {formatARS(Number(allocation.amount), invoice.currency)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </DialogContent>
  );
}

function AllocationDialog({
  invoice,
  projects,
  projectMap,
  collections,
  allocations,
  collectionMap,
  adding,
  removing,
  onAdd,
  onRemove,
}: {
  invoice: InvoiceBalance;
  projects: InvoiceProjectBalance[];
  projectMap: Record<string, ProjectMin>;
  collections: CollectionAllocationSummary[];
  allocations: InvoiceAllocation[];
  collectionMap: Record<string, CollectionAllocationSummary>;
  adding: boolean;
  removing: boolean;
  onAdd: (collectionId: string, projects: { project_id: string; amount: number }[]) => void;
  onRemove: (id: string) => void;
}) {
  const [collectionId, setCollectionId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const eligible = collections.filter((collection) =>
    projects.some((project) => maximumProjectAllocation(invoice, project, collection) > 0),
  );
  const selected = collectionMap[collectionId];
  const requestedTotal = Object.values(amounts).reduce(
    (sum, amount) => sum + Number(amount || 0),
    0,
  );
  const availableFromCollection = Number(selected?.unallocated_amount ?? 0);
  const requestedProjects = projects
    .map((project) => ({
      project_id: project.project_id,
      amount: Number(amounts[project.project_id] || 0),
    }))
    .filter((project) => project.amount > 0);

  return (
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          Imputar cobros a {formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-3">
        <Data label="Total" value={formatARS(Number(invoice.total_amount), invoice.currency)} />
        <Data
          label="Ya imputado"
          value={formatARS(Number(invoice.allocated_amount), invoice.currency)}
        />
        <Data label="Saldo" value={formatARS(Number(invoice.balance_due), invoice.currency)} />
      </div>
      <div className="space-y-3 rounded-md border p-3">
        <Field label="Cobro disponible">
          <Select
            value={collectionId}
            onValueChange={(value) => {
              setCollectionId(value);
              setAmounts({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar cobro" />
            </SelectTrigger>
            <SelectContent>
              {eligible.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {formatDate(collection.collection_date)} · {collection.description || "Cobro"} ·
                  disponible {formatARS(Number(collection.unallocated_amount), collection.currency)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {eligible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay cobros compatibles con saldo disponible para este cliente y moneda.
          </p>
        )}
        {selected && (
          <div className="space-y-2">
            {projects.map((projectLine) => {
              const project = projectMap[projectLine.project_id];
              const otherRequested = requestedTotal - Number(amounts[projectLine.project_id] || 0);
              const maximum = Math.max(
                0,
                Math.min(Number(projectLine.balance_due), availableFromCollection - otherRequested),
              );
              return (
                <div
                  key={projectLine.project_id}
                  className="grid items-end gap-2 sm:grid-cols-[1fr_12rem]"
                >
                  <div className="text-sm">
                    <div>
                      {project ? `${project.code} — ${project.name}` : projectLine.project_id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Pendiente {formatARS(Number(projectLine.balance_due), invoice.currency)}
                    </div>
                  </div>
                  <Input
                    aria-label={`Imputar a ${project?.code ?? projectLine.project_id}`}
                    type="number"
                    min={0}
                    max={maximum || undefined}
                    step="0.01"
                    value={amounts[projectLine.project_id] ?? ""}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [projectLine.project_id]: event.target.value,
                      }))
                    }
                    placeholder={`Máx. ${formatARS(maximum, invoice.currency)}`}
                  />
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-sm text-muted-foreground">
                Total a imputar: {formatARS(requestedTotal, invoice.currency)} de{" "}
                {formatARS(availableFromCollection, invoice.currency)} disponibles
              </span>
              <Button
                disabled={
                  requestedProjects.length === 0 ||
                  requestedTotal > availableFromCollection ||
                  requestedProjects.some((requested) => {
                    const line = projects.find(
                      (project) => project.project_id === requested.project_id,
                    );
                    return !line || requested.amount > Number(line.balance_due);
                  }) ||
                  adding
                }
                onClick={() => onAdd(collectionId, requestedProjects)}
              >
                <Link2 className="mr-1 h-4 w-4" /> Imputar distribución
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Imputaciones actuales</h3>
        {allocations.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin imputaciones.</p>
        )}
        {allocations.map((allocation) => {
          const collection = collectionMap[allocation.collection_id];
          return (
            <div
              key={allocation.id}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <div>
                <div>
                  {formatDate(collection?.collection_date)} · {collection?.description || "Cobro"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {paymentMethodLabel[collection?.payment_method ?? ""] ?? ""}
                  {projectMap[allocation.project_id]
                    ? ` · ${projectMap[allocation.project_id].code}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {formatARS(Number(allocation.amount), invoice.currency)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={removing}
                  title="Desvincular"
                  onClick={() => onRemove(allocation.id)}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </DialogContent>
  );
}

async function uploadInvoicePdf(invoiceId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("El PDF no puede superar 10 MB.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("El archivo adjunto debe ser un PDF.");
  }
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) throw new Error("La sesión no está disponible.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${data.user.id}/${invoiceId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from("invoice-documents")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  return path;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-full space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
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
