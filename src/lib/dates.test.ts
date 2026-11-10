import { describe, expect, test } from "bun:test";

import { formatDate, maskDateInput, parseDateInput, todayIsoDate } from "./dates";

describe("calendar dates", () => {
  test("formats ISO dates as DD/MM/YYYY without a time-zone conversion", () => {
    expect(formatDate("2026-10-19")).toBe("19/10/2026");
  });

  test("uses the calendar portion of an ISO timestamp", () => {
    expect(formatDate("2026-10-19T00:00:00.000Z")).toBe("19/10/2026");
  });

  test("parses valid display dates and rejects impossible dates", () => {
    expect(parseDateInput("19/10/2026")).toBe("2026-10-19");
    expect(parseDateInput("31/02/2026")).toBeNull();
  });

  test("masks numeric input using the application format", () => {
    expect(maskDateInput("19102026")).toBe("19/10/2026");
  });

  test("builds today's value from local date parts instead of UTC", () => {
    const lateLocalDate = new Date(2026, 9, 19, 23, 30);
    expect(todayIsoDate(lateLocalDate)).toBe("2026-10-19");
  });
});
