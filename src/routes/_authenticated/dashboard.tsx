import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatARS, formatPct, formatDate,
  totalCollected, totalSpent, projectProgress,
  pendingToCollect, currentResult, currentMarginPct,
  isOverdueProject, isOverdueTask,
} from "@/lib/finance";
import { projectStatusLabel, projectStatusVariant } from "@/lib/labels";
import { Users, FolderKanban, AlertTriangle, Banknote, Receipt, Activity, TrendingUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [clients, projects, tasks, expenses, collections] = await Promise.all([
        supabase.from("clients").select("id,status"),
        supabase.from("projects").select("id,name,code,client_id,status,planned_end_date,contracted_amount,estimated_cost,currency"),
        supabase.from("project_tasks").select("id,project_id,status,progress_percentage,planned_end_date"),
        supabase.from("project_expenses").select("id,project_id,amount"),
        supabase.from("project_collections").select("id,project_id,amount"),
      ]);
      return {
        clients: clients.data ?? [],
        projects: projects.data ?? [],
        tasks: tasks.data ?? [],
        expenses: expenses.data ?? [],
        collections: collections.data ?? [],
      };
    },
  });

  const { data: clientMap } = useQuery({
    queryKey: ["client-names"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id,name");
      return Object.fromEntries((data ?? []).map((c) => [c.id, c.name])) as Record<string, string>;
    },
  });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Cargando...</div>;

  const activeClients = data.clients.filter((c) => c.status === "active").length;
  const activeProjects = data.projects.filter((p) => ["approved", "in_progress"].includes(p.status));
  const overdueProjects = data.projects.filter(isOverdueProject);
  const totalContracted = data.projects.reduce((s, p) => s + Number(p.contracted_amount ?? 0), 0);
  const totalCol = totalCollected(data.collections);
  const totalExp = totalSpent(data.expenses);
  const pendingCol = Math.max(totalContracted - totalCol, 0);
  const result = currentResult(totalCol, totalExp);

  const pendingTasks = data.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
  const overdueTasks = data.tasks.filter(isOverdueTask).length;

  const avgProgress = activeProjects.length
    ? activeProjects.reduce((s, p) => {
        const projTasks = data.tasks.filter((t) => t.project_id === p.id);
        return s + projectProgress(projTasks);
      }, 0) / activeProjects.length
    : 0;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Clientes activos" value={activeClients.toString()} />
        <KpiCard icon={FolderKanban} label="Proyectos activos" value={activeProjects.length.toString()} />
        <KpiCard icon={AlertTriangle} label="Proyectos atrasados" value={overdueProjects.length.toString()} tone={overdueProjects.length > 0 ? "warn" : undefined} />
        <KpiCard icon={Activity} label="Avance promedio" value={formatPct(avgProgress)} />
        <KpiCard icon={Banknote} label="Total contratado" value={formatARS(totalContracted)} />
        <KpiCard icon={Banknote} label="Total cobrado" value={formatARS(totalCol)} tone="ok" />
        <KpiCard icon={Receipt} label="Total gastado" value={formatARS(totalExp)} />
        <KpiCard icon={Clock} label="Pendiente de cobro" value={formatARS(pendingCol)} />
        <KpiCard icon={TrendingUp} label="Resultado actual" value={formatARS(result)} tone={result >= 0 ? "ok" : "warn"} />
        <KpiCard icon={Activity} label="Tareas pendientes" value={pendingTasks.toString()} />
        <KpiCard icon={AlertTriangle} label="Tareas atrasadas" value={overdueTasks.toString()} tone={overdueTasks > 0 ? "warn" : undefined} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proyectos en curso</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Código</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fin previsto</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead className="text-right">Contratado</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Gastado</TableHead>
                <TableHead className="text-right">Margen actual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeProjects.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No hay proyectos activos.</TableCell></TableRow>
              )}
              {activeProjects.map((p) => {
                const projTasks = data.tasks.filter((t) => t.project_id === p.id);
                const projCol = totalCollected(data.collections.filter((c) => c.project_id === p.id));
                const projExp = totalSpent(data.expenses.filter((e) => e.project_id === p.id));
                const progress = projectProgress(projTasks);
                const overdue = isOverdueProject(p);
                const margin = currentMarginPct(projCol, projExp);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      <Link to="/proyectos/$id" params={{ id: p.id }} className="hover:underline">{p.name}</Link>
                    </TableCell>
                    <TableCell>{clientMap?.[p.client_id] ?? "—"}</TableCell>
                    <TableCell><Badge className={cn("font-normal", projectStatusVariant[p.status])}>{projectStatusLabel[p.status]}</Badge></TableCell>
                    <TableCell className={overdue ? "text-destructive" : ""}>{formatDate(p.planned_end_date)}{overdue && " ⚠"}</TableCell>
                    <TableCell className="text-right">{formatPct(progress)}</TableCell>
                    <TableCell className="text-right">{formatARS(Number(p.contracted_amount), p.currency)}</TableCell>
                    <TableCell className="text-right">{formatARS(projCol, p.currency)}</TableCell>
                    <TableCell className="text-right">{formatARS(projExp, p.currency)}</TableCell>
                    <TableCell className={cn("text-right", margin < 0 && "text-destructive", margin > 0 && "text-success")}>{formatPct(margin)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Icon className={cn("h-4 w-4 text-muted-foreground", tone === "ok" && "text-success", tone === "warn" && "text-destructive")} />
        </div>
        <div className={cn("mt-2 text-xl font-semibold tracking-tight", tone === "ok" && "text-success", tone === "warn" && "text-destructive")}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
