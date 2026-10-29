import { TextField } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Search input with a leading search icon and a clear button once it has a value. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className = "min-w-32 flex-1",
}: SearchFieldProps) {
  const { t } = useTranslation();
  return (
    <TextField.Root
      size="2"
      placeholder={placeholder}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <TextField.Slot>
        <Icon icon="lucide:search" width="16" height="16" />
      </TextField.Slot>
      {value && (
        <TextField.Slot
          pr="2"
          role="button"
          aria-label={t("common.clearSearch")}
          onClick={() => onChange("")}
          style={{ cursor: "pointer" }}
        >
          <Icon icon="lucide:x" width="16" height="16" />
        </TextField.Slot>
      )}
    </TextField.Root>
  );
}
