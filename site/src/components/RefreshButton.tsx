import { Button } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";

interface RefreshButtonProps {
  onClick: () => void;
  refreshing: boolean;
  label: string;
  size?: "1" | "2";
}

/** Soft refresh button whose icon spins (and which is disabled) while refreshing. */
export function RefreshButton({ onClick, refreshing, label, size = "2" }: RefreshButtonProps) {
  return (
    <Button size={size} variant="soft" onClick={onClick} disabled={refreshing}>
      <Icon
        icon="lucide:refresh-cw"
        width="14"
        height="14"
        className={refreshing ? "animate-spin" : ""}
      />
      {label}
    </Button>
  );
}
