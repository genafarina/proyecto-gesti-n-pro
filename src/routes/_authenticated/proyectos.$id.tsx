import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExpenseForm } from "./gastos";
import { CollectionForm } from "./cobros";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Pencil, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  formatARS, formatDate, formatPct, projectProgress, totalCollected, totalSpent,
  pendingToCollect, currentResult, currentMarginPct, estimatedMargin, estimatedMarginPct,
  isOverdueProject, isOverdueTask,
} from "@/lib/finance";
import {
  projectStatusLabel, projectStatusVariant, taskStatusLabel, taskPriorityLabel,
  stageStatusLabel, expenseCategoryLabel, paymentMethodLabel,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/proyectos/$id")({
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = Route.useParams();
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: client } = useQuery({
    queryKey: ["project-client", project?.client_id],
    enabled: !!project?.client_id,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("id", project!.client_id).single();
      return data;
    },
  });
  const { data: stages = [] } = useQuery({
    queryKey: ["stages", id],
    queryFn: async () => {
      const { data } = await supabase.from("project_stages").select("*").eq("project_id", id).order("order_index");
      return data ?? [];
    },
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", id],
    queryFn: async () => {
      const { data } = await supabase.from("project_tasks").select("*").eq("project_id", id).order("created_at");
      return data ?? [];
    },
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", id],
    queryFn: async () => {
      const { data } = await supabase.from("project_expenses").select("*").eq("project_id", id).order("expense_date", { ascending: false });
      return data ?? [];
    },
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["collections", id],
    queryFn: async () => {
      const { data } = await supabase.from("project_collections").select("*").eq("project_id", id).order("collection_date", { ascending: false });
      return data ?? [];
    },
  });

  if (!project) return <div className="text-sm text-muted-foreground">Cargando proyecto...</div>;

  const collected = totalCollected(collections);
  const spent = totalSpent(expenses);
  const progress = projectProgress(tasks);
  const contracted = Number(project.contracted_amount);
  const pending = pendingToCollect(contracted, collected);
  const result = currentResult(collected, spent);
  const marginPct = currentMarginPct(collected, spent);
  const estMargin = estimatedMargin(contracted, Number(project.estimated_cost));
  const estMarginPct = estimatedMarginPct(contracted, Number(project.estimated_cost));
  const overdue = isOverdueProject(project);

  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const pendingTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
  const overdueTasks = tasks.filter(isOverdueTask).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link to="/proyectos" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Volver a proyectos
        </Link>
      </div>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{project.name}</h2>
              <div className="text-sm text-muted-foreground mt-1">
                {client?.name ?? "—"} {project.code && <span className="ml-2">· {project.code}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={cn("font-normal", projectStatusVariant[project.status])}>{projectStatusLabel[project.status]}</Badge>
              {overdue && <Badge variant="destructive" className="font-normal">Atrasado</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="resumen">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="etapas">Etapas</TabsTrigger>
          <TabsTrigger value="tareas">Tareas</TabsTrigger>
          <TabsTrigger value="gastos">Gastos</TabsTrigger>
          <TabsTrigger value="cobros">Cobros</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Datos generales</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Data label="Cliente" value={client?.name ?? "—"} />
              <Data label="Estado" value={projectStatusLabel[project.status]} />
              <Data label="Moneda" value={project.currency} />
              <Data label="Código" value={project.code ?? "—"} />
              <Data label="Inicio previsto" value={formatDate(project.planned_start_date)} />
              <Data label="Fin previsto" value={formatDate(project.planned_end_date)} />
              <Data label="Inicio real" value={formatDate(project.actual_start_date)} />
              <Data label="Fin real" value={formatDate(project.actual_end_date)} />
              <Data label="Presupuestado" value={formatARS(Number(project.estimated_amount), project.currency)} />
              <Data label="Contratado" value={formatARS(contracted, project.currency)} />
              <Data label="Costo estimado" value={formatARS(Number(project.estimated_cost), project.currency)} />
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Avance</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3"><Progress value={progress} className="h-2" /><span className="text-sm w-12 text-right">{formatPct(progress)}</span></div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Data label="Tareas totales" value={tasks.length} />
                  <Data label="Terminadas" value={completedTasks} />
                  <Data label="Pendientes" value={pendingTasks} />
                  <Data label="Atrasadas" value={overdueTasks} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Finanzas</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <Data label="Total contratado" value={formatARS(contracted, project.currency)} />
                <Data label="Total cobrado" value={formatARS(collected, project.currency)} />
                <Data label="Total gastado" value={formatARS(spent, project.currency)} />
                <Data label="Pendiente de cobro" value={formatARS(pending, project.currency)} />
                <Data label="Resultado actual" value={formatARS(result, project.currency)} valueClass={result >= 0 ? "text-success" : "text-destructive"} />
                <Data label="Margen actual" value={formatPct(marginPct)} valueClass={marginPct >= 0 ? "text-success" : "text-destructive"} />
                <Data label="Margen estimado" value={formatARS(estMargin, project.currency)} />
                <Data label="Margen estimado %" value={formatPct(estMarginPct)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="etapas" className="mt-4">
          <StagesSection projectId={id} stages={stages} />
        </TabsContent>
        <TabsContent value="tareas" className="mt-4">
          <TasksSection projectId={id} tasks={tasks} stages={stages} />
        </TabsContent>
        <TabsContent value="gastos" className="mt-4">
          <ExpensesSection projectId={id} expenses={expenses} currency={project.currency} />
        </TabsContent>
        <TabsContent value="cobros" className="mt-4">
          <CollectionsSection projectId={id} clientId={project.client_id} collections={collections} currency={project.currency} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Data({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-medium", valueClass)}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

/* ---------- Etapas ---------- */
type Stage = { id: string; project_id: string; name: string; description: string | null; order_index: number; weight_percentage: number | string; status: string };

function StagesSection({ projectId, stages }: { projectId: string; stages: Stage[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Stage> | null>(null);

  const save = useMutation({
    mutationFn: async (s: Partial<Stage>) => {
      if (!s.name?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        project_id: projectId, name: s.name.trim(), description: s.description || null,
        order_index: Number(s.order_index ?? 0), weight_percentage: Number(s.weight_percentage ?? 0),
        status: (s.status ?? "pending"),
      };
      if (s.id) {
        const { error } = await supabase.from("project_stages").update(payload as never).eq("id", s.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_stages").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Etapa guardada"); qc.invalidateQueries({ queryKey: ["stages", projectId] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (sid: string) => { const { error } = await supabase.from("project_stages").delete().eq("id", sid); if (error) throw error; },
    onSuccess: () => { toast.success("Etapa eliminada"); qc.invalidateQueries({ queryKey: ["stages", projectId] }); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Etapas</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm" onClick={() => setEditing({ name: "", order_index: stages.length, status: "pending", weight_percentage: 0 })}><Plus className="h-4 w-4 mr-1" />Nueva etapa</Button></DialogTrigger>
          {editing && (
            <DialogContent>
              <DialogHeader><DialogTitle>{editing.id ? "Editar etapa" : "Nueva etapa"}</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }} className="space-y-3">
                <Field label="Nombre *"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></Field>
                <Field label="Descripción"><Textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Orden"><Input type="number" min={0} value={String(editing.order_index ?? 0)} onChange={(e) => setEditing({ ...editing, order_index: Number(e.target.value) })} /></Field>
                  <Field label="Peso %"><Input type="number" min={0} max={100} step="0.01" value={String(editing.weight_percentage ?? 0)} onChange={(e) => setEditing({ ...editing, weight_percentage: e.target.value })} /></Field>
                  <Field label="Estado">
                    <Select value={editing.status ?? "pending"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(stageStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </div>
                <DialogFooter><Button type="submit" disabled={save.isPending}>Guardar</Button></DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Orden</TableHead><TableHead>Nombre</TableHead><TableHead>Peso %</TableHead><TableHead>Estado</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {stages.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sin etapas.</TableCell></TableRow>}
            {stages.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.order_index}</TableCell>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{Number(s.weight_percentage)}%</TableCell>
                <TableCell><Badge variant="secondary" className="font-normal">{stageStatusLabel[s.status]}</Badge></TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm("¿Eliminar etapa?")) del.mutate(s.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------- Tareas ---------- */
type Task = {
  id: string; project_id: string; stage_id: string | null; name: string; description: string | null;
  status: string; priority: string; progress_percentage: number | string;
  planned_start_date: string | null; planned_end_date: string | null;
  actual_start_date: string | null; actual_end_date: string | null; notes: string | null;
};

function TasksSection({ projectId, tasks, stages }: { projectId: string; tasks: Task[]; stages: Stage[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [filter, setFilter] = useState("all");

  const save = useMutation({
    mutationFn: async (t: Partial<Task>) => {
      if (!t.name?.trim()) throw new Error("El nombre es obligatorio");
      const pct = Number(t.progress_percentage ?? 0);
      if (pct < 0 || pct > 100) throw new Error("Avance entre 0 y 100");
      const payload = {
        project_id: projectId, stage_id: t.stage_id || null, name: t.name.trim(),
        description: t.description || null, status: (t.status ?? "pending"),
        priority: (t.priority ?? "medium"), progress_percentage: pct,
        planned_start_date: t.planned_start_date || null, planned_end_date: t.planned_end_date || null,
        actual_start_date: t.actual_start_date || null, actual_end_date: t.actual_end_date || null,
        notes: t.notes || null,
      };
      if (t.id) { const { error } = await supabase.from("project_tasks").update(payload as never).eq("id", t.id); if (error) throw error; }
      else { const { error } = await supabase.from("project_tasks").insert(payload as never); if (error) throw error; }
    },
    onSuccess: () => { toast.success("Tarea guardada"); qc.invalidateQueries({ queryKey: ["tasks", projectId] }); qc.invalidateQueries({ queryKey: ["all-tasks-progress"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (tid: string) => { const { error } = await supabase.from("project_tasks").delete().eq("id", tid); if (error) throw error; },
    onSuccess: () => { toast.success("Tarea eliminada"); qc.invalidateQueries({ queryKey: ["tasks", projectId] }); qc.invalidateQueries({ queryKey: ["all-tasks-progress"] }); },
  });

  const filtered = tasks.filter((t) => filter === "all" || t.status === filter);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Tareas</CardTitle>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(taskStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild><Button size="sm" onClick={() => setEditing({ name: "", status: "pending", priority: "medium", progress_percentage: 0 })}><Plus className="h-4 w-4 mr-1" />Nueva tarea</Button></DialogTrigger>
            {editing && (
              <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editing.id ? "Editar tarea" : "Nueva tarea"}</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }} className="space-y-3">
                  <Field label="Nombre *"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></Field>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Field label="Etapa">
                      <Select value={editing.stage_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, stage_id: v === "none" ? null : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin etapa</SelectItem>
                          {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Estado">
                      <Select value={editing.status ?? "pending"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(taskStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Prioridad">
                      <Select value={editing.priority ?? "medium"} onValueChange={(v) => setEditing({ ...editing, priority: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(taskPriorityLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Avance %"><Input type="number" min={0} max={100} step="1" value={String(editing.progress_percentage ?? 0)} onChange={(e) => setEditing({ ...editing, progress_percentage: e.target.value })} /></Field>
                    <Field label="Fin previsto"><Input type="date" value={editing.planned_end_date ?? ""} onChange={(e) => setEditing({ ...editing, planned_end_date: e.target.value })} /></Field>
                    <Field label="Fin real"><Input type="date" value={editing.actual_end_date ?? ""} onChange={(e) => setEditing({ ...editing, actual_end_date: e.target.value })} /></Field>
                  </div>
                  <Field label="Descripción"><Textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                  <DialogFooter><Button type="submit" disabled={save.isPending}>Guardar</Button></DialogFooter>
                </form>
              </DialogContent>
            )}
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tarea</TableHead><TableHead>Etapa</TableHead><TableHead>Estado</TableHead>
            <TableHead>Prioridad</TableHead><TableHead>Avance</TableHead><TableHead>Fin previsto</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin tareas.</TableCell></TableRow>}
            {filtered.map((t) => {
              const overdue = isOverdueTask(t);
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{stages.find((s) => s.id === t.stage_id)?.name ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      <Badge variant="secondary" className="font-normal">{taskStatusLabel[t.status]}</Badge>
                      {overdue && <Badge variant="destructive" className="font-normal">Atrasada</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{taskPriorityLabel[t.priority]}</TableCell>
                  <TableCell>{Number(t.progress_percentage)}%</TableCell>
                  <TableCell className={overdue ? "text-destructive" : ""}>{formatDate(t.planned_end_date)}</TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("¿Eliminar tarea?")) del.mutate(t.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------- Gastos ---------- */
type Expense = {
  id: string; project_id: string; expense_date: string; category: string; subcategory: string | null;
  description: string | null; supplier: string | null; amount: number | string;
  payment_method: string; notes: string | null;
};

function ExpensesSection({ projectId, expenses, currency }: { projectId: string; expenses: Expense[]; currency: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const save = useMutation({
    mutationFn: async (x: Partial<Expense>) => {
      const amt = Number(x.amount ?? 0);
      if (amt < 0) throw new Error("Monto inválido");
      const payload = {
        project_id: projectId, expense_date: x.expense_date || new Date().toISOString().slice(0, 10),
        category: (x.category ?? "other"), description: x.description || null,
        supplier: x.supplier || null, amount: amt, payment_method: (x.payment_method ?? "cash"), notes: x.notes || null,
      };
      if (x.id) { const { error } = await supabase.from("project_expenses").update(payload as never).eq("id", x.id); if (error) throw error; }
      else { const { error } = await supabase.from("project_expenses").insert(payload as never); if (error) throw error; }
    },
    onSuccess: () => { toast.success("Gasto guardado"); qc.invalidateQueries({ queryKey: ["expenses", projectId] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["all-expenses"] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = totalSpent(expenses);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Gastos</CardTitle>
          <div className="text-sm text-muted-foreground">Total: {formatARS(total, currency)}</div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm" onClick={() => setEditing({ expense_date: new Date().toISOString().slice(0, 10), category: "materials", payment_method: "cash", amount: 0 })}><Plus className="h-4 w-4 mr-1" />Nuevo gasto</Button></DialogTrigger>
          {editing && (
            <DialogContent>
              <DialogHeader><DialogTitle>{editing.id ? "Editar gasto" : "Nuevo gasto"}</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fecha"><Input type="date" value={editing.expense_date ?? ""} onChange={(e) => setEditing({ ...editing, expense_date: e.target.value })} required /></Field>
                  <Field label="Monto *"><Input type="number" min={0} step="0.01" value={String(editing.amount ?? 0)} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} required /></Field>
                  <Field label="Categoría">
                    <Select value={editing.category ?? "other"} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(expenseCategoryLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Método de pago">
                    <Select value={editing.payment_method ?? "cash"} onValueChange={(v) => setEditing({ ...editing, payment_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(paymentMethodLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Proveedor"><Input value={editing.supplier ?? ""} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} /></Field>
                <Field label="Descripción"><Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                <DialogFooter><Button type="submit" disabled={save.isPending}>Guardar</Button></DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Categoría</TableHead><TableHead>Descripción</TableHead>
            <TableHead>Proveedor</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Monto</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {expenses.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin gastos.</TableCell></TableRow>}
            {expenses.map((x) => (
              <TableRow key={x.id}>
                <TableCell>{formatDate(x.expense_date)}</TableCell>
                <TableCell>{expenseCategoryLabel[x.category]}</TableCell>
                <TableCell>{x.description ?? "—"}</TableCell>
                <TableCell>{x.supplier ?? "—"}</TableCell>
                <TableCell>{paymentMethodLabel[x.payment_method]}</TableCell>
                <TableCell className="text-right">{formatARS(Number(x.amount), currency)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => { setEditing(x); setOpen(true); }}><Pencil className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------- Cobros ---------- */
type Collection = {
  id: string; project_id: string; client_id: string; collection_date: string;
  amount: number | string; payment_method: string; description: string | null; notes: string | null;
};

function CollectionsSection({ projectId, clientId, collections, currency }: { projectId: string; clientId: string; collections: Collection[]; currency: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Collection> | null>(null);
  const save = useMutation({
    mutationFn: async (c: Partial<Collection>) => {
      const amt = Number(c.amount ?? 0);
      if (amt < 0) throw new Error("Monto inválido");
      const payload = {
        project_id: projectId, client_id: clientId, collection_date: c.collection_date || new Date().toISOString().slice(0, 10),
        amount: amt, payment_method: (c.payment_method ?? "bank_transfer"), description: c.description || null, notes: c.notes || null,
      };
      if (c.id) { const { error } = await supabase.from("project_collections").update(payload as never).eq("id", c.id); if (error) throw error; }
      else { const { error } = await supabase.from("project_collections").insert(payload as never); if (error) throw error; }
    },
    onSuccess: () => { toast.success("Cobro guardado"); qc.invalidateQueries({ queryKey: ["collections", projectId] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["all-collections"] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = totalCollected(collections);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Cobros</CardTitle>
          <div className="text-sm text-muted-foreground">Total: {formatARS(total, currency)}</div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm" onClick={() => setEditing({ collection_date: new Date().toISOString().slice(0, 10), payment_method: "bank_transfer", amount: 0 })}><Plus className="h-4 w-4 mr-1" />Nuevo cobro</Button></DialogTrigger>
          {editing && (
            <DialogContent>
              <DialogHeader><DialogTitle>{editing.id ? "Editar cobro" : "Nuevo cobro"}</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fecha"><Input type="date" value={editing.collection_date ?? ""} onChange={(e) => setEditing({ ...editing, collection_date: e.target.value })} required /></Field>
                  <Field label="Monto *"><Input type="number" min={0} step="0.01" value={String(editing.amount ?? 0)} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} required /></Field>
                  <Field label="Método de pago">
                    <Select value={editing.payment_method ?? "bank_transfer"} onValueChange={(v) => setEditing({ ...editing, payment_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(paymentMethodLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Descripción"><Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                <DialogFooter><Button type="submit" disabled={save.isPending}>Guardar</Button></DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Monto</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {collections.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sin cobros.</TableCell></TableRow>}
            {collections.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{formatDate(c.collection_date)}</TableCell>
                <TableCell>{c.description ?? "—"}</TableCell>
                <TableCell>{paymentMethodLabel[c.payment_method]}</TableCell>
                <TableCell className="text-right">{formatARS(Number(c.amount), currency)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
