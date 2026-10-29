import { Theme } from "@radix-ui/themes";
import { Toaster } from "sonner";
import App from "./App.tsx";
import { useTheme } from "./contexts/theme";

export function ThemedApp() {
  const { theme } = useTheme();

  return (
    <Theme appearance={theme} accentColor="indigo" grayColor="slate" radius="large">
      <App />
      <Toaster richColors position="top-center" />
    </Theme>
  );
}
