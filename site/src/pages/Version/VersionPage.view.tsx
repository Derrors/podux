import { useTranslation } from "react-i18next";
import {
  Box,
  Card,
  Flex,
  Heading,
  Text,
  Badge,
  Button,
  Spinner,
  Callout,
  Table,
} from "@radix-ui/themes";
// import { MainLayout } from "../../layouts/MainLayout";
import type { GithubRelease } from "./useVersion";

interface VersionViewProps {
  releases: GithubRelease[];
  loading: boolean;
  error: string | null;
}

export function VersionView({ releases, loading, error }: VersionViewProps) {
  const { t } = useTranslation();
  return (
    <>
      <Flex direction="column" gap="5">
        <Flex justify="between" align="center">
          <Box>
            <Heading size="6">{t("version.frpVersions")}</Heading>
            <Text color="gray" size="2">
              {t("version.frpReleasesDesc")}
            </Text>
          </Box>
          {loading && <Spinner />}
        </Flex>

        {error && (
          <Callout.Root color="red">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        {!loading && !error && releases.length > 0 && (
          <Card>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>{t("version.columnVersion")}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>{t("version.columnReleaseDate")}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>{t("version.columnDownload")}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>GitHub</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {releases.map((release) => (
                  <Table.Row key={release.tag_name} align="center">
                    <Table.Cell>
                      <Badge variant="surface" size="2">
                        {release.tag_name}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{new Date(release.published_at).toLocaleDateString()}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      {release.download_url ? (
                        <Button
                          variant="soft"
                          size="1"
                          onClick={() => window.open(release.download_url)}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          {t("version.downloadCurrentArch")}
                        </Button>
                      ) : (
                        <Text size="1" color="gray">
                          {t("version.notFound")}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="1"
                        onClick={() => window.open(release.html_url)}
                      >
                        {t("version.viewOnGithub")}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card>
        )}

        {!loading && !error && releases.length === 0 && (
          <Text align="center" color="gray">
            {t("version.noReleases")}
          </Text>
        )}
      </Flex>
    </>
  );
}
