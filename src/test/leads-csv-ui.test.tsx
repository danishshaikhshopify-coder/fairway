// React DOM tests for CSV export/import on the Leads page — real page + store;
// sonner and next/link mocked.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: ComponentProps<"a">) =>
      React.createElement("a", { href: String(href), ...rest }, children),
  };
});

import { toast } from "sonner";
import { CrmProvider } from "@/lib/crm-store";
import LeadsPage from "@/app/leads/page";
import { LEAD_CSV_HEADERS } from "@/lib/lead-csv";

function renderPage() {
  return render(
    <CrmProvider>
      <LeadsPage />
    </CrmProvider>,
  );
}

/** Feed a CSV file through the hidden file input the way the browser would. */
function importCsv(csv: string) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File([csv], "leads.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

const HEADER = LEAD_CSV_HEADERS.join(",");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CSV export", () => {
  it("exports every lead as CSV and toasts the count", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    // jsdom does not implement object URLs; stub them to observe the download.
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(toast.success).toHaveBeenCalledWith("12 leads exported to CSV.");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("CSV import", () => {
  it("reports invalid rows with line numbers and imports nothing", async () => {
    renderPage();
    importCsv(
      [HEADER, "Co A,Pat,not-an-email,5000", "Co B,Sam,sam@b.example,-5"].join(
        "\n",
      ),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Import report" }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/2 rows will be skipped/)).toBeTruthy();
    expect(within(dialog).getByText(/Line 2:/)).toBeTruthy();
    expect(within(dialog).getByText(/valid email/)).toBeTruthy();

    // Nothing importable → the import button is disabled.
    const importButton = within(dialog).getByRole("button", {
      name: /Import 0 rows/,
    });
    expect((importButton as HTMLButtonElement).disabled).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("imports valid rows and toasts the partial-failure summary", async () => {
    renderPage();
    const before = screen.getByText(/12 leads/);
    expect(before).toBeTruthy();

    importCsv(
      [
        HEADER,
        "Summit Golf Barn,Rae Kim,rae@summit.example,+1 555 0100,Website,Commercial,42000,77,80,J. Chen,2026-11-30",
        "Broken Co,Nobody,not-an-email,1000",
      ].join("\n"),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 of 2 rows are ready/)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Import 1 row" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(
      "1 lead imported — 1 row skipped (see the import report).",
    );
    // The imported lead is on the list now (13 total).
    expect(screen.getByText(/13 leads/)).toBeTruthy();
  });

  it("rejects a file with the wrong headers fatally (no dialog)", async () => {
    renderPage();
    importCsv("name,email\nNobody,n@x.example");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Missing required column/),
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rejects duplicates against existing leads in the report", async () => {
    renderPage();
    importCsv(
      [
        HEADER,
        "Apex Indoor Golf,Marcus Hale,marcus@apexindoor.example,+1 303 555 0142,Referral,Both,84000,92,91,A. Rivera,2026-10-23",
      ].join("\n"),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 row will be skipped/)).toBeTruthy();
    expect(within(dialog).getByText(/already exists/)).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
