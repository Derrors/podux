import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientResponseError } from "pocketbase";
import { ApiError, apiFetch, apiGet, apiPost, isAbortError } from "./api";
import pb from "./pocketbase";

function jsonResponse(status: number, body: unknown, statusText = "") {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  pb.authStore.save("test-token", null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  pb.authStore.clear();
});

describe("api helpers", () => {
  it("sends the bearer token and parses JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await expect(apiGet<{ ok: boolean }>("/api/x")).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("posts a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: "frpc started" }));
    await apiPost("/api/frpc/launch", { id: "abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/frpc/launch");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ id: "abc" }));
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("resolves undefined for an empty 2xx body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiGet("/api/x")).resolves.toBeUndefined();
  });

  it("throws ApiError with the body's error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "frpc is already running" }, "Conflict"));
    const err = await apiPost("/api/frpc/launch", { id: "abc" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: "frpc is already running" });
  });

  it("falls back to the body's message field, then statusText", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: "bad input" }, "Bad Request"));
    await expect(apiGet("/api/x")).rejects.toMatchObject({ status: 400, message: "bad input" });

    fetchMock.mockResolvedValueOnce(
      new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" })
    );
    await expect(apiGet("/api/x")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(apiGet("/api/x")).rejects.toMatchObject({
      status: 500,
      message: "Request failed with status 500",
    });
  });

  it("clears the auth store on 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    expect(pb.authStore.token).toBe("test-token");
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 401 });
    expect(pb.authStore.token).toBe("");
  });

  it("keeps the auth store on other errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(pb.authStore.token).toBe("test-token");
  });

  it("propagates network errors unchanged", async () => {
    const networkError = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(networkError);
    await expect(apiGet("/api/x")).rejects.toBe(networkError);
  });
});

describe("isAbortError", () => {
  it("recognizes fetch and PocketBase aborts only", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new ClientResponseError({ isAbort: true }))).toBe(true);
    expect(isAbortError(new ClientResponseError({ status: 500 }))).toBe(false);
    expect(isAbortError(new ApiError(500, "x"))).toBe(false);
    expect(isAbortError(new Error("x"))).toBe(false);
  });
});
