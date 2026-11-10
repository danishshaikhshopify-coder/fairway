// React DOM tests for /tasks — real page + store, demo-mode mock tasks
// (isolated fixture data; no live Supabase client is ever constructed in
// this environment). Covers the Overdue/Today/Upcoming/Completed/Cancelled
// section grouping added in Phase 4B.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CrmProvider } from "@/lib/crm-store";
import TasksPage from "@/app/tasks/page";
import { todayIso } from "@/lib/format";

function renderPage() {
  return render(
    <CrmProvider>
      <TasksPage />
    </CrmProvider>,
  );
}

function sectionHeading(label: string, count: number) {
  return screen.getByRole("heading", { name: `${label} (${count})` });
}

function addTask(title: string, dueDate: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/title/i), {
    target: { value: title },
  });
  fireEvent.change(within(dialog).getByLabelText(/related to/i), {
    target: { value: "Apex Indoor Golf" },
  });
  fireEvent.change(within(dialog).getByLabelText(/due date/i), {
    target: { value: dueDate },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Tasks page sections", () => {
  it("groups the demo fixture into Overdue and Completed, with no empty sections shown", () => {
    renderPage();
    expect(sectionHeading("Overdue", 8)).toBeTruthy();
    expect(sectionHeading("Completed", 2)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Today /i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Upcoming /i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Cancelled /i })).toBeNull();
  });

  it("a task due today is grouped under Today", () => {
    renderPage();
    addTask("Call back about pricing", todayIso());
    expect(sectionHeading("Today", 1)).toBeTruthy();
    expect(screen.getByText("Call back about pricing")).toBeTruthy();
  });

  it("a task due in the future is grouped under Upcoming", () => {
    renderPage();
    const future = new Date();
    future.setDate(future.getDate() + 5);
    addTask("Prep renewal quote", future.toISOString().slice(0, 10));
    expect(sectionHeading("Upcoming", 1)).toBeTruthy();
  });

  it("cancelling a task moves it out of Overdue and into Cancelled", () => {
    renderPage();
    const title = "Send financing one-pager to Apex Indoor Golf";
    fireEvent.click(screen.getByRole("button", { name: `Cancel "${title}"` }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel task" }));
    expect(sectionHeading("Overdue", 7)).toBeTruthy();
    expect(sectionHeading("Cancelled", 1)).toBeTruthy();
    expect(screen.getByText(/· cancelled/)).toBeTruthy();
  });

  it("completing an overdue task moves it into Completed", () => {
    renderPage();
    const title = "Send financing one-pager to Apex Indoor Golf";
    fireEvent.click(
      screen.getByRole("checkbox", { name: `Mark "${title}" as complete` }),
    );
    expect(sectionHeading("Overdue", 7)).toBeTruthy();
    expect(sectionHeading("Completed", 3)).toBeTruthy();
  });

  it("rescheduling a task to today moves it from Overdue to Today", () => {
    renderPage();
    const title = "Send financing one-pager to Apex Indoor Golf";
    fireEvent.click(screen.getByRole("button", { name: `Reschedule "${title}"` }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New due date"), {
      target: { value: todayIso() },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(sectionHeading("Overdue", 7)).toBeTruthy();
    expect(sectionHeading("Today", 1)).toBeTruthy();
  });

  it("narrowing to a single bucket filter renders a flat list without section headers", () => {
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Filter by due date" }));
    const option = screen.getByRole("option", { name: "Overdue" });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(screen.queryByRole("heading", { name: /^Overdue /i })).toBeNull();
    expect(
      screen.getByText("Send financing one-pager to Apex Indoor Golf"),
    ).toBeTruthy();
  });
});
