import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Plus, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { clientStatusLabel } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/clientes")({
  component: ClientesPage,
});

type Client = {
  id: string; name: string; tax_id: string | null; phone: string | null; email: string | null;
  address: string | null; contact_name: string | null; notes: string | null;
  status: "active" | "inactive";
};

const empty: Partial<Client> = { name: "", status: "active" };

function ClientesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Client> | null>(null);
  const [toDelete, setToDelete] = useState<Client | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data as Client[];
    },
  });

  const { data: projectCounts } = useQuery({
    queryKey: ["client-project-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("client_id");
      const counts: Record<string, number> = {};
      (data ?? []).forEach((p) => { counts[p.client_id] = (counts[p.client_id] ?? 0) + 1; });
      return counts;
    },
  });

  const save = useMutation({
    mutationFn: async (c: Partial<Client>) => {
      if (!c.name?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        name: c.name.trim(), tax_id: c.tax_id || null, phone: c.phone || null,
        email: c.email || null, address: c.address || null, contact_name: c.contact_name || null,
        notes: c.notes || null, status: c.status ?? "active",
      };
      if (c.id) {
        const { error } = await supabase.from("clients").update(payload).eq("id", c.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Cliente guardado");
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Clientes</CardTitle>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setEditing(empty)}><Plus className="h-4 w-4 mr-1" /> Nuevo cliente</Button>
            </DialogTrigger>
            <ClientForm editing={editing} setEditing={setEditing} onSubmit={(c) => save.mutate(c)} saving={save.isPending} />
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nombre..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>CUIT / DNI</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Proyectos</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Sin clientes.</TableCell></TableRow>
                )}
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.tax_id ?? "—"}</TableCell>
                    <TableCell>{c.contact_name ?? "—"}</TableCell>
                    <TableCell>{c.phone ?? "—"}</TableCell>
                    <TableCell>{c.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "default" : "secondary"} className="font-normal">
                        {clientStatusLabel[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{projectCounts?.[c.id] ?? 0}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClientForm({
  editing, setEditing, onSubmit, saving,
}: {
  editing: Partial<Client> | null;
  setEditing: (c: Partial<Client> | null) => void;
  onSubmit: (c: Partial<Client>) => void;
  saving: boolean;
}) {
  if (!editing) return null;
  const c = editing;
  const set = (k: keyof Client, v: string) => setEditing({ ...c, [k]: v });
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{c.id ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(c); }} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nombre *"><Input value={c.name ?? ""} onChange={(e) => set("name", e.target.value)} required /></Field>
          <Field label="CUIT / DNI"><Input value={c.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} /></Field>
          <Field label="Contacto principal"><Input value={c.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} /></Field>
          <Field label="Teléfono"><Input value={c.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={c.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Estado">
            <Select value={c.status ?? "active"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Dirección"><Input value={c.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Observaciones"><Textarea rows={3} value={c.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        <DialogFooter>
          <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
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
