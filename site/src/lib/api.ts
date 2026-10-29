import { ClientResponseError } from "pocketbase";
import pb from "./pocketbase";
import { handleUnauthorized } from "./auth";

/** Error thrown by the api helpers for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function messageFromBody(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const { error, message } = data as { error?: unknown; message?: unknown };
    if (typeof error === "string" && error) return error;
    if (typeof message === "string" && message) return message;
  }
  return undefined;
}

async function toApiError(response: Response): Promise<ApiError> {
  let data: unknown;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  const message =
    messageFromBody(data) || response.statusText || `Request failed with status ${response.status}`;
  return new ApiError(response.status, message, data);
}

/**
 * Authenticated fetch against the custom `/api/*` endpoints.
 * Resolves with the raw Response (for streaming) and throws ApiError on non-2xx.
 * A 401 also clears the auth store, which sends the user back to the login page.
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (pb.authStore.token) {
    headers.set("Authorization", `Bearer ${pb.authStore.token}`);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw await toApiError(response);
  }
  return response;
}

type RequestOptions = Pick<RequestInit, "signal">;

async function apiJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  return apiJson<T>(url, options);
}

export function apiPost<T = unknown>(
  url: string,
  body: unknown,
  options: RequestOptions = {}
): Promise<T> {
  return apiJson<T>(url, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPut<T = unknown>(
  url: string,
  body: unknown,
  options: RequestOptions = {}
): Promise<T> {
  return apiJson<T>(url, {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** True for aborted fetches and PocketBase SDK requests cancelled via signal/requestKey. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof ClientResponseError) return err.isAbort;
  return err instanceof DOMException && err.name === "AbortError";
}

/** Best-effort human readable message for errors from fetch, the api helpers or the PocketBase SDK. */
export function getErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return undefined;
}
