import "../i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PaginationBar } from "./PaginationBar";
import { pageWindow } from "../lib/pagination";

describe("pageWindow", () => {
  it.each([
    [1, 1, [1]],
    [1, 5, [1, 2, 3, 4, 5]],
    [1, 10, [1, 2, "gap", 10]],
    [3, 10, [1, 2, 3, 4, "gap", 10]],
    [5, 10, [1, "gap", 4, 5, 6, "gap", 10]],
    [8, 10, [1, "gap", 7, 8, 9, 10]],
    [10, 10, [1, "gap", 9, 10]],
    [50, 100, [1, "gap", 49, 50, 51, "gap", 100]],
  ])("page %i of %i", (page, total, expected) => {
    expect(pageWindow(page, total)).toEqual(expected);
  });

  it("never returns more than 2 * siblings + 5 slots", () => {
    for (let total = 1; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        expect(pageWindow(page, total).length).toBeLessThanOrEqual(7);
        expect(pageWindow(page, total, 2).length).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe("PaginationBar", () => {
  afterEach(cleanup);

  it("renders nothing for a single page", () => {
    const { container } = render(<PaginationBar page={1} totalPages={1} onPageChange={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a window of pages with ellipses and keeps the button semantics", () => {
    const onPageChange = vi.fn();
    render(<PaginationBar page={50} totalPages={100} onPageChange={onPageChange} />);
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Previous page",
      "1",
      "49",
      "50",
      "51",
      "100",
      "Next page",
    ]);
    expect(within(nav).getByRole("button", { name: "50" }).getAttribute("aria-current")).toBe(
      "page"
    );
    expect(nav.textContent?.match(/…/g)).toHaveLength(2);

    fireEvent.click(within(nav).getByRole("button", { name: "100" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Next page" }));
    expect(onPageChange.mock.calls).toEqual([[100], [51]]);
  });

  it("disables previous on the first page and next on the last", () => {
    const { rerender } = render(<PaginationBar page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);
    rerender(<PaginationBar page={3} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty("disabled", true);
  });
});
