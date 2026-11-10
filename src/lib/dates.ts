const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const isValidDateParts = (year: number, month: number, day: number) => {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
};

/**
 * Formats a calendar date without converting it through a time zone.
 * Supabase `date` columns arrive as YYYY-MM-DD and represent a civil date,
 * not an instant in UTC.
 */
export const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";

  const isoDate = value.slice(0, 10);
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) return "—";

  const [, year, month, day] = match;
  if (!isValidDateParts(Number(year), Number(month), Number(day))) return "—";

  return `${day}/${month}/${year}`;
};

export const formatDateInput = (value: string | null | undefined) =>
  value ? formatDate(value).replace("—", "") : "";

/** Converts DD/MM/YYYY user input to the YYYY-MM-DD value stored by date columns. */
export const parseDateInput = (value: string) => {
  const match = DISPLAY_DATE_PATTERN.exec(value);
  if (!match) return null;

  const [, day, month, year] = match;
  if (!isValidDateParts(Number(year), Number(month), Number(day))) return null;

  return `${year}-${month}-${day}`;
};

export const maskDateInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** Converts a date selected in the calendar to a civil ISO date using local parts only. */
export const calendarDateToIso = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Converts a civil ISO date to the local Date object required by the calendar widget. */
export const isoDateToCalendarDate = (value: string | null | undefined) => {
  if (!value) return undefined;

  const match = ISO_DATE_PATTERN.exec(value.slice(0, 10));
  if (!match) return undefined;

  const [, year, month, day] = match;
  if (!isValidDateParts(Number(year), Number(month), Number(day))) return undefined;

  return new Date(Number(year), Number(month) - 1, Number(day), 12);
};

/** Returns today's local calendar date without a UTC conversion. */
export const todayIsoDate = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
