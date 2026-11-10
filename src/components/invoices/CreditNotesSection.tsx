import { useMemo, useState } from "react";
import { Ban, Eye, FileText, Pencil, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { todayIsoDate } from "@/lib/dates";
import { formatARS, formatDate } from "@/lib/finance";
import {
  creditNoteStatusLabel,
  filterCreditNotes,
  formatInvoiceNumber,
  invoiceDocumentTypeLabel,
  openSignedPdf,
  validateCreditNoteProjectBreakdown,
  type CreditNote,
  type CreditNoteFilters,
  type CreditNoteProject,
  type InvoiceBalance,
  type InvoiceProjectBalance,
} from "@/lib/invoices";

type ProjectOption = { id: string; code: string; name: string; client_id: string };
type ClientOption = { id: string; name: string };

type CreditNoteDraft = Partial<CreditNote> & {
  project_allocations: { project_id: string; amount: number | string }[];
};

const initialFilters: CreditNoteFilters = {
  clientId: "all",
  projectId: "all",
  from: "",
  to: "",
  invoice: "",
};

export function CreditNotesSection({
  invoices,
  invoiceProjects,
  creditNotes,
  creditNoteProjects,
  projects,
  clients,
  onChanged,
}: {
  invoices: InvoiceBalance[];
  invoiceProjects: InvoiceProjectBalance[];
  creditNotes: CreditNote[];
  creditNoteProjects: CreditNoteProject[];
  projects: ProjectOption[];
  clients: ClientOption[];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(initialFilters);
  const [editing, setEditing] = useState<CreditNoteDraft | null>(null);
  const [viewing, setViewing] = useState<CreditNote | null>(null);
  const [toCancel, setToCancel] = useState<CreditNote | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [removePdf, setRemovePdf] = useState(false);

  const invoiceMap = useMemo(
    () => Object.fromEntries(invoices.map((invoice) => [invoice.id, invoice])),
    [invoices],
  );
  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project])),
    [projects],
  );
  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((client) => [client.id, client.name])),
    [clients],
  );
  const invoiceProjectsByInvoice = useMemo(() => {
    const result: Record<string, InvoiceProjectBalance[]> = {};
    invoiceProjects.forEach((line) => (result[line.invoice_id] ??= []).push(line));
    return result;
  }, [invoiceProjects]);
  const noteProjectsByNote = useMemo(() => {
    const result: Record<string, CreditNoteProject[]> = {};
    creditNoteProjects.forEach((line) => (result[line.credit_note_id] ??= []).push(line));
    return result;
  }, [creditNoteProjects]);
  const activeNotesByInvoice = useMemo(() => {
    const result: Record<string, CreditNote[]> = {};
    creditNotes
      .filter((note) => note.status === "active")
      .forEach((note) => (result[note.invoice_id] ??= []).push(note));
    return result;
  }, [creditNotes]);

  const filteredProjects =
    filters.clientId === "all"
      ? projects
      : projects.filter((project) => project.client_id === filters.clientId);
  const filtered = useMemo(
    () => filterCreditNotes(creditNotes, creditNoteProjects, invoices, filters),
    [creditNoteProjects, creditNotes, filters, invoices],
  );
  const eligibleInvoices = invoices.filter(
    (invoice) => invoice.currency === "ARS" && invoice.status === "issued",
  );

  const closeForm = () => {
    setEditing(null);
    setPdfFile(null);
    setRemovePdf(false);
  };

  const save = useMutation({
    mutationFn: async ({
      draft,
      file,
      removeExisting,
    }: {
      draft: CreditNoteDraft;
      file: File | null;
      removeExisting: boolean;
    }) => {
      const invoice = draft.invoice_id ? invoiceMap[draft.invoice_id] : undefined;
      if (!invoice) throw new Error("Seleccioná una factura.");
      if (invoice.currency !== "ARS") {
        throw new Error("Las notas de crédito solo están habilitadas para facturas en ARS.");
      }
      if (!draft.document_type) throw new Error("Seleccioná un tipo de comprobante.");
      if (!draft.point_of_sale?.match(/^\d{1,8}$/)) {
        throw new Error("El punto de venta debe contener únicamente números.");
      }
      if (!draft.credit_note_number?.match(/^\d{1,20}$/)) {
        throw new Error("El número debe contener únicamente números.");
      }
      if (!draft.issue_date) throw new Error("La fecha es obligatoria.");
      if (draft.issue_date < invoice.issue_date) {
        throw new Error("La fecha de la nota no puede ser anterior a la factura.");
      }
      if (!draft.reason?.trim()) throw new Error("El motivo es obligatorio.");

      const amount = Math.round(Number(draft.amount) * 100) / 100;
      const available = availableForInvoice(invoice, creditNotes, draft.id);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("El importe debe ser mayor a cero.");
      }
      if (amount > available) {
        throw new Error("La nota supera el importe disponible de la factura.");
      }

      const availableByProject = projectAvailability(
        invoice.id,
        invoiceProjectsByInvoice[invoice.id] ?? [],
        creditNotes,
        creditNoteProjects,
        draft.id,
      );
      const projectAllocations = validateCreditNoteProjectBreakdown(
        draft.project_allocations,
        amount,
        availableByProject,
      );
      const creditNoteId = draft.id ?? crypto.randomUUID();
      const previousPath = draft.pdf_path ?? null;
      let uploadedPath: string | null = null;

      if (file) uploadedPath = await uploadCreditNotePdf(creditNoteId, file);

      const payload = {
        id: creditNoteId,
        invoice_id: invoice.id,
        document_type: draft.document_type,
        point_of_sale: draft.point_of_sale,
        credit_note_number: draft.credit_note_number,
        issue_date: draft.issue_date,
        amount,
        reason: draft.reason.trim(),
        pdf_path: uploadedPath ?? (removeExisting ? null : previousPath),
      };

      const result = await supabase.rpc("save_credit_note_with_projects", {
        p_credit_note: payload,
        p_projects: projectAllocations,
      });
      if (result.error) {
        if (uploadedPath) await supabase.storage.from("invoice-documents").remove([uploadedPath]);
        throw result.error;
      }

      if (previousPath && previousPath !== payload.pdf_path) {
        const result = await supabase.storage.from("invoice-documents").remove([previousPath]);
        if (result.error)
          toast.warning("La nota se guardó, pero no se pudo quitar el PDF anterior.");
      }
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.draft.id ? "Nota de crédito actualizada." : "Nota de crédito registrada.",
      );
      queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["credit-note-projects"] });
      onChanged();
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar la nota."),
  });

  const cancel = useMutation({
    mutationFn: async (note: CreditNote) => {
      const { error } = await supabase.rpc("cancel_credit_note", { p_credit_note_id: note.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nota de crédito anulada.");
      queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["credit-note-projects"] });
      onChanged();
      setToCancel(null);
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo anular la nota."),
  });

  const openPdf = async (note: CreditNote) => {
    if (!note.pdf_path) return;
    try {
      await openSignedPdf(
        async () => {
          const { data, error } = await supabase.storage
            .from("invoice-documents")
            .createSignedUrl(note.pdf_path!, 60);
          if (error) throw error;
          if (!data?.signedUrl) throw new Error("Storage no devolvió una URL firmada.");
          return data.signedUrl;
        },
        (url) => window.location.assign(url),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir el PDF.");
    }
  };

  const startCreate = () =>
    setEditing({
      invoice_id: "",
      document_type: "C",
      point_of_sale: "00001",
      credit_note_number: "",
      issue_date: todayIsoDate(),
      amount: "",
      currency: "ARS",
      reason: "",
      status: "active",
      project_allocations: [],
    });

  const startEdit = (note: CreditNote) =>
    setEditing({
      ...note,
      project_allocations: (noteProjectsByNote[note.id] ?? []).map((line) => ({
        project_id: line.project_id,
        amount: line.amount,
      })),
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Notas de crédito</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajustan la cuenta corriente; no generan egresos ni modifican cobros existentes.
          </p>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus className="mr-1 h-4 w-4" /> Nueva nota de crédito
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          <Select
            value={filters.clientId}
            onValueChange={(clientId) =>
              setFilters((current) => ({ ...current, clientId, projectId: "all" }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.projectId}
            onValueChange={(projectId) => setFilters((current) => ({ ...current, projectId }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Proyecto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proyectos</SelectItem>
              {filteredProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateInput
            aria-label="Notas desde"
            value={filters.from}
            onChange={(from) => setFilters((current) => ({ ...current, from }))}
          />
          <DateInput
            aria-label="Notas hasta"
            value={filters.to}
            onChange={(to) => setFilters((current) => ({ ...current, to }))}
          />
          <Input
            placeholder="N.º de factura"
            value={filters.invoice}
            onChange={(event) =>
              setFilters((current) => ({ ...current, invoice: event.target.value }))
            }
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Cliente / proyectos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No hay notas para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((note) => {
                const invoice = invoiceMap[note.invoice_id];
                const lines = noteProjectsByNote[note.id] ?? [];
                return (
                  <TableRow key={note.id}>
                    <TableCell>
                      <div className="font-medium">
                        Nota de crédito{" "}
                        {note.document_type === "OTHER" ? "Otro" : note.document_type}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {formatInvoiceNumber(note.point_of_sale, note.credit_note_number)}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(note.issue_date)}</TableCell>
                    <TableCell>
                      {invoice
                        ? formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div>{clientMap[note.client_id] ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {lines
                          .map((line) => projectMap[line.project_id]?.code)
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={note.status === "cancelled" ? "secondary" : "outline"}>
                        {creditNoteStatusLabel[note.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatARS(Number(note.amount), "ARS")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Ver"
                          onClick={() => setViewing(note)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {note.status === "active" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Editar"
                              onClick={() => startEdit(note)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Anular"
                              onClick={() => setToCancel(note)}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        {editing && (
          <CreditNoteForm
            draft={editing}
            setDraft={setEditing}
            invoices={eligibleInvoices}
            invoiceProjects={invoiceProjectsByInvoice}
            creditNotes={creditNotes}
            creditNoteProjects={creditNoteProjects}
            clientMap={clientMap}
            projectMap={projectMap}
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
        open={!!viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        {viewing && (
          <CreditNoteDetails
            note={viewing}
            invoice={invoiceMap[viewing.invoice_id]}
            projects={noteProjectsByNote[viewing.id] ?? []}
            projectMap={projectMap}
            clientName={clientMap[viewing.client_id]}
            onOpenPdf={() => openPdf(viewing)}
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
            <AlertDialogTitle>Anular nota de crédito</AlertDialogTitle>
            <AlertDialogDescription>
              La nota dejará de reducir la facturación neta, pero conservará todo su historial y
              PDF.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => toCancel && cancel.mutate(toCancel)}>
              Anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CreditNoteForm({
  draft,
  setDraft,
  invoices,
  invoiceProjects,
  creditNotes,
  creditNoteProjects,
  clientMap,
  projectMap,
  file,
  setFile,
  removePdf,
  setRemovePdf,
  saving,
  onSubmit,
}: {
  draft: CreditNoteDraft;
  setDraft: (draft: CreditNoteDraft) => void;
  invoices: InvoiceBalance[];
  invoiceProjects: Record<string, InvoiceProjectBalance[]>;
  creditNotes: CreditNote[];
  creditNoteProjects: CreditNoteProject[];
  clientMap: Record<string, string>;
  projectMap: Record<string, ProjectOption>;
  file: File | null;
  setFile: (file: File | null) => void;
  removePdf: boolean;
  setRemovePdf: (remove: boolean) => void;
  saving: boolean;
  onSubmit: () => void;
}) {
  const invoice = draft.invoice_id
    ? invoices.find((item) => item.id === draft.invoice_id)
    : undefined;
  const lines = invoice ? (invoiceProjects[invoice.id] ?? []) : [];
  const available = invoice ? availableForInvoice(invoice, creditNotes, draft.id) : 0;
  const availableByProject = invoice
    ? projectAvailability(invoice.id, lines, creditNotes, creditNoteProjects, draft.id)
    : {};
  const distributed = draft.project_allocations.reduce(
    (sum, line) => sum + Number(line.amount || 0),
    0,
  );
  const amount = Number(draft.amount || 0);
  const set = <K extends keyof CreditNoteDraft>(key: K, value: CreditNoteDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const selectInvoice = (invoiceId: string) => {
    const selected = invoices.find((item) => item.id === invoiceId);
    const selectedLines = selected ? (invoiceProjects[selected.id] ?? []) : [];
    setDraft({
      ...draft,
      invoice_id: invoiceId,
      client_id: selected?.client_id,
      document_type: selected?.document_type ?? "C",
      point_of_sale: selected?.point_of_sale ?? "00001",
      issue_date:
        draft.issue_date && selected && draft.issue_date >= selected.issue_date
          ? draft.issue_date
          : (selected?.issue_date ?? todayIsoDate()),
      amount: "",
      project_allocations: selectedLines.map((line) => ({
        project_id: line.project_id,
        amount: "",
      })),
    });
  };
  const setAmount = (value: string) => {
    const allocations =
      lines.length === 1
        ? [{ project_id: lines[0].project_id, amount: value }]
        : draft.project_allocations;
    setDraft({ ...draft, amount: value, project_allocations: allocations });
  };
  const creditTotal = () => {
    if (!invoice) return;
    setDraft({
      ...draft,
      amount: available,
      project_allocations: lines
        .map((line) => ({
          project_id: line.project_id,
          amount: availableByProject[line.project_id] ?? 0,
        }))
        .filter((line) => Number(line.amount) > 0),
    });
  };

  return (
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{draft.id ? "Editar nota de crédito" : "Nueva nota de crédito"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Field label="Factura asociada *">
          <Select
            value={draft.invoice_id ?? ""}
            onValueChange={selectInvoice}
            disabled={Boolean(draft.id)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar factura ARS" />
            </SelectTrigger>
            <SelectContent>
              {invoices.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {clientMap[item.client_id] ?? "Cliente"} ·{" "}
                  {invoiceDocumentTypeLabel[item.document_type]}{" "}
                  {formatInvoiceNumber(item.point_of_sale, item.invoice_number)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {invoice && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Data label="Importe original" value={formatARS(Number(invoice.total_amount), "ARS")} />
            <Data
              label="Cobros imputados"
              value={formatARS(Number(invoice.allocated_amount), "ARS")}
            />
            <Data label="Saldo pendiente" value={formatARS(Number(invoice.balance_due), "ARS")} />
            <Data label="Disponible para acreditar" value={formatARS(available, "ARS")} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo *">
            <Select
              value={draft.document_type ?? "C"}
              onValueChange={(value) => set("document_type", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["A", "B", "C", "E", "M", "OTHER"].map((type) => (
                  <SelectItem key={type} value={type}>
                    Nota de crédito {type === "OTHER" ? "Otro" : type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fecha *">
            <DateInput
              value={draft.issue_date}
              onChange={(value) => set("issue_date", value)}
              required
            />
          </Field>
          <Field label="Punto de venta *">
            <Input
              inputMode="numeric"
              maxLength={8}
              value={draft.point_of_sale ?? ""}
              onChange={(event) => set("point_of_sale", event.target.value.replace(/\D/g, ""))}
              required
            />
          </Field>
          <Field label="Número *">
            <Input
              inputMode="numeric"
              maxLength={20}
              value={draft.credit_note_number ?? ""}
              onChange={(event) => set("credit_note_number", event.target.value.replace(/\D/g, ""))}
              required
            />
          </Field>
          <Field label="Importe en ARS *">
            <div className="flex gap-2">
              <Input
                type="number"
                min={0.01}
                max={available || undefined}
                step="0.01"
                value={draft.amount ?? ""}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
              <Button
                type="button"
                variant="outline"
                onClick={creditTotal}
                disabled={!invoice || available <= 0}
              >
                Total
              </Button>
            </div>
          </Field>
        </div>
        {invoice && (
          <div className="space-y-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Distribución por proyecto *</div>
              <p className="text-xs text-muted-foreground">
                La suma debe coincidir con la nota y no superar el disponible de cada proyecto.
              </p>
            </div>
            {lines.map((line) => {
              const project = projectMap[line.project_id];
              const current = draft.project_allocations.find(
                (item) => item.project_id === line.project_id,
              );
              return (
                <div
                  key={line.project_id}
                  className="grid items-end gap-2 sm:grid-cols-[1fr_12rem]"
                >
                  <div className="text-sm">
                    <div>{project ? `${project.code} — ${project.name}` : line.project_id}</div>
                    <div className="text-xs text-muted-foreground">
                      Disponible {formatARS(availableByProject[line.project_id] ?? 0, "ARS")}
                    </div>
                  </div>
                  <Input
                    aria-label={`Acreditar ${project?.code ?? line.project_id}`}
                    type="number"
                    min={0}
                    max={availableByProject[line.project_id]}
                    step="0.01"
                    value={current?.amount ?? ""}
                    onChange={(event) =>
                      set(
                        "project_allocations",
                        draft.project_allocations.map((item) =>
                          item.project_id === line.project_id
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              );
            })}
            <div
              className={
                distributed === amount ? "text-sm text-emerald-600" : "text-sm text-destructive"
              }
            >
              Distribuido {formatARS(distributed, "ARS")} ·{" "}
              {distributed === amount
                ? "Coincide con el total"
                : `Diferencia ${formatARS(amount - distributed, "ARS")}`}
            </div>
          </div>
        )}
        <Field label="Motivo u observaciones *">
          <Textarea
            rows={3}
            value={draft.reason ?? ""}
            onChange={(event) => set("reason", event.target.value)}
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
              <FileText className="h-3.5 w-3.5" /> PDF privado adjunto{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setRemovePdf(!removePdf)}
              >
                {removePdf ? "Conservar" : "Quitar"}
              </Button>
            </div>
          )}
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={saving || !invoice || distributed !== amount}>
            {saving ? "Guardando..." : "Guardar nota"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function CreditNoteDetails({
  note,
  invoice,
  projects,
  projectMap,
  clientName,
  onOpenPdf,
}: {
  note: CreditNote;
  invoice?: InvoiceBalance;
  projects: CreditNoteProject[];
  projectMap: Record<string, ProjectOption>;
  clientName?: string;
  onOpenPdf: () => void;
}) {
  return (
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Detalle de nota de crédito</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Data
          label="Nota"
          value={`NC ${note.document_type === "OTHER" ? "Otro" : note.document_type} ${formatInvoiceNumber(note.point_of_sale, note.credit_note_number)}`}
        />
        <Data label="Estado" value={creditNoteStatusLabel[note.status]} />
        <Data label="Cliente" value={clientName ?? "—"} />
        <Data label="Fecha" value={formatDate(note.issue_date)} />
        <Data
          label="Factura original"
          value={
            invoice
              ? `${invoiceDocumentTypeLabel[invoice.document_type]} ${formatInvoiceNumber(invoice.point_of_sale, invoice.invoice_number)}`
              : "—"
          }
        />
        <Data label="Importe" value={formatARS(Number(note.amount), "ARS")} />
      </div>
      <Data label="Motivo" value={note.reason} />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Distribución por proyecto</h3>
        {projects.map((line) => (
          <div key={line.project_id} className="flex justify-between rounded-md border p-2 text-sm">
            <span>
              {projectMap[line.project_id]
                ? `${projectMap[line.project_id].code} — ${projectMap[line.project_id].name}`
                : line.project_id}
            </span>
            <span className="font-medium">{formatARS(Number(line.amount), "ARS")}</span>
          </div>
        ))}
      </div>
      {note.pdf_path && (
        <Button variant="outline" onClick={onOpenPdf}>
          <FileText className="mr-2 h-4 w-4" /> Abrir PDF privado
        </Button>
      )}
    </DialogContent>
  );
}

function availableForInvoice(invoice: InvoiceBalance, notes: CreditNote[], editingId?: string) {
  const credited = notes
    .filter(
      (note) => note.invoice_id === invoice.id && note.status === "active" && note.id !== editingId,
    )
    .reduce((sum, note) => sum + Number(note.amount), 0);
  return Math.max(Number(invoice.total_amount) - credited, 0);
}

function projectAvailability(
  invoiceId: string,
  invoiceLines: InvoiceProjectBalance[],
  notes: CreditNote[],
  noteLines: CreditNoteProject[],
  editingId?: string,
) {
  const activeIds = new Set(
    notes
      .filter(
        (note) =>
          note.invoice_id === invoiceId && note.status === "active" && note.id !== editingId,
      )
      .map((note) => note.id),
  );
  return Object.fromEntries(
    invoiceLines.map((line) => [
      line.project_id,
      Math.max(
        Number(line.project_amount) -
          noteLines
            .filter(
              (item) =>
                item.invoice_id === invoiceId &&
                item.project_id === line.project_id &&
                activeIds.has(item.credit_note_id),
            )
            .reduce((sum, item) => sum + Number(item.amount), 0),
        0,
      ),
    ]),
  );
}

async function uploadCreditNotePdf(creditNoteId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("El PDF no puede superar 10 MB.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
    throw new Error("El archivo adjunto debe ser un PDF.");
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) throw new Error("La sesión no está disponible.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${data.user.id}/credit-notes/${creditNoteId}/${Date.now()}-${safeName}`;
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
