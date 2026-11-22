import i18n from "../i18n";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdvancedSection } from "./AdvancedSection";
import { ProxyRuntimeBadge } from "./ProxyRuntimeBadge";
import { CopyableText } from "./CopyableText";
import * as clipboard from "../lib/clipboard";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("console shared interactions", () => {
  it("keeps edits mounted when advanced settings collapse, and opens invalid settings", () => {
    const { rerender } = render(
      <Theme>
        <AdvancedSection title="Advanced" defaultOpen>
          <input aria-label="Value" defaultValue="saved" />
        </AdvancedSection>
      </Theme>
    );
    const input = screen.getByRole("textbox", { name: "Value" });
    fireEvent.change(input, { target: { value: "edited" } });
    const details = screen.getByText("Advanced").closest("details")!;
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(details.open).toBe(false);
    expect(input.isConnected).toBe(true);
    rerender(
      <Theme>
        <AdvancedSection title="Advanced" invalid>
          <input aria-label="Value" defaultValue="saved" />
        </AdvancedSection>
      </Theme>
    );
    expect(details.open).toBe(true);
    expect((screen.getByRole("textbox", { name: "Value" }) as HTMLInputElement).value).toBe(
      "edited"
    );
  });
  it.each(["light", "dark"] as const)(
    "uses a neutral state for intentionally disabled tunnels in %s",
    (appearance) => {
      render(
        <Theme appearance={appearance}>
          <ProxyRuntimeBadge enabled={false} bootStatus="online" />
          <ProxyRuntimeBadge enabled bootStatus="offline" />
        </Theme>
      );
      expect(screen.getByText("Stopped by configuration").getAttribute("data-accent-color")).toBe(
        "gray"
      );
      expect(screen.getByText("Tunnel offline").getAttribute("data-accent-color")).toBe("red");
    }
  );
  it("exposes a keyboard-focusable copy button for the full address", async () => {
    const copy = vi.spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    render(
      <Theme>
        <CopyableText text="[::1]:8080" />
      </Theme>
    );
    const button = screen.getByRole("button", { name: "Copy [::1]:8080" });
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledWith("[::1]:8080");
  });
});
