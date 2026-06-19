import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { paymentAccountTypeLabel } from "@/lib/labels";
import type { PaymentAccount } from "@/lib/generalExpenses";

export const Route = createFileRoute("/_authenticated/configuracion")({
  component: ConfigPage,
});

function ConfigPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<PaymentAccount> | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["payment-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_accounts").select("*").order("name");
      if (error) throw error;
      return data as PaymentAccount[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-accounts"] });
  };

  const save = useMutation({
    mutationFn: async (account: Partial<PaymentAccount>) => {
      if (!account.name?.trim()) throw new Error("El nombre es obligatorio.");
      if (!account.type) throw new Error("El tipo de cuenta es obligatorio.");

      const payload = {
        name: account.name.trim(),
        type: account.type,
        active: account.active ?? true,
        notes: account.notes?.trim() || null,
      };

      const result = account.id
        ? await supabase.from("payment_accounts").update(payload).eq("id", account.id)
        : await supabase.from("payment_accounts").insert(payload);
      if (result.error) throw result.error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.id ? "Cuenta actualizada correctamente." : "Cuenta creada correctamente.",
      );
      invalidate();
      setOpen(false);
      setEditing(null);
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar la cuenta."),
  });

  const toggleActive = useMutation({
    mutationFn: async (account: PaymentAccount) => {
      const { error } = await supabase
        .from("payment_accounts")
        .update({ active: !account.active })
        .eq("id", account.id);
      if (error) throw error;
    },
    onSuccess: (_data, account) => {
      toast.success(account.active ? "Cuenta desactivada." : "Cuenta activada.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo actualizar la cuenta."),
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuración</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Administrá los parámetros generales utilizados por la aplicación.</p>
          <p>
            Los permisos de escritura dependen del rol administrador configurado en la base de
            datos.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Cuentas de pago</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Clasifican desde dónde se paga o cobra. No representan saldos bancarios.
            </p>
          </div>
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen);
              if (!nextOpen) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => setEditing({ name: "", type: "bank", active: true })}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Nueva cuenta
              </Button>
            </DialogTrigger>
            <PaymentAccountForm
              editing={editing}
              setEditing={setEditing}
              saving={save.isPending}
              onSubmit={(account) => save.mutate(account)}
            />
          </Dialog>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Cargando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No hay cuentas configuradas.
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((account) => (
                <TableRow key={account.id} className={account.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>{paymentAccountTypeLabel[account.type] ?? account.type}</TableCell>
                  <TableCell className="max-w-[360px]">{account.notes || "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={account.active}
                      onCheckedChange={() => toggleActive.mutate(account)}
                      disabled={toggleActive.isPending}
                      aria-label={`${account.active ? "Desactivar" : "Activar"} ${account.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar"
                      onClick={() => {
                        setEditing(account);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentAccountForm({
  editing,
  setEditing,
  saving,
  onSubmit,
}: {
  editing: Partial<PaymentAccount> | null;
  setEditing: (account: Partial<PaymentAccount> | null) => void;
  saving: boolean;
  onSubmit: (account: Partial<PaymentAccount>) => void;
}) {
  if (!editing) return null;
  const account = editing;
  const set = <K extends keyof PaymentAccount>(key: K, value: PaymentAccount[K]) =>
    setEditing({ ...account, [key]: value });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{account.id ? "Editar cuenta" : "Nueva cuenta"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(account);
        }}
      >
        <Field label="Nombre *">
          <Input
            required
            value={account.name ?? ""}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <Field label="Tipo *">
          <Select value={account.type ?? "bank"} onValueChange={(value) => set("type", value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(paymentAccountTypeLabel).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Notas">
          <Textarea
            rows={3}
            value={account.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="account-active">Cuenta activa</Label>
            <p className="text-xs text-muted-foreground">
              Solo las cuentas activas aparecen en nuevos gastos.
            </p>
          </div>
          <Switch
            id="account-active"
            checked={account.active ?? true}
            onCheckedChange={(checked) => set("active", checked)}
          />
        </div>
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
