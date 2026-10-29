import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientResponseError } from "pocketbase";
import { toast } from "sonner";
import { ApiError } from "./api";
import { notifyError } from "./notify";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("notifyError", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it("shows the title with the error message as description", () => {
    notifyError("Load failed", new ApiError(500, "boom"), "id-1");
    expect(toast.error).toHaveBeenCalledWith("Load failed", { id: "id-1", description: "boom" });
  });

  it("skips 401 errors from the api helpers and the PocketBase SDK", () => {
    notifyError("Load failed", new ApiError(401, "unauthorized"));
    notifyError("Load failed", new ClientResponseError({ status: 401, response: {} }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("skips aborted requests", () => {
    notifyError("Load failed", new DOMException("aborted", "AbortError"));
    notifyError("Load failed", new ClientResponseError({ isAbort: true }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still reports other client errors", () => {
    notifyError("Save failed", new ClientResponseError({ status: 403, response: {} }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
