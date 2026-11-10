import * as React from "react";

import { formatDateInput, maskDateInput, parseDateInput } from "@/lib/dates";
import { Input } from "@/components/ui/input";

type DateInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "type" | "value"> & {
  value: string | null | undefined;
  onChange: (value: string) => void;
};

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onBlur, ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(() => formatDateInput(value));

    React.useEffect(() => {
      setDisplayValue(formatDateInput(value));
    }, [value]);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/AAAA"
        maxLength={10}
        pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
        value={displayValue}
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
    );
  },
);

DateInput.displayName = "DateInput";

export { DateInput };
