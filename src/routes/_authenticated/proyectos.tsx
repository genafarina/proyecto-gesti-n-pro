import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { projectStatusLabel, projectStatusVariant, currencyLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { formatARS, formatDate, isOverdueProject, projectProgress } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/proyectos")({
  component: ProyectosPage,
});

type Project = {
  id: string; client_id: string; name: string; code: string | null; description: string | null;
  status: string; planned_start_date: string | null; planned_end_date: string | null;
  actual_start_date: string | null; actual_end_date: string | null;
  estimated_amount: number | string; contracted_amount: number | string;
  estimated_cost: number | string; currency: string; notes: string | null;
};

const emptyProject: Partial<Project> = {
  name: "", status: "quoted", currency: "ARS",
  estimated_amount: 0, contracted_amount: 0, estimated_cost: 0,
};

function ProyectosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Project> | null>(null);
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [toDelete, setToDelete] = useState<Project | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id,name").order("name");
      return data ?? [];
    },
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["all-tasks-progress"],
    queryFn: async () => {
      const { data } = await supabase.from("project_tasks").select("project_id,progress_percentage,status,planned_end_date");
      return data ?? [];
    },
  });

  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);

  const save = useMutation({
    mutationFn: async (p: Partial<Project>) => {
      if (!p.name?.trim()) throw new Error("El nombre es obligatorio");
      if (!p.client_id) throw new Error("Seleccioná un cliente");
      const num = (v: unknown) => Math.max(0, Number(v ?? 0));
      const payload = {
        client_id: p.client_id, name: p.name.trim(), code: p.code || null,
        description: p.description || null, status: (p.status ?? "quoted") as Project["status"],
        planned_start_date: p.planned_start_date || null, planned_end_date: p.planned_end_date || null,
        actual_start_date: p.actual_start_date || null, actual_end_date: p.actual_end_date || null,
        estimated_amount: num(p.estimated_amount), contracted_amount: num(p.contracted_amount),
        estimated_cost: num(p.estimated_cost), currency: (p.currency ?? "ARS") as Project["currency"],
        notes: p.notes || null,
      };
      if (p.id) {
        const { error } = await supabase.from("projects").update(payload as never).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("projects").insert(payload as never);
        if (error) throw error;
      }

    },
    onSuccess: () => {
      toast.success("Proyecto guardado");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar el registro."),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proyecto eliminado correctamente.");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["all-expenses"] });
      qc.invalidateQueries({ queryKey: ["all-collections"] });
      qc.invalidateQueries({ queryKey: ["client-project-counts"] });
      setToDelete(null);
    },
    onError: (e: Error) => { toast.error(e.message || "No se pudo eliminar el registro."); setToDelete(null); },
  });

  const filtered = projects.filter((p) =>
    (filterClient === "all" || p.client_id === filterClient) &&
    (filterStatus === "all" || p.status === filterStatus),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Proyectos</CardTitle>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setEditing(emptyProject)}><Plus className="h-4 w-4 mr-1" />Nuevo proyecto</Button>
            </DialogTrigger>
            <ProjectForm editing={editing} setEditing={setEditing} clients={clients} onSubmit={(p) => save.mutate(p)} saving={save.isPending} />
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(projectStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fin previsto</TableHead>
                  <TableHead className="min-w-[140px]">Avance</TableHead>
                  <TableHead className="text-right">Contratado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin proyectos.</TableCell></TableRow>
                )}
                {filtered.map((p) => {
                  const progress = projectProgress(tasks.filter((t) => t.project_id === p.id));
                  const overdue = isOverdueProject(p);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <Link to="/proyectos/$id" params={{ id: p.id }} className="hover:underline">
                          {p.name}
                          {p.code && <span className="ml-2 text-xs text-muted-foreground">{p.code}</span>}
                        </Link>
                      </TableCell>
                      <TableCell>{clientMap[p.client_id] ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("font-normal", projectStatusVariant[p.status])}>{projectStatusLabel[p.status]}</Badge>
                          {overdue && <Badge variant="destructive" className="font-normal">Atrasado</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(p.planned_end_date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={progress} className="h-2" />
                          <span className="text-xs text-muted-foreground w-10 text-right">{Math.round(progress)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatARS(Number(p.contracted_amount), p.currency)}</TableCell>
                      <TableCell className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Eliminar" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectForm({
  editing, setEditing, clients, onSubmit, saving,
}: {
  editing: Partial<Project> | null;
  setEditing: (p: Partial<Project> | null) => void;
  clients: { id: string; name: string }[];
  onSubmit: (p: Partial<Project>) => void;
  saving: boolean;
}) {
  if (!editing) return null;
  const p = editing;
  const set = <K extends keyof Project>(k: K, v: Project[K] | string | null) => setEditing({ ...p, [k]: v as Project[K] });
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{p.id ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(p); }} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Cliente *">
            <Select value={p.client_id ?? ""} onValueChange={(v) => set("client_id", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Nombre del proyecto *"><Input value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} required /></Field>
          <Field label="Código interno"><Input value={p.code ?? ""} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Estado">
            <Select value={p.status ?? "quoted"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(projectStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Fecha inicio prevista"><Input type="date" value={p.planned_start_date ?? ""} onChange={(e) => set("planned_start_date", e.target.value)} /></Field>
          <Field label="Fecha fin prevista"><Input type="date" value={p.planned_end_date ?? ""} onChange={(e) => set("planned_end_date", e.target.value)} /></Field>
          <Field label="Fecha inicio real"><Input type="date" value={p.actual_start_date ?? ""} onChange={(e) => set("actual_start_date", e.target.value)} /></Field>
          <Field label="Fecha fin real"><Input type="date" value={p.actual_end_date ?? ""} onChange={(e) => set("actual_end_date", e.target.value)} /></Field>
          <Field label="Moneda">
            <Select value={p.currency ?? "ARS"} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(currencyLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Monto presupuestado"><Input type="number" min={0} step="0.01" value={String(p.estimated_amount ?? 0)} onChange={(e) => set("estimated_amount", e.target.value)} /></Field>
          <Field label="Monto contratado"><Input type="number" min={0} step="0.01" value={String(p.contracted_amount ?? 0)} onChange={(e) => set("contracted_amount", e.target.value)} /></Field>
          <Field label="Costo estimado"><Input type="number" min={0} step="0.01" value={String(p.estimated_cost ?? 0)} onChange={(e) => set("estimated_cost", e.target.value)} /></Field>
        </div>
        <Field label="Descripción"><Textarea rows={2} value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Observaciones"><Textarea rows={2} value={p.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
