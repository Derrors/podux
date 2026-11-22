import { Theme } from "@radix-ui/themes";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";
import App from "./App.tsx";
import { useTheme } from "./contexts/theme";

export function ThemedApp() {
  const { theme } = useTheme();

  return (
    <Theme appearance={theme} accentColor="blue" grayColor="slate" radius="large">
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
      <Toaster richColors position="top-center" />
    </Theme>
  );
}
