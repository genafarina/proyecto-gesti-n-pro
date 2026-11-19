import { useId, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearFinancialFilters,
  updateFinancialFilter,
  financialPeriodLabels,
  type FinancialFiltersValue,
} from "@/lib/financialFilters";

export type FinancialFilterField = { key: string; label: string; options: Record<string, string> };
export function FinancialFilterFrame({
  children,
  count,
  onClear,
}: {
  children: ReactNode;
  count: number;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Filtros</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Limpiar filtros
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {count} resultados encontrados
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </CardContent>
    </Card>
  );
}
export function FinancialFilters({
  value,
  onChange,
  fields,
  count,
}: {
  value: FinancialFiltersValue;
  onChange: (value: FinancialFiltersValue) => void;
  fields: FinancialFilterField[];
  count: number;
}) {
  const id = useId();
  const set = (key: string, next: string) => onChange(updateFinancialFilter(value, key, next));
  const select = (
    key: string,
    label: string,
    options: Record<string, string>,
    includeAll = true,
  ) => (
    <div key={key} className="space-y-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor={`${id}-${key}`}>
        {label}
      </Label>
      <Select value={value[key] || "all"} onValueChange={(next) => set(key, next)}>
        <SelectTrigger id={`${id}-${key}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {includeAll && <SelectItem value="all">Todos</SelectItem>}
          {Object.entries(options).map(([option, text]) => (
            <SelectItem key={option} value={option}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <FinancialFilterFrame count={count} onClear={() => onChange(clearFinancialFilters(value))}>
      {select("period", "Período", financialPeriodLabels, false)}
      {value.period === "custom" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor={`${id}-from`}>
              Desde
            </Label>
            <DateInput
              id={`${id}-from`}
              value={value.from}
              onChange={(date) => set("from", date)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor={`${id}-to`}>
              Hasta
            </Label>
            <DateInput id={`${id}-to`} value={value.to} onChange={(date) => set("to", date)} />
          </div>
        </>
      )}
      {fields.map((field) => select(field.key, field.label, field.options))}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor={`${id}-query`}>
          Buscar
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id={`${id}-query`}
            className="pl-9"
            placeholder="Descripción, cliente, proyecto o comprobante"
            value={value.query}
            onChange={(event) => set("query", event.target.value)}
          />
        </div>
      </div>
      {value.period === "custom" && value.from && value.to && value.from > value.to && (
        <p className="text-sm text-destructive" role="alert">
          La fecha desde no puede ser posterior a la fecha hasta.
        </p>
      )}
    </FinancialFilterFrame>
  );
}
