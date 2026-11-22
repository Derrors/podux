import {
  Avatar,
  Box,
  DropdownMenu,
  Flex,
  IconButton,
  Popover,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence } from "framer-motion";
import { Icon } from "@iconify/react/offline";
import pb from "../lib/pocketbase";
import { apiGet } from "../lib/api";
import { logout } from "../lib/auth";
import { isNewerVersion } from "../lib/version";
import { useAuthRecord } from "../hooks/useAuthRecord";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { getGravatarUrl } from "../lib/gravatar";
import { PageTransition } from "../components/PageTransition";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageToggle } from "../components/LanguageToggle";
import logo from "../assets/logo.webp";

const primaryNav = [
  { labelKey: "nav.dashboard", path: "/dashboard", icon: "lucide:layout-dashboard" },
  { labelKey: "nav.servers", path: "/servers", icon: "lucide:server" },
  { labelKey: "nav.proxies", path: "/proxies", icon: "lucide:network" },
  { labelKey: "nav.visitors", path: "/visitors", icon: "lucide:door-open" },
];
const utilityNav = [
  { labelKey: "nav.logs", path: "/logs", icon: "lucide:scroll-text" },
  { labelKey: "nav.import", path: "/import", icon: "lucide:file-input" },
];
const settingsNav = { labelKey: "nav.settings", path: "/settings", icon: "lucide:settings" };
const matchesRoute = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function MainLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 760px)");
  const isWide = useMediaQuery("(min-width: 1200px)");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("podux.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const [appVersion, setAppVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState("");
  const [releaseUrl, setReleaseUrl] = useState("");
  const [releaseBody, setReleaseBody] = useState("");
  const updateAvailable = Boolean(
    appVersion && latestVersion && isNewerVersion(latestVersion, appVersion)
  );
  const currentNav = [...primaryNav, ...utilityNav, settingsNav].find((item) =>
    matchesRoute(pathname, item.path)
  );

  useEffect(() => {
    try {
      localStorage.setItem("podux.sidebarCollapsed", String(collapsed));
    } catch {
      /* Cosmetic preference only. */
    }
  }, [collapsed]);
  useEffect(() => {
    let active = true;
    apiGet<{ version?: string }>("/api/system/version")
      .then((data) => {
        if (active && data?.version) setAppVersion(data.version);
      })
      .catch(() => undefined);
    apiGet<{ tag_name?: string; html_url?: string; body?: string }>("/api/system/latest-version")
      .then((data) => {
        if (!active) return;
        setLatestVersion(data?.tag_name ?? "");
        setReleaseUrl(data?.html_url ?? "");
        setReleaseBody(data?.body ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const user = useAuthRecord();
  const userEmail = user?.email || "";
  const userName = user?.nickname || userEmail;
  const avatarUrl = user?.avatar
    ? pb.files.getURL(user, user.avatar)
    : getGravatarUrl(userEmail, 80);
  const renderNavLink = (item: typeof settingsNav, compact = false) => {
    const active = matchesRoute(pathname, item.path);
    const link = (
      <Link
        key={item.path}
        to={item.path}
        className="console-nav-link"
        aria-current={active ? "page" : undefined}
        aria-label={compact ? t(item.labelKey) : undefined}
      >
        <Icon icon={item.icon} width="19" height="19" aria-hidden="true" />
        {!compact && <span>{t(item.labelKey)}</span>}
      </Link>
    );
    return compact ? (
      <Tooltip key={item.path} content={t(item.labelKey)}>
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  return (
    <div className="console-shell" data-sidebar-collapsed={collapsed} data-wide={isWide}>
      <a href="#main-content" className="console-skip-link">
        {t("nav.skipToContent")}
      </a>
      {isWide && (
        <aside className="console-sidebar" aria-label={t("nav.mainNavigation")}>
          <Link to="/dashboard" className="console-brand" aria-label="Podux">
            <img src={logo} alt="" width="34" height="34" />
            {!collapsed && (
              <Text as="span" size="5" weight="bold">
                Podux
              </Text>
            )}
          </Link>
          <nav className="console-sidebar__primary" aria-label={t("nav.mainNavigation")}>
            {primaryNav.map((item) => renderNavLink(item, collapsed))}
          </nav>
          <nav className="console-sidebar__utilities" aria-label={t("nav.tools")}>
            {!collapsed && (
              <Text size="1" color="gray" className="console-sidebar__label">
                {t("nav.tools")}
              </Text>
            )}
            {utilityNav.map((item) => renderNavLink(item, collapsed))}
          </nav>
          <div className="console-sidebar__bottom">
            {renderNavLink(settingsNav, collapsed)}
            <div className="console-sidebar__meta">
              {!collapsed && (
                <Text size="1" color="gray">
                  {appVersion ? `v${appVersion}` : "Podux"}
                </Text>
              )}
              <Tooltip content={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}>
                <IconButton
                  variant="ghost"
                  color="gray"
                  aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  <Icon
                    icon={collapsed ? "lucide:panel-left-open" : "lucide:panel-left-close"}
                    width="18"
                    height="18"
                  />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </aside>
      )}

      <div className="console-workspace">
        <header className="console-topbar">
          <div className="console-topbar__row">
            {isWide ? (
              <Flex gap="2" align="center" className="min-w-0" aria-label={t("nav.currentPage")}>
                <Icon
                  icon={currentNav?.icon ?? "lucide:layout-dashboard"}
                  width="17"
                  height="17"
                  style={{ color: "var(--gray-11)" }}
                />
                <Text size="2" weight="medium">
                  {t(currentNav?.labelKey ?? "nav.dashboard")}
                </Text>
              </Flex>
            ) : (
              <Link to="/dashboard" className="console-brand console-brand--compact">
                <img src={logo} alt="" width="28" height="28" />
                <Text size="4" weight="bold">
                  Podux
                </Text>
              </Link>
            )}
            <Flex align="center" gap={isMobile ? "2" : "3"} className="console-topbar__controls">
              <ThemeToggle />
              <LanguageToggle />
              {updateAvailable && (
                <Popover.Root>
                  <Popover.Trigger>
                    <IconButton
                      variant="ghost"
                      color="amber"
                      aria-label={t("version.updateAvailable")}
                    >
                      <Icon icon="lucide:circle-arrow-up" width="19" height="19" />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Content maxWidth="320px">
                    <Flex direction="column" gap="3">
                      <Text size="2" weight="bold">
                        {t("version.updateAvailable")}
                      </Text>
                      <Flex justify="between" gap="3">
                        <Text size="1" color="gray">
                          {t("version.current")}
                        </Text>
                        <Text size="1">v{appVersion}</Text>
                      </Flex>
                      <Flex justify="between" gap="3">
                        <Text size="1" color="gray">
                          {t("version.latest")}
                        </Text>
                        <Text size="1">{latestVersion}</Text>
                      </Flex>
                      {releaseBody && (
                        <Box className="console-release-notes">
                          <Text
                            size="1"
                            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                          >
                            {releaseBody}
                          </Text>
                        </Box>
                      )}
                      {releaseUrl && (
                        <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
                          {t("version.updateNow")}
                        </a>
                      )}
                    </Flex>
                  </Popover.Content>
                </Popover.Root>
              )}
              {!isWide && (
                <Tooltip content={t("nav.settings")}>
                  <IconButton asChild variant="ghost" color="gray">
                    <Link to="/settings" aria-label={t("nav.settings")}>
                      <Icon icon="lucide:settings" width="19" height="19" />
                    </Link>
                  </IconButton>
                </Tooltip>
              )}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button
                    className="console-account"
                    type="button"
                    aria-label={t("nav.accountMenu")}
                  >
                    <Avatar
                      size="2"
                      src={avatarUrl}
                      fallback={userName.charAt(0).toUpperCase() || "P"}
                      radius="full"
                    />
                    {!isMobile && <Icon icon="lucide:chevron-down" width="14" height="14" />}
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <div className="console-account__identity">
                    <Text as="div" size="2" weight="medium">
                      {userName}
                    </Text>
                    <Text as="div" size="1" color="gray">
                      {userEmail}
                    </Text>
                  </div>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={() => navigate("/settings?tab=profile")}>
                    <Icon icon="lucide:user" width="16" height="16" />
                    {t("settings.profile")}
                  </DropdownMenu.Item>
                  {!isWide &&
                    utilityNav.map((item) => (
                      <DropdownMenu.Item key={item.path} onSelect={() => navigate(item.path)}>
                        <Icon icon={item.icon} width="16" height="16" />
                        {t(item.labelKey)}
                      </DropdownMenu.Item>
                    ))}
                  <DropdownMenu.Item
                    onSelect={() => window.open("/_/", "_blank", "noopener,noreferrer")}
                  >
                    <Icon icon="lucide:database" width="16" height="16" />
                    {t("nav.pbAdmin")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    color="red"
                    onSelect={() => {
                      logout();
                      navigate("/login", { replace: true });
                    }}
                  >
                    <Icon icon="lucide:log-out" width="16" height="16" />
                    {t("nav.logout")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Flex>
          </div>
          {!isWide && !isMobile && (
            <nav className="console-top-nav" aria-label={t("nav.mainNavigation")}>
              {primaryNav.map((item) => renderNavLink(item))}
            </nav>
          )}
        </header>

        <main id="main-content" tabIndex={-1} className="console-main">
          <div className="console-content">
            <AnimatePresence mode="wait" initial={false}>
              <PageTransition key={pathname}>{children}</PageTransition>
            </AnimatePresence>
          </div>
        </main>
        {!isMobile && (
          <footer className="console-footer">
            <Text size="1" color="gray">
              Podux {appVersion && `v${appVersion}`}
            </Text>
            <a href="https://github.com/Derrors/podux" target="_blank" rel="noopener noreferrer">
              <Icon icon="lucide:github" width="14" height="14" />
              GitHub
            </a>
          </footer>
        )}
      </div>

      {isMobile && (
        <nav className="console-bottom-nav" aria-label={t("nav.mainNavigation")}>
          {primaryNav.map((item) => renderNavLink(item))}
        </nav>
      )}
    </div>
  );
}
