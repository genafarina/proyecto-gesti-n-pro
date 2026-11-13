import { FinancialFilters } from "@/components/finance/FinancialFilters";
import {
  filterFinancialRows,
  financialTotals,
  initialFinancialFilters,
  type FinancialFiltersValue,
} from "@/lib/financialFilters";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatARS, formatDate } from "@/lib/finance";
import { expenseCategoryLabel, paymentMethodLabel } from "@/lib/labels";
import { todayIsoDate } from "@/lib/dates";

export const Route = createFileRoute("/_authenticated/gastos")({ component: GastosPage });

type Expense = {
  id?: string;
  project_id: string;
  expense_date: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  supplier: string | null;
  amount: number | string;
  payment_method: string;
  receipt_url: string | null;
  notes: string | null;
};

function GastosPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<FinancialFiltersValue>({
    ...initialFinancialFilters,
    projectId: "all",
    clientId: "all",
    category: "all",
    paymentMethod: "all",
    currency: "all",
  });
  const proj = filters.projectId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () =>
      (await supabase.from("projects").select("id,name,code,currency,client_id").order("code"))
        .data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () =>
      (await supabase.from("clients").select("id,name").order("name")).data ?? [],
  });
  const clientMap = Object.fromEntries(clients.map((client) => [client.id, client.name]));
  const { data: expenses = [] } = useQuery({
    queryKey: ["all-expenses"],
    queryFn: async () =>
      (
        await supabase
          .from("project_expenses")
          .select("*")
          .order("expense_date", { ascending: false })
      ).data ?? [],
  });

  const projMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["all-expenses"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const save = useMutation({
    mutationFn: async (x: Partial<Expense>) => {
      if (!x.project_id) throw new Error("Seleccioná un proyecto");
      if (!x.expense_date) throw new Error("La fecha es obligatoria");
      if (!x.category) throw new Error("La categoría es obligatoria");
      if (!x.payment_method) throw new Error("El método de pago es obligatorio");
      if (!x.description?.trim()) throw new Error("La descripción es obligatoria");
      const amt = Number(x.amount ?? 0);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Monto inválido");
      const payload = {
        project_id: x.project_id,
        expense_date: x.expense_date,
        category: x.category,
        subcategory: x.subcategory || null,
        description: x.description.trim(),
        supplier: x.supplier || null,
        amount: amt,
        payment_method: x.payment_method,
        receipt_url: x.receipt_url || null,
        notes: x.notes || null,
      };
      if (x.id) {
        const { error } = await supabase
          .from("project_expenses")
          .update(payload as never)
          .eq("id", x.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_expenses").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.id ? "Gasto actualizado correctamente." : "Gasto creado correctamente.");
      invalidateAll();
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar el registro."),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto eliminado correctamente.");
      invalidateAll();
      setToDelete(null);
    },
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo eliminar el registro.");
      setToDelete(null);
    },
  });

  const filtered = filterFinancialRows(expenses, filters, (e) => {
    const project = projMap[e.project_id];
    return {
      date: e.expense_date,
      fields: {
        projectId: e.project_id,
        clientId: project?.client_id,
        category: e.category,
        paymentMethod: e.payment_method,
        currency: project?.currency,
      },
      search: [
        e.description,
        e.supplier,
        e.notes,
        e.subcategory,
        expenseCategoryLabel[e.category],
        project?.code,
        project?.name,
        clientMap[project?.client_id],
      ],
    };
  });
  const totals = financialTotals(
    filtered,
    (e) => e.amount,
    (e) => projMap[e.project_id]?.currency ?? "ARS",
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Gastos</CardTitle>
          <div className="text-sm text-muted-foreground">
            Totales filtrados:{" "}
            {totals.map((total) => formatARS(total.amount, total.currency)).join(" · ") ||
              "Sin resultados"}
          </div>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() =>
                setEditing({
                  expense_date: todayIsoDate(),
                  category: "materials",
                  payment_method: "cash",
                  amount: 0,
                  project_id: proj !== "all" ? proj : undefined,
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Nuevo gasto
            </Button>
          </DialogTrigger>
          <ExpenseForm
            editing={editing}
            setEditing={setEditing}
            projects={projects}
            onSubmit={(x) => save.mutate(x)}
            saving={save.isPending}
          />
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
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
                projects
                  .filter((p) => filters.clientId === "all" || p.client_id === filters.clientId)
                  .map((p) => [p.id, p.code + " — " + p.name]),
              ),
            },
            { key: "category", label: "Categoría", options: expenseCategoryLabel },
            { key: "paymentMethod", label: "Método de pago", options: paymentMethodLabel },
            { key: "currency", label: "Moneda", options: { ARS: "ARS", USD: "USD" } },
          ]}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    Sin gastos.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.expense_date)}</TableCell>
                  <TableCell>
                    <Link
                      to="/proyectos/$id"
                      params={{ id: e.project_id }}
                      className="hover:underline"
                    >
                      {projMap[e.project_id]
                        ? `${projMap[e.project_id].code} - ${projMap[e.project_id].name}`
                        : "—"}
                    </Link>
                  </TableCell>
                  <TableCell>{expenseCategoryLabel[e.category]}</TableCell>
                  <TableCell>{e.description ?? "—"}</TableCell>
                  <TableCell>{paymentMethodLabel[e.payment_method]}</TableCell>
                  <TableCell className="text-right">
                    {formatARS(Number(e.amount), projMap[e.project_id]?.currency ?? "ARS")}
                  </TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar"
                      onClick={() => {
                        setEditing(e as Expense);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Eliminar"
                      onClick={() => setToDelete(e.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar gasto</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function ExpenseForm({
  editing,
  setEditing,
  projects,
  onSubmit,
  saving,
  lockProject,
}: {
  editing: Partial<Expense> | null;
  setEditing: (x: Partial<Expense> | null) => void;
  projects: { id: string; name: string; code?: string; currency?: string }[];
  onSubmit: (x: Partial<Expense>) => void;
  saving: boolean;
  lockProject?: boolean;
}) {
  if (!editing) return null;
  const x = editing;
  const set = (k: keyof Expense, v: string | null) => setEditing({ ...x, [k]: v });
  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{x.id ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(x);
        }}
        className="space-y-3"
      >
        {!lockProject && (
          <Field label="Proyecto *">
            <Select value={x.project_id ?? ""} onValueChange={(v) => set("project_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar proyecto" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p as { code?: string }).code
                      ? `${(p as { code: string }).code} - ${p.name}`
                      : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha *">
            <DateInput
              value={x.expense_date}
              onChange={(value) => set("expense_date", value)}
              required
            />
          </Field>
          <Field label="Monto *">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={String(x.amount ?? 0)}
              onChange={(e) => set("amount", e.target.value)}
              required
            />
          </Field>
          <Field label="Categoría *">
            <Select value={x.category ?? "other"} onValueChange={(v) => set("category", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(expenseCategoryLabel).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Método de pago *">
            <Select
              value={x.payment_method ?? "cash"}
              onValueChange={(v) => set("payment_method", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(paymentMethodLabel).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Subcategoría">
            <Input
              value={x.subcategory ?? ""}
              onChange={(e) => set("subcategory", e.target.value)}
            />
          </Field>
          <Field label="Proveedor">
            <Input value={x.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} />
          </Field>
        </div>
        <Field label="Descripción *">
          <Input
            value={x.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            required
          />
        </Field>
        <Field label="Comprobante (URL)">
          <Input value={x.receipt_url ?? ""} onChange={(e) => set("receipt_url", e.target.value)} />
        </Field>
        <Field label="Observaciones">
          <Textarea rows={2} value={x.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
