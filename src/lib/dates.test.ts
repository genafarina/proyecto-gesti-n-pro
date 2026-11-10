import { describe, expect, test } from "bun:test";

import {
  calendarDateToIso,
  formatDate,
  formatDateInput,
  isoDateToCalendarDate,
  maskDateInput,
  parseDateInput,
  todayIsoDate,
} from "./dates";

describe("calendar dates", () => {
  test("formats ISO dates as DD/MM/YYYY without a time-zone conversion", () => {
    expect(formatDate("2026-10-19")).toBe("19/10/2026");
  });

  test("uses the calendar portion of an ISO timestamp", () => {
    expect(formatDate("2026-10-19T00:00:00.000Z")).toBe("19/10/2026");
  });

  test("accepts manual DD/MM/YYYY input and rejects impossible dates", () => {
    expect(parseDateInput("19/10/2026")).toBe("2026-10-19");
    expect(parseDateInput("31/02/2026")).toBeNull();
  });

  test("masks numeric input using the application format", () => {
    expect(maskDateInput("19102026")).toBe("19/10/2026");
  });

  test("keeps a calendar selection as YYYY-MM-DD and displays DD/MM/YYYY", () => {
    const selectedDate = new Date(2026, 9, 19, 12);
    const isoDate = calendarDateToIso(selectedDate);

    expect(isoDate).toBe("2026-10-19");
    expect(formatDateInput(isoDate)).toBe("19/10/2026");
  });

  test("preserves the selected civil date in the Argentina time zone", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Argentina/Buenos_Aires";

    try {
      const calendarDate = isoDateToCalendarDate("2026-10-19");
      expect(calendarDate?.getFullYear()).toBe(2026);
      expect(calendarDate?.getMonth()).toBe(9);
      expect(calendarDate?.getDate()).toBe(19);
      expect(calendarDate && calendarDateToIso(calendarDate)).toBe("2026-10-19");
    } finally {
      process.env.TZ = previousTimeZone;
    }
  });

  test("builds today's value from local date parts instead of UTC", () => {
    const lateLocalDate = new Date(2026, 9, 19, 23, 30);
    expect(todayIsoDate(lateLocalDate)).toBe("2026-10-19");
  });
});
