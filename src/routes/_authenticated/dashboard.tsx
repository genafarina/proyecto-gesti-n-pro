import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  formatARS,
  formatPct,
  formatDate,
  totalCollected,
  totalSpent,
  projectProgress,
  currentMarginPct,
  isOverdueProject,
  isOverdueTask,
} from "@/lib/finance";
import { calculateDashboardPeriodSummary, type DashboardPeriod } from "@/lib/dashboardFinance";
import { projectStatusLabel, projectStatusVariant } from "@/lib/labels";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CalendarRange,
  CircleDollarSign,
  Clock,
  FolderKanban,
  Landmark,
  Receipt,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const periodLabel: Record<DashboardPeriod, string> = {
  this_month: "Este mes",
  previous_month: "Mes anterior",
  last_3_months: "Últimos 3 meses",
  this_year: "Este año",
  custom: "Rango personalizado",
  all: "Todos",
};

function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [clients, projects, tasks, expenses, collections, generalExpenses] = await Promise.all([
        supabase.from("clients").select("id,status"),
        supabase
          .from("projects")
          .select(
            "id,code,name,client_id,status,planned_end_date,contracted_amount,estimated_cost,currency",
          ),
        supabase
          .from("project_tasks")
          .select("id,project_id,status,progress_percentage,planned_end_date"),
        supabase.from("project_expenses").select("id,project_id,amount,expense_date"),
        supabase.from("project_collections").select("id,project_id,amount,collection_date"),
        supabase.from("general_expenses").select("id,amount,expense_date,expense_type,status"),
      ]);

      const error =
        clients.error ??
        projects.error ??
        tasks.error ??
        expenses.error ??
        collections.error ??
        generalExpenses.error;
      if (error) throw error;

      return {
        clients: clients.data ?? [],
        projects: projects.data ?? [],
        tasks: tasks.data ?? [],
        expenses: expenses.data ?? [],
        collections: collections.data ?? [],
        generalExpenses: generalExpenses.data ?? [],
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

  const financialSummary = useMemo(
    () =>
      calculateDashboardPeriodSummary(
        data?.collections ?? [],
        data?.expenses ?? [],
        data?.generalExpenses ?? [],
        {
          period,
          customFrom,
          customTo,
        },
      ),
    [customFrom, customTo, data, period],
  );

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Cargando...</div>;

  const activeClients = data.clients.filter((c) => c.status === "active").length;
  const activeProjects = data.projects.filter((p) =>
    ["approved", "in_progress"].includes(p.status),
  );
  const overdueProjects = data.projects.filter(isOverdueProject);

  const pendingTasks = data.tasks.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  ).length;
  const overdueTasks = data.tasks.filter(isOverdueTask).length;

  const avgProgress = activeProjects.length
    ? activeProjects.reduce((s, p) => {
        const projTasks = data.tasks.filter((t) => t.project_id === p.id);
        return s + projectProgress(projTasks);
      }, 0) / activeProjects.length
    : 0;

  const invalidCustomRange =
    period === "custom" && Boolean(customFrom && customTo && customFrom > customTo);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <CalendarRange className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Período del Dashboard</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Este filtro se aplica a todos los indicadores financieros.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-period">Período</Label>
            <Select value={period} onValueChange={(value) => setPeriod(value as DashboardPeriod)}>
              <SelectTrigger id="dashboard-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(periodLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="dashboard-from">Fecha desde</Label>
                <Input
                  id="dashboard-from"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dashboard-to">Fecha hasta</Label>
                <Input
                  id="dashboard-to"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </div>
            </>
          )}
          {invalidCustomRange && (
            <p className="text-sm text-destructive sm:col-span-3">
              La fecha desde no puede ser posterior a la fecha hasta.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Resumen financiero del período</h2>
          <p className="text-sm text-muted-foreground">
            {periodLabel[period]}. Los gastos pendientes están incluidos; los anulados no suman.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <KpiCard
            icon={TrendingUp}
            label="Resultado de proyectos"
            value={formatARS(financialSummary.projectResult)}
            detail="Cobros menos gastos de obra"
            tone={financialSummary.projectResult >= 0 ? "ok" : "warn"}
          />
          <KpiCard
            icon={BriefcaseBusiness}
            label="Resultado operativo"
            value={formatARS(financialSummary.operatingResult)}
            detail="Resultado de proyectos menos gastos operativos"
            tone={financialSummary.operatingResult >= 0 ? "ok" : "warn"}
            highlight
          />
          <KpiCard
            icon={WalletCards}
            label="Resultado final"
            value={formatARS(financialSummary.finalResult)}
            detail="Incluye gastos personales e inversiones"
            tone={financialSummary.finalResult >= 0 ? "ok" : "warn"}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Banknote}
            label="Cobrado de proyectos"
            value={formatARS(financialSummary.totalProjectCollections)}
            tone="ok"
          />
          <KpiCard
            icon={Receipt}
            label="Gastos de obra/proyecto"
            value={formatARS(financialSummary.totalProjectExpenses)}
          />
          <KpiCard
            icon={CircleDollarSign}
            label="Gastos generales totales"
            value={formatARS(financialSummary.totalGeneralExpenses)}
            detail={`${formatARS(financialSummary.pendingGeneralExpenses)} pendientes`}
          />
          <KpiCard
            icon={BriefcaseBusiness}
            label="Gastos generales operativos"
            value={formatARS(financialSummary.generalOperationalExpenses)}
          />
          <KpiCard
            icon={UserRound}
            label="Gastos personales"
            value={formatARS(financialSummary.generalPersonalExpenses)}
          />
          <KpiCard
            icon={Landmark}
            label="Inversiones"
            value={formatARS(financialSummary.generalInvestmentExpenses)}
          />
          <KpiCard
            icon={Clock}
            label="Pendiente incluido"
            value={formatARS(financialSummary.pendingGeneralExpenses)}
            tone={financialSummary.pendingGeneralExpenses > 0 ? "warn" : undefined}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Estado general de proyectos</h2>
          <p className="text-sm text-muted-foreground">
            Indicadores generales no afectados por el filtro financiero.
          </p>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
          <KpiCard icon={Users} label="Clientes activos" value={activeClients.toString()} />
          <KpiCard
            icon={FolderKanban}
            label="Proyectos activos"
            value={activeProjects.length.toString()}
          />
          <KpiCard
            icon={AlertTriangle}
            label="Proyectos atrasados"
            value={overdueProjects.length.toString()}
            tone={overdueProjects.length > 0 ? "warn" : undefined}
          />
          <KpiCard icon={Activity} label="Avance promedio" value={formatPct(avgProgress)} />
          <KpiCard icon={Activity} label="Tareas pendientes" value={pendingTasks.toString()} />
          <KpiCard
            icon={AlertTriangle}
            label="Tareas atrasadas"
            value={overdueTasks.toString()}
            tone={overdueTasks > 0 ? "warn" : undefined}
          />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proyectos en curso</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
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
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-6">
                    No hay proyectos activos.
                  </TableCell>
                </TableRow>
              )}
              {activeProjects.map((p) => {
                const projTasks = data.tasks.filter((t) => t.project_id === p.id);
                const projCol = totalCollected(
                  data.collections.filter((c) => c.project_id === p.id),
                );
                const projExp = totalSpent(data.expenses.filter((e) => e.project_id === p.id));
                const progress = projectProgress(projTasks);
                const overdue = isOverdueProject(p);
                const margin = currentMarginPct(projCol, projExp);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-medium">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      <Link to="/proyectos/$id" params={{ id: p.id }} className="hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{clientMap?.[p.client_id] ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={cn("font-normal", projectStatusVariant[p.status])}>
                        {projectStatusLabel[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className={overdue ? "text-destructive" : ""}>
                      {formatDate(p.planned_end_date)}
                      {overdue && " ⚠"}
                    </TableCell>
                    <TableCell className="text-right">{formatPct(progress)}</TableCell>
                    <TableCell className="text-right">
                      {formatARS(Number(p.contracted_amount), p.currency)}
                    </TableCell>
                    <TableCell className="text-right">{formatARS(projCol, p.currency)}</TableCell>
                    <TableCell className="text-right">{formatARS(projExp, p.currency)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right",
                        margin < 0 && "text-destructive",
                        margin > 0 && "text-success",
                      )}
                    >
                      {formatPct(margin)}
                    </TableCell>
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
  icon: Icon,
  label,
  value,
  detail,
  tone,
  highlight = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  tone?: "ok" | "warn";
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-primary/40 bg-primary/5 shadow-sm")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Icon
            className={cn(
              "h-4 w-4 text-muted-foreground",
              highlight && "text-primary",
              tone === "ok" && "text-success",
              tone === "warn" && "text-destructive",
            )}
          />
        </div>
        <div
          className={cn(
            "mt-2 text-xl font-semibold tracking-tight",
            tone === "ok" && "text-success",
            tone === "warn" && "text-destructive",
          )}
        >
          {value}
        </div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}
