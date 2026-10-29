import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { Loading } from "./Loading";
import { useSystemStore } from "../stores/systemStore";
import { getErrorMessage } from "../lib/api";

interface RequireSetupProps {
  children: React.ReactNode;
}

type SetupState =
  | { status: "loading" }
  | { status: "initialized" }
  | { status: "notInitialized" }
  | { status: "error"; message?: string };

/**
 * Route guard component.
 * Redirects to /setup only when the backend reports the system is not initialized;
 * when the check itself fails (network/5xx) it shows an error with a retry button.
 */
export function RequireSetup({ children }: RequireSetupProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const checkInitialized = useSystemStore((s) => s.checkInitialized);
  const [state, setState] = useState<SetupState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    checkInitialized().then(
      (initialized) => {
        if (!cancelled) setState({ status: initialized ? "initialized" : "notInitialized" });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: getErrorMessage(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [checkInitialized, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  switch (state.status) {
    case "loading":
      return <Loading fullscreen />;
    case "notInitialized":
      return <Navigate to="/setup" state={{ from: location }} replace />;
    case "error":
      return (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          p="5"
          style={{ minHeight: "100vh", backgroundColor: "var(--gray-2)" }}
        >
          <Icon icon="lucide:cloud-off" width="48" height="48" color="var(--red-9)" />
          <Heading size="4">{t("error.backendUnavailable")}</Heading>
          <Text color="gray" size="2" align="center">
            {t("error.backendUnavailableDesc")}
          </Text>
          {state.message && (
            <Text color="gray" size="1" align="center" className="font-mono">
              {state.message}
            </Text>
          )}
          <Button mt="2" onClick={retry}>
            <Icon icon="lucide:refresh-cw" width="14" height="14" />
            {t("error.tryAgain")}
          </Button>
        </Flex>
      );
    default:
      return <>{children}</>;
  }
}
