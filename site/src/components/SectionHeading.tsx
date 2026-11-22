import { Icon } from "@iconify/react/offline";
import { Flex, Heading } from "@radix-ui/themes";

interface SectionHeadingProps {
  id: string;
  title: string;
  icon: string;
}

export function SectionHeading({ id, title, icon }: SectionHeadingProps) {
  return (
    <Flex id={id} align="center" gap="2" mb="4" style={{ scrollMarginTop: 88 }}>
      <span className="section-heading__icon" aria-hidden="true">
        <Icon icon={icon} width="17" height="17" />
      </span>
      <Heading as="h2" size="3">
        {title}
      </Heading>
    </Flex>
  );
}
