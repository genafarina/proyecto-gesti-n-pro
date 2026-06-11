import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatARS, formatDate, totalCollected } from "@/lib/finance";
import { paymentMethodLabel } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/cobros")({ component: CobrosPage });

function CobrosPage() {
  const [proj, setProj] = useState("all");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id,name,currency")).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id,name")).data ?? [],
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["all-collections"],
    queryFn: async () => (await supabase.from("project_collections").select("*").order("collection_date", { ascending: false })).data ?? [],
  });

  const projMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);

  const filtered = collections.filter((c) => proj === "all" || c.project_id === proj);
  const total = totalCollected(filtered);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cobros</CardTitle>
        <div className="text-sm text-muted-foreground">Total filtrado: {formatARS(total)}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={proj} onValueChange={setProj}>
          <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proyectos</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fecha</TableHead><TableHead>Proyecto</TableHead><TableHead>Cliente</TableHead>
              <TableHead>Método</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Monto</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin cobros.</TableCell></TableRow>}
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{formatDate(c.collection_date)}</TableCell>
                  <TableCell><Link to="/proyectos/$id" params={{ id: c.project_id }} className="hover:underline">{projMap[c.project_id]?.name ?? "—"}</Link></TableCell>
                  <TableCell>{clientMap[c.client_id] ?? "—"}</TableCell>
                  <TableCell>{paymentMethodLabel[c.payment_method]}</TableCell>
                  <TableCell>{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatARS(Number(c.amount), projMap[c.project_id]?.currency ?? "ARS")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
