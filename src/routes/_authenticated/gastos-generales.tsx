import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Ban,
  BriefcaseBusiness,
  CircleDollarSign,
  Download,
  Landmark,
  Pencil,
  Plus,
  Search,
  TrendingUp,
  UserRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatARS, formatDate } from "@/lib/finance";
import {
  defaultGeneralExpenseType,
  generalExpenseCategoryLabel,
  generalExpenseStatusLabel,
  generalExpenseStatusVariant,
  generalExpenseTypeLabel,
  paymentMethodLabel,
} from "@/lib/labels";
import {
  filterGeneralExpenses,
  generalExpensesToCsv,
  getTopGeneralExpenseCategory,
  pendingGeneralExpenses,
  totalGeneralExpenses,
  totalGeneralExpensesByCategory,
  totalGeneralExpensesByType,
  type GeneralExpense,
  type GeneralExpenseFilters,
  type PaymentAccount,
} from "@/lib/generalExpenses";

export const Route = createFileRoute("/_authenticated/gastos-generales")({
  component: GeneralExpensesPage,
});

const periodLabel: Record<GeneralExpenseFilters["period"], string> = {
  this_month: "Este mes",
  previous_month: "Mes anterior",
  last_3_months: "Últimos 3 meses",
  this_year: "Este año",
  custom: "Rango personalizado",
  all: "Todos",
};

