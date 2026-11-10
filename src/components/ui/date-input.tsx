import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  calendarDateToIso,
  formatDateInput,
  isoDateToCalendarDate,
  maskDateInput,
  parseDateInput,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "type" | "value"> & {
  value: string | null | undefined;
  onChange: (value: string) => void;
};

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onBlur, className, disabled, ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(() => formatDateInput(value));
    const [calendarOpen, setCalendarOpen] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    React.useEffect(() => {
      setDisplayValue(formatDateInput(value));
    }, [value]);

    const selectedDate = isoDateToCalendarDate(value);

    return (
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <div className="relative w-full">
          <Input
            {...props}
            ref={setInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="DD/MM/AAAA"
            maxLength={10}
            pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
            value={displayValue}
            disabled={disabled}
            className={cn("pr-10", className)}
            onChange={(event) => {
              const nextDisplayValue = maskDateInput(event.target.value);
              const nextIsoValue = parseDateInput(nextDisplayValue);

              setDisplayValue(nextDisplayValue);
              event.currentTarget.setCustomValidity(
                nextDisplayValue && !nextIsoValue
                  ? "Ingresá una fecha válida en formato DD/MM/AAAA."
                  : "",
              );

              if (!nextDisplayValue) onChange("");
              else if (nextIsoValue) onChange(nextIsoValue);
            }}
            onBlur={(event) => {
              const parsedValue = parseDateInput(event.currentTarget.value);
              event.currentTarget.setCustomValidity(
                event.currentTarget.value && !parsedValue
                  ? "Ingresá una fecha válida en formato DD/MM/AAAA."
                  : "",
              );
              onBlur?.(event);
            }}
          />
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Abrir calendario"
              className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0">
          <Calendar
            mode="single"
            locale={es}
            captionLayout="dropdown"
            startMonth={new Date(1900, 0)}
            endMonth={new Date(2100, 11)}
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(date) => {
              if (!date) return;

              const nextIsoValue = calendarDateToIso(date);
              setDisplayValue(formatDateInput(nextIsoValue));
              inputRef.current?.setCustomValidity("");
              onChange(nextIsoValue);
              setCalendarOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    );
  },
);

DateInput.displayName = "DateInput";

export { DateInput };
