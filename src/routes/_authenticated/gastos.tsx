import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatARS, formatDate, totalSpent } from "@/lib/finance";
import { expenseCategoryLabel, paymentMethodLabel } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/gastos")({ component: GastosPage });

function GastosPage() {
  const [proj, setProj] = useState("all");
  const [cat, setCat] = useState("all");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id,name,currency")).data ?? [],
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["all-expenses"],
    queryFn: async () => (await supabase.from("project_expenses").select("*").order("expense_date", { ascending: false })).data ?? [],
  });

  const projMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const filtered = expenses.filter((e) => (proj === "all" || e.project_id === proj) && (cat === "all" || e.category === cat));
  const total = totalSpent(filtered);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gastos</CardTitle>
        <div className="text-sm text-muted-foreground">Total filtrado: {formatARS(total)}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={proj} onValueChange={setProj}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proyectos</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {Object.entries(expenseCategoryLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fecha</TableHead><TableHead>Proyecto</TableHead><TableHead>Categoría</TableHead>
              <TableHead>Descripción</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Monto</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin gastos.</TableCell></TableRow>}
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.expense_date)}</TableCell>
                  <TableCell><Link to="/proyectos/$id" params={{ id: e.project_id }} className="hover:underline">{projMap[e.project_id]?.name ?? "—"}</Link></TableCell>
                  <TableCell>{expenseCategoryLabel[e.category]}</TableCell>
                  <TableCell>{e.description ?? "—"}</TableCell>
                  <TableCell>{paymentMethodLabel[e.payment_method]}</TableCell>
                  <TableCell className="text-right">{formatARS(Number(e.amount), projMap[e.project_id]?.currency ?? "ARS")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
