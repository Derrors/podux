export type PageSlot = number | "gap";

/**
 * Page buttons to render: every page when they fit, otherwise first, last and current
 * ±`siblings` with "gap" for elided runs.
 * A gap never hides a single page (that page is shown instead), so at most
 * `2 * siblings + 5` slots are returned.
 */
export function pageWindow(page: number, totalPages: number, siblings = 1): PageSlot[] {
  if (totalPages <= 2 * siblings + 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages]);
  for (let p = page - siblings; p <= page + siblings; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const slots: PageSlot[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) slots.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) slots.push("gap");
    slots.push(p);
  });
  return slots;
}
