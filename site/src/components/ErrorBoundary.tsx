import { Component, type ReactNode } from "react";
import { Button, Card, Flex, Heading, Text, Theme } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

interface ErrorBoundaryProps {
  children: ReactNode;
  className?: string;
}

interface ErrorBoundaryState {
  failed: boolean;
  chunkFailed: boolean;
}

// Fallback cannot depend on ThemeProvider: the root boundary also protects providers.
function fallbackAppearance(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* Storage may be blocked. */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The class boundary owns this fallback; it intentionally resets on a full remount.
// eslint-disable-next-line react-refresh/only-export-components
function ErrorFallback({
  chunkFailed,
  retry,
  className,
}: {
  chunkFailed: boolean;
  retry: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Theme appearance={fallbackAppearance()} accentColor="indigo" grayColor="slate" radius="large">
      <Flex
        className={className}
        align="center"
        justify="center"
        p="4"
        style={{ minHeight: "100dvh" }}
      >
        <Card size="3" style={{ width: "100%", maxWidth: 480 }}>
          <Flex direction="column" gap="4" role="alert">
            <Heading as="h1" size="5">
              {t("errorBoundary.title")}
            </Heading>
            <Text as="p" color="gray">
              {t(chunkFailed ? "errorBoundary.chunkDescription" : "errorBoundary.description")}
            </Text>
            <Text as="p" size="2" color="gray">
              {t("errorBoundary.unsaved")}
            </Text>
            <Flex gap="3" wrap="wrap">
              {/* Native module errors and Vite's failed CSS preload cache survive a
                  React remount. Only a user-requested document reload clears both. */}
              {!chunkFailed && <Button onClick={retry}>{t("errorBoundary.retry")}</Button>}
              <Button variant="soft" onClick={() => window.location.reload()}>
                {t("errorBoundary.reload")}
              </Button>
            </Flex>
          </Flex>
        </Card>
      </Flex>
    </Theme>
  );
}

/** No automatic reloads: an offline client or broken deployment must not loop. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, chunkFailed: false };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    const message = error instanceof Error ? error.message : "";
    const chunkFailed =
      /loading chunk|dynamically imported module|module script|importing a module|preload css/i.test(
        message
      );
    // Do not overwrite a Vite event's classification with a secondary lazy error.
    return { failed: true, ...(chunkFailed ? { chunkFailed: true } : {}) };
  }

  private onPreloadError = (event: Event) => {
    // Vite dispatches this for missing JS and CSS chunks after a deployment.
    event.preventDefault();
    this.setState({ failed: true, chunkFailed: true });
  };

  componentDidMount() {
    window.addEventListener("vite:preloadError", this.onPreloadError);
  }

  componentWillUnmount() {
    window.removeEventListener("vite:preloadError", this.onPreloadError);
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorFallback
          className={this.props.className}
          chunkFailed={this.state.chunkFailed}
          retry={() => this.setState({ failed: false, chunkFailed: false })}
        />
      );
    }
    return this.props.children;
  }
}