const chartConfig = {
  amount: {
    label: "Monto",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

const initialFilters: GeneralExpenseFilters = {
  period: "this_month",
  category: "all",
  expenseType: "all",
  status: "all",
  paymentMethod: "all",
  paymentAccountId: "all",
  search: "",
};

function GeneralExpensesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<GeneralExpenseFilters>(initialFilters);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<GeneralExpense> | null>(null);
  const [toCancel, setToCancel] = useState<GeneralExpense | null>(null);

  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ["general-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_expenses")
        .select("*")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data as GeneralExpense[];
    },
  });

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ["payment-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_accounts").select("*").order("name");
      if (error) throw error;
      return data as PaymentAccount[];
    },
  });

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );
  const filtered = useMemo(() => filterGeneralExpenses(expenses, filters), [expenses, filters]);

  const totals = useMemo(() => {
    const topCategory = getTopGeneralExpenseCategory(filtered);
    return {
      total: totalGeneralExpenses(filtered),
      operational: totalGeneralExpensesByType(filtered, "operational"),
      personal: totalGeneralExpensesByType(filtered, "personal"),
      investment: totalGeneralExpensesByType(filtered, "investment"),
      pending: pendingGeneralExpenses(filtered),
      topCategory,
    };
  }, [filtered]);

  const chartData = useMemo(
    () =>
      Object.entries(totalGeneralExpensesByCategory(filtered))
        .map(([category, amount]) => ({
          category,
          label: generalExpenseCategoryLabel[category] ?? category,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount),
    [filtered],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["general-expenses"] });
  };

  const save = useMutation({
    mutationFn: async (expense: Partial<GeneralExpense>) => {
      if (!expense.expense_date) throw new Error("La fecha es obligatoria.");
      if (!expense.category) throw new Error("La categoría es obligatoria.");
      if (!expense.expense_type) throw new Error("El tipo de gasto es obligatorio.");
      if (!expense.status) throw new Error("El estado es obligatorio.");
      if (!expense.description?.trim()) throw new Error("La descripción es obligatoria.");
      if (!expense.payment_method) throw new Error("El método de pago es obligatorio.");
      if (!expense.payment_account_id) throw new Error("La cuenta de pago es obligatoria.");

      const amount = Number(expense.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("El monto debe ser un número igual o mayor a cero.");
      }

      const selectedAccount = accountMap[expense.payment_account_id];
      const payload = {
        expense_date: expense.expense_date,
        category: expense.category,
        expense_type: expense.expense_type,
        status: expense.status,
        payee: expense.payee?.trim() || null,
        description: expense.description.trim(),
        amount,
        payment_method: expense.payment_method,
        payment_account_id: expense.payment_account_id,
        other_payment_account_detail:
          selectedAccount?.type === "other"
            ? expense.other_payment_account_detail?.trim() || null
            : null,
        receipt_url: expense.receipt_url?.trim() || null,
        notes: expense.notes?.trim() || null,
      };

      const result = expense.id
        ? await supabase.from("general_expenses").update(payload).eq("id", expense.id)
        : await supabase.from("general_expenses").insert(payload);
      if (result.error) throw result.error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.id
          ? "Gasto general actualizado correctamente."
          : "Gasto general creado correctamente.",
      );
      invalidate();
      setOpen(false);
      setEditing(null);
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar el gasto."),
  });

  const cancelExpense = useMutation({
    mutationFn: async (expense: GeneralExpense) => {
      const { error } = await supabase
        .from("general_expenses")
        .update({ status: "cancelled" })
        .eq("id", expense.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto general anulado correctamente.");
      invalidate();
      setToCancel(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo anular el gasto.");
      setToCancel(null);
    },
  });

  const updateFilter = <K extends keyof GeneralExpenseFilters>(
    key: K,
    value: GeneralExpenseFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  const startCreate = () => {
    const firstActiveAccount = accounts.find((account) => account.active);
    setEditing({
      expense_date: new Date().toISOString().slice(0, 10),
      category: "other",
      expense_type: "operational",
      status: "paid",
      amount: 0,
      payment_method: "cash",
      payment_account_id: firstActiveAccount?.id,
    });
  };

  const exportCsv = () => {
    if (!filtered.length) {
      toast.error("No hay resultados para exportar.");
      return;
    }

    const csv = generalExpensesToCsv(filtered, accountNames, {
      categories: generalExpenseCategoryLabel,
      types: generalExpenseTypeLabel,
      statuses: generalExpenseStatusLabel,
      paymentMethods: paymentMethodLabel,
    });
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gastos-generales-${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    toast.success("Archivo CSV generado para abrir en Excel.");
  };

  const isLoading = loadingExpenses || loadingAccounts;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Gastos Generales</h2>
          <p className="text-sm text-muted-foreground">
            Gastos operativos, personales e inversiones no asociados a proyectos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            Exportar CSV
          </Button>
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen);
              if (!nextOpen) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" onClick={startCreate}>
                <Plus className="mr-1.5 h-4 w-4" />
                Nuevo gasto
              </Button>
            </DialogTrigger>
            <GeneralExpenseForm
              editing={editing}
              setEditing={setEditing}
              accounts={accounts}
              saving={save.isPending}
              onSubmit={(expense) => save.mutate(expense)}
            />
          </Dialog>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          icon={CircleDollarSign}
          label="Total gastos generales"
          value={formatARS(totals.total)}
          detail={totals.pending > 0 ? `${formatARS(totals.pending)} pendientes` : undefined}
        />
        <KpiCard
          icon={BriefcaseBusiness}
          label="Gastos operativos"
          value={formatARS(totals.operational)}
        />
        <KpiCard icon={UserRound} label="Gastos personales" value={formatARS(totals.personal)} />
        <KpiCard icon={TrendingUp} label="Inversiones" value={formatARS(totals.investment)} />
        <KpiCard
          icon={WalletCards}
          label="Pendiente incluido"
          value={formatARS(totals.pending)}
          tone={totals.pending > 0 ? "warn" : undefined}
        />
        <KpiCard
          icon={Landmark}
          label="Mayor categoría"
          value={
            totals.topCategory
              ? (generalExpenseCategoryLabel[totals.topCategory] ?? totals.topCategory)
              : "Sin datos"
          }
        />
      </section>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Filtros</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setFilters(initialFilters)}>
              Restablecer
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Filter label="Período">
            <Select
              value={filters.period}
              onValueChange={(value) =>
                updateFilter("period", value as GeneralExpenseFilters["period"])
              }
            >
              <SelectTrigger>
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
          </Filter>
          {filters.period === "custom" && (
            <>
              <Filter label="Desde">
                <Input
                  type="date"
                  value={filters.customFrom ?? ""}
                  onChange={(event) => updateFilter("customFrom", event.target.value)}
                />
              </Filter>
              <Filter label="Hasta">
                <Input
                  type="date"
                  value={filters.customTo ?? ""}
                  onChange={(event) => updateFilter("customTo", event.target.value)}
                />
              </Filter>
            </>
          )}
          <Filter label="Categoría">
            <FilterSelect
              value={filters.category}
              allLabel="Todas las categorías"
              options={generalExpenseCategoryLabel}
              onChange={(value) => updateFilter("category", value)}
            />
          </Filter>
          <Filter label="Tipo de gasto">
            <FilterSelect
              value={filters.expenseType}
              allLabel="Todos los tipos"
              options={generalExpenseTypeLabel}
              onChange={(value) => updateFilter("expenseType", value)}
            />
          </Filter>
          <Filter label="Estado">
            <FilterSelect
              value={filters.status}
              allLabel="Todos los estados"
              options={generalExpenseStatusLabel}
              onChange={(value) => updateFilter("status", value)}
            />
          </Filter>
          <Filter label="Método de pago">
            <FilterSelect
              value={filters.paymentMethod}
              allLabel="Todos los métodos"
              options={paymentMethodLabel}
              onChange={(value) => updateFilter("paymentMethod", value)}
            />
          </Filter>
          <Filter label="Cuenta de pago">
            <Select
              value={filters.paymentAccountId}
              onValueChange={(value) => updateFilter("paymentAccountId", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las cuentas</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                    {account.active ? "" : " (inactiva)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Buscar">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Proveedor o descripción"
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
              />
            </div>
          </Filter>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gastos generales por categoría</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
              No hay gastos activos para representar.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[320px] w-full">
              <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat("es-AR", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(value)
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value) => (
                        <div className="flex min-w-[140px] justify-between gap-3">
                          <span className="text-muted-foreground">Monto</span>
                          <span className="font-mono font-medium">{formatARS(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Movimientos{" "}
            <span className="font-normal text-muted-foreground">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Proveedor / destinatario</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    Cargando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No hay gastos para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((expense) => (
                <TableRow
                  key={expense.id}
                  className={cn(expense.status === "cancelled" && "opacity-55")}
                >
                  <TableCell className="whitespace-nowrap">
                    {formatDate(expense.expense_date)}
                  </TableCell>
                  <TableCell>
                    {generalExpenseCategoryLabel[expense.category] ?? expense.category}
                  </TableCell>
                  <TableCell>
                    {generalExpenseTypeLabel[expense.expense_type] ?? expense.expense_type}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "whitespace-nowrap font-normal",
                        generalExpenseStatusVariant[expense.status],
                      )}
                    >
                      {generalExpenseStatusLabel[expense.status] ?? expense.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{expense.payee || "—"}</TableCell>
                  <TableCell className="min-w-[200px]">{expense.description}</TableCell>
                  <TableCell>
                    {accountMap[expense.payment_account_id]?.name ?? "Cuenta no disponible"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium">
                    {formatARS(Number(expense.amount))}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => {
                          setEditing(expense);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {expense.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Anular"
                          onClick={() => setToCancel(expense)}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!toCancel} onOpenChange={(nextOpen) => !nextOpen && setToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular gasto general</AlertDialogTitle>
            <AlertDialogDescription>
              El movimiento seguirá visible como histórico, pero dejará de impactar en KPIs y
              gráficos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toCancel && cancelExpense.mutate(toCancel)}
              disabled={cancelExpense.isPending}
            >
              Anular gasto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GeneralExpenseForm({
  editing,
  setEditing,
  accounts,
  saving,
  onSubmit,
}: {
  editing: Partial<GeneralExpense> | null;
  setEditing: (expense: Partial<GeneralExpense> | null) => void;
  accounts: PaymentAccount[];
  saving: boolean;
  onSubmit: (expense: Partial<GeneralExpense>) => void;
}) {
  if (!editing) return null;

  const expense = editing;
  const selectedAccount = accounts.find((account) => account.id === expense.payment_account_id);
  const availableAccounts = accounts.filter(
    (account) => account.active || account.id === expense.payment_account_id,
  );
  const set = <K extends keyof GeneralExpense>(key: K, value: GeneralExpense[K] | undefined) =>
    setEditing({ ...expense, [key]: value });

  const setCategory = (category: string) => {
    setEditing({
      ...expense,
      category,
      expense_type: defaultGeneralExpenseType[category] ?? "operational",
    });
  };

  const setAccount = (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    setEditing({
      ...expense,
      payment_account_id: accountId,
      other_payment_account_detail:
        account?.type === "other" ? expense.other_payment_account_detail : null,
    });
  };

  return (
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{expense.id ? "Editar gasto general" : "Nuevo gasto general"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(expense);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha *">
            <Input
              type="date"
              required
              value={expense.expense_date ?? ""}
              onChange={(event) => set("expense_date", event.target.value)}
            />
          </Field>
          <Field label="Monto *">
            <Input
              type="number"
              min={0}
              step="0.01"
              required
              value={String(expense.amount ?? 0)}
              onChange={(event) => set("amount", event.target.value)}
            />
          </Field>
          <Field label="Categoría *">
            <Select value={expense.category ?? "other"} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(generalExpenseCategoryLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tipo de gasto *">
            <Select
              value={expense.expense_type ?? "operational"}
              onValueChange={(value) => set("expense_type", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(generalExpenseTypeLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Estado *">
            <Select
              value={expense.status ?? "paid"}
              onValueChange={(value) => set("status", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(generalExpenseStatusLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Método de pago *">
            <Select
              value={expense.payment_method ?? "cash"}
              onValueChange={(value) =>
                set("payment_method", value as GeneralExpense["payment_method"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(paymentMethodLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cuenta de pago *">
            <Select value={expense.payment_account_id ?? ""} onValueChange={setAccount}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cuenta" />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                    {account.active ? "" : " (inactiva)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Proveedor / destinatario">
            <Input
              value={expense.payee ?? ""}
              onChange={(event) => set("payee", event.target.value)}
            />
          </Field>
        </div>

        <Field label="Descripción *">
          <Input
            required
            value={expense.description ?? ""}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        {selectedAccount?.type === "other" && (
          <Field label="Detalle de otra cuenta">
            <Input
              value={expense.other_payment_account_detail ?? ""}
              onChange={(event) => set("other_payment_account_detail", event.target.value)}
              placeholder="Indicá desde dónde se realizó el pago"
            />
          </Field>
        )}

        <Field label="Comprobante (URL)">
          <Input
            type="url"
            value={expense.receipt_url ?? ""}
            onChange={(event) => set("receipt_url", event.target.value)}
            placeholder="https://..."
          />
        </Field>
        <Field label="Observaciones">
          <Textarea
            rows={3}
            value={expense.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>

        <DialogFooter>
          <Button type="submit" disabled={saving || availableAccounts.length === 0}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function FilterSelect({
  value,
  allLabel,
  options,
  onChange,
}: {
  value: string;
  allLabel: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {Object.entries(options).map(([optionValue, label]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
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

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon
            className={cn("h-4 w-4 text-muted-foreground", tone === "warn" && "text-warning")}
          />
        </div>
        <div className="mt-2 text-lg font-semibold tracking-tight">{value}</div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}
