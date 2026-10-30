import { describe, expect, it } from "vitest";
import { ClientResponseError } from "pocketbase";
import type { TFunction } from "i18next";
import { fieldErrors } from "./fieldErrors";

const t = ((key: string, opts?: { name?: string }) => `${key}:${opts?.name ?? ""}`) as unknown as TFunction;

const pbError = (status: number, data: unknown) =>
  new ClientResponseError({ url: "/api/collections/fh_proxies/records", status, response: { data } });

describe("fieldErrors", () => {
  it("translates conflict codes with the other record's name", () => {
    const err = pbError(400, {
      remotePort: { code: "validation_port_conflict", message: "Remote tcp port 6000 is already used", params: { name: "ssh" } },
      name: { code: "validation_required", message: "Cannot be blank." },
    });
    expect(fieldErrors(err, t)).toEqual({ remotePort: "conflict.port:ssh", name: "Cannot be blank." });
  });

  it("ignores non-validation errors", () => {
    expect(fieldErrors(pbError(500, {}), t)).toEqual({});
    expect(fieldErrors(new Error("x"), t)).toEqual({});
  });
});
