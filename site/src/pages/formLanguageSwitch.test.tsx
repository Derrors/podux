import i18n from "../i18n";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import pb from "../lib/pocketbase";
import { useProxyForm } from "./Proxies/ProxyFormPage/useProxyForm";
import { useServerForm } from "./Servers/ServerFormPage/useServerForm";

/** Renders a hook inside a router at `path` matched by `pattern`. */
function routerWrapper(pattern: string, path: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={children} />
      </Routes>
    </MemoryRouter>
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("form hooks keep unsaved edits when the language changes", () => {
  it("edit server form does not refetch the record", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const getOne = vi.fn().mockResolvedValue({ serverName: "from-server", serverPort: 7000 });
    vi.spyOn(pb, "collection").mockReturnValue({ getOne } as never);

    const { result } = renderHook(() => useServerForm(), {
      wrapper: routerWrapper("/servers/:id/edit", "/servers/s1/edit"),
    });
    await waitFor(() => expect(result.current.loadingServer).toBe(false));
    act(() => result.current.handleChange("serverName", "edited"));

    await act(() => i18n.changeLanguage("zh"));
    expect(getOne).toHaveBeenCalledTimes(1);
    expect(result.current.formData.serverName).toBe("edited");
  });

  it("create proxy form keeps the chosen server", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify([{ id: "s1" }, { id: "s2" }]), { status: 200 })
    );
    const { result } = renderHook(() => useProxyForm(), {
      wrapper: routerWrapper("/proxies/new", "/proxies/new"),
    });
    await waitFor(() => expect(result.current.formData.serverId).toBe("s1"));
    act(() => result.current.handleChange("serverId", "s2"));
    act(() => result.current.handleChange("name", "web"));

    await act(() => i18n.changeLanguage("zh"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.formData).toMatchObject({ serverId: "s2", name: "web" });
  });
});
