import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatARS, formatDate, totalCollected } from "@/lib/finance";
import { paymentMethodLabel } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/cobros")({ component: CobrosPage });

type Collection = {
  id?: string; project_id: string; client_id: string; collection_date: string;
  amount: number | string; payment_method: string; description: string | null; notes: string | null;
};

function CobrosPage() {
  const qc = useQueryClient();
  const [proj, setProj] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Collection> | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id,name,currency,client_id").order("name")).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id,name").order("name")).data ?? [],
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["all-collections"],
    queryFn: async () => (await supabase.from("project_collections").select("*").order("collection_date", { ascending: false })).data ?? [],
  });

  const projMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["all-collections"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const save = useMutation({
    mutationFn: async (c: Partial<Collection>) => {
      if (!c.project_id) throw new Error("Seleccioná un proyecto");
      if (!c.client_id) throw new Error("El cliente es obligatorio");
      if (!c.collection_date) throw new Error("La fecha es obligatoria");
      if (!c.payment_method) throw new Error("El método de pago es obligatorio");
      const amt = Number(c.amount ?? 0);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Monto inválido");
      const payload = {
        project_id: c.project_id, client_id: c.client_id, collection_date: c.collection_date,
        amount: amt, payment_method: c.payment_method,
        description: c.description || null, notes: c.notes || null,
      };
      if (c.id) {
        const { error } = await supabase.from("project_collections").update(payload as never).eq("id", c.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_collections").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.id ? "Cobro actualizado correctamente." : "Cobro creado correctamente.");
      invalidateAll();
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar el registro."),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_collections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cobro eliminado correctamente."); invalidateAll(); setToDelete(null); },
    onError: (e: Error) => { toast.error(e.message || "No se pudo eliminar el registro."); setToDelete(null); },
  });

  const filtered = collections.filter((c) => proj === "all" || c.project_id === proj);
  const total = totalCollected(filtered);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Cobros</CardTitle>
          <div className="text-sm text-muted-foreground">Total filtrado: {formatARS(total)}</div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => {
              const preProj = proj !== "all" ? projMap[proj] : undefined;
              setEditing({
                collection_date: new Date().toISOString().slice(0, 10),
                payment_method: "bank_transfer", amount: 0,
                project_id: preProj?.id, client_id: preProj?.client_id,
              });
            }}><Plus className="h-4 w-4 mr-1" />Nuevo cobro</Button>
          </DialogTrigger>
          <CollectionForm editing={editing} setEditing={setEditing} projects={projects} onSubmit={(c) => save.mutate(c)} saving={save.isPending} />
        </Dialog>
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
              <TableHead>Método</TableHead><TableHead>Descripción</TableHead>
              <TableHead className="text-right">Monto</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin cobros.</TableCell></TableRow>}
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{formatDate(c.collection_date)}</TableCell>
                  <TableCell><Link to="/proyectos/$id" params={{ id: c.project_id }} className="hover:underline">{projMap[c.project_id]?.name ?? "—"}</Link></TableCell>
                  <TableCell>{clientMap[c.client_id] ?? "—"}</TableCell>
                  <TableCell>{paymentMethodLabel[c.payment_method]}</TableCell>
                  <TableCell>{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatARS(Number(c.amount), projMap[c.project_id]?.currency ?? "ARS")}</TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => { setEditing(c as Collection); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title="Eliminar" onClick={() => setToDelete(c.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cobro</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete)}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function CollectionForm({
  editing, setEditing, projects, onSubmit, saving, lockProject,
}: {
  editing: Partial<Collection> | null;
  setEditing: (c: Partial<Collection> | null) => void;
  projects: { id: string; name: string; client_id: string; currency?: string }[];
  onSubmit: (c: Partial<Collection>) => void;
  saving: boolean;
  lockProject?: boolean;
}) {
  // Auto-fill client when project changes
  useEffect(() => {
    if (!editing?.project_id) return;
    const proj = projects.find((p) => p.id === editing.project_id);
    if (proj && proj.client_id !== editing.client_id) {
      setEditing({ ...editing, client_id: proj.client_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.project_id]);

  if (!editing) return null;
  const c = editing;
  const set = (k: keyof Collection, v: string | null) => setEditing({ ...c, [k]: v });
  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{c.id ? "Editar cobro" : "Nuevo cobro"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(c); }} className="space-y-3">
        {!lockProject && (
          <Field label="Proyecto *">
            <Select value={c.project_id ?? ""} onValueChange={(v) => set("project_id", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar proyecto" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha *"><Input type="date" value={c.collection_date ?? ""} onChange={(e) => set("collection_date", e.target.value)} required /></Field>
          <Field label="Monto *"><Input type="number" min={0} step="0.01" value={String(c.amount ?? 0)} onChange={(e) => set("amount", e.target.value)} required /></Field>
          <Field label="Método de pago *">
            <Select value={c.payment_method ?? "bank_transfer"} onValueChange={(v) => set("payment_method", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(paymentMethodLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Descripción"><Input value={c.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Observaciones"><Textarea rows={2} value={c.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
