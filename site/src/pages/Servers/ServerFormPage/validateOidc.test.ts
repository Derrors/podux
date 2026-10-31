import { describe, expect, it } from "vitest";
import { validateOidc, type ServerFormData } from "./useServerForm";

const t = (key: string) => key;
const auth = (patch: Partial<ServerFormData["auth"]>): ServerFormData["auth"] => ({
  method: "oidc",
  token: "",
  oidcClientId: "cid",
  oidcClientSecret: "",
  oidcAudience: "",
  oidcScope: "",
  oidcTokenEndpoint: "https://idp.example.com/token",
  oidcAdditionalParams: {},
  oidcTrustedCa: "",
  oidcInsecureSkipVerify: false,
  additionalScopes: [],
  ...patch,
});

describe("validateOidc", () => {
  it("accepts client ID and an absolute token endpoint", () => {
    expect(validateOidc(auth({}), t)).toEqual({});
    expect(validateOidc(auth({ oidcTokenEndpoint: "http://keycloak:8080/realms/x/token" }), t)).toEqual({});
  });

  it("requires what frp requires", () => {
    expect(validateOidc(auth({ oidcClientId: " ", oidcTokenEndpoint: "" }), t)).toEqual({
      oidcClientId: "server.errorRequired",
      oidcTokenEndpoint: "server.errorRequired",
    });
    expect(validateOidc(auth({ oidcTokenEndpoint: "idp.example.com/token" }), t).oidcTokenEndpoint).toBe(
      "server.errorOidcEndpoint"
    );
  });

  it("rejects parameters frp refuses", () => {
    expect(validateOidc(auth({ oidcAdditionalParams: { scope: "x" } }), t).oidcAdditionalParams).toBe(
      "server.errorOidcParamScope"
    );
    expect(validateOidc(auth({ oidcAdditionalParams: { audience: "x" } }), t)).toEqual({});
    expect(
      validateOidc(auth({ oidcAudience: "aud", oidcAdditionalParams: { audience: "x" } }), t).oidcAdditionalParams
    ).toBe("server.errorOidcParamAudience");
  });
});
