# UI Specification

## Technology Stack, Entry Point, and Theme

The application under `site/` uses React 19, TypeScript, Vite 7, Radix Themes, Tailwind CSS 4, Iconify, Framer Motion, Recharts, Sonner and react-i18next. Vue belongs only to the VitePress documentation site. See [site/package.json](../site/package.json) for dependency versions.

[main.tsx](../site/src/main.tsx) loads `styles.radix.css`, `index.css`, i18n and the offline icon bundle. The Radix CSS entry includes the official component/utility styles and only used color scales, checked by [radixStyles.test.ts](../site/src/lib/radixStyles.test.ts). Import `Icon` from `@iconify/react/offline`; never depend on the Iconify API. [ThemedApp.tsx](../site/src/ThemedApp.tsx) sets `accentColor="blue"`, `grayColor="slate"`, `radius="large"`, and wraps application motion with `MotionConfig reducedMotion="user"`.

[ThemeContext.tsx](../site/src/contexts/ThemeContext.tsx) accepts only `light`/`dark` saved values, otherwise follows the system preference. Storage reads/writes are best-effort; a blocked `localStorage` must not prevent rendering or switching themes. Language selection remains in LanguageContext and react-i18next.

## Surfaces, Tokens, and Density

[index.css](../site/src/index.css) imports [styles.console.css](../site/src/styles.console.css), the scoped console stylesheet. It introduces structural variables, not a second brand palette:

| Category | Current contract |
| --- | --- |
| Brand | Radix `--accent-*` / blue (`accentColor="blue"`); solid blue active sidebar pill with `--accent-contrast` text |
| Surfaces | Cool airy canvas (`color-mix` of `--gray-2` and `--blue-2`), pure `--color-panel-solid` sidebar and panels, hairline `--gray-4` borders |
| Status | Green for online/running, red for enabled-but-offline or failed probes, gray for deliberately stopped/disabled or unknown states; always pair color with text/icon |
| Text | Radix `Text`/`Heading` sizes; page headings size 6, sections size 3; long names and endpoints wrap |
| Spacing | Radix scales; 16–32px page gutter (16px on phones), 10–20px grid gaps |
| Structural width | `--console-sidebar-width: 228px` (76px collapsed); `--console-content-width: 1600px`; forms at most 920px |
| Cards | Use Radix surface-card variables for one border, not an extra border stacked over the component pseudo-border; avoid repeated decorative shadows |
| Layering | Sidebar/bottom nav 40, topbar 30, form action dock 10; Radix manages dialog/popover portals |

[StatCard](../site/src/components/StatCard.tsx) uses neutral values, compact semantic icon backgrounds (`--green-a3`, etc.), optional visible subtitles and Skeleton loading. Do not append hex alpha digits to a CSS `var()`. Large standalone figures do not need tabular digits; vertically aligned table values do.

## Application Shell and Navigation

Reuse [MainLayout.tsx](../site/src/layouts/MainLayout.tsx):

- At **1200px and wider**, fixed collapsible sidebar plus sticky utility topbar. Primary navigation is Dashboard/Servers/Proxies/Visitors; tools are Logs/Import; Settings is at the bottom. Sidebar collapse is a per-browser convenience stored as `podux.sidebarCollapsed` with guarded reads/writes.
- At **761–1199px**, compact brand/utility topbar and a second row of primary navigation. Logs and Import remain reachable in the account menu.
- At **760px and below**, compact topbar and four-item bottom navigation with safe-area padding. Content and sticky form actions reserve space above it.
- Layout is viewport-based via [useMediaQuery](../site/src/hooks/useMediaQuery.ts), not user-agent-based. An iPad with a wide viewport must not be forced into phone navigation.
- Navigation uses path-prefix ownership, so server details/forms/logs retain the Servers active state. A skip link targets the semantic `<main>`.
- Account, theme, language, updates and sidebar buttons must be actual keyboard-operable buttons/links with translated accessible names. The account identity is inside the menu, not a wide email competing with page content.

[PageHeader](../site/src/components/PageHeader.tsx) consistently groups page title and actions without header subtitles; the sidebar brand displays only the logo and Podux name without a tagline. On phones, actions move to their own wrapping row. [SectionHeading](../site/src/components/SectionHeading.tsx) uses a quiet accent icon and a semantic section heading, not a gradient block.

## Dashboard and Topology

[DashboardPage.view.tsx](../site/src/pages/Dashboard/DashboardPage.view.tsx) prioritizes the KPI row, **complete topology**, then compact protocol distribution/runtime summary. Creation/import/refresh belong in the page header; do not add a second row of large navigation cards or a 350px uptime tile.

[useDashboard.ts](../site/src/pages/Dashboard/useDashboard.ts) polls statistics and topology independently every 30 seconds, retains prior successful data after errors and reconciles unchanged topology references. Manual refresh starts both requests without coupling their results. Its `statsUpdatedAt`/`topologyUpdatedAt` are **successful page-fetch times**, never monitoring sample times. Empty/unknown metrics use a dash; loading uses skeletons, not convincing zero values.

Today's traffic is explicitly the frps server totals from configured dashboards, with visible in/out values and coverage. It can include proxies belonging to other clients on the same frps; do not imply it equals the sum of Podux-managed proxy nodes. No arbitrary time selector, rolling 24h counter, throughput or edge-volume animation is provided by these APIs.

[TopologyChart.tsx](../site/src/pages/Dashboard/TopologyChart.tsx):

- Always builds all servers, proxies and visitors in stable four-column order. Do not add a display limit, mandatory server selector, default collapsed branches or connection pagination.
- Node dimensions are Internet 128×100, Server 188×108, Proxy/Visitor 184×108 and Local 180×84, with 132px row spacing. Canvas remains 480–900px high with visible-element rendering. Explicit node dimensions and [topologyViewport.ts](../site/src/pages/Dashboard/topologyViewport.ts) compute minimum zoom and viewport bounds from the complete graph and observed pane, with no fixed 0.25 floor that could clip larger graphs. Overview actions use `getViewportForBounds`/`setViewport`, and locate uses `setCenter` from the node's coordinates: neither requires the DOM measurements that off-screen virtualized nodes lack. Inline resizes refit; fullscreen initially fits the complete graph and preserves pan/zoom during polling. Larger installations are a global overview, not a promise that every label stays readable at once.
- The inline header contains the topology title and a single fullscreen icon button, without a resource-count subtitle, visible button text, legend bar or decorative overview badge. The icon retains a translated tooltip and accessible name. Inline graph is read-only: page wheel/touch scrolling is never captured. Fullscreen opens a clean canvas with pan/zoom controls and click-to-highlight chain focus, without a hint subtitle, legend bar, table toggle or node search bar.
- [topologyFocus.ts](../site/src/pages/Dashboard/topologyFocus.ts) highlights a clicked node's ancestors/descendants in linear time **without removing any graph elements**; unrelated siblings are dimmed and clicking the pane or fit-to-view clears the highlight. Polls must not recenter the user's fullscreen viewport.
- A disabled proxy is neutral even when its old `bootStatus` still says online. Stopped servers and local endpoint nodes are neutral; local nodes have no independent health data.
- Lines describe resource relationships with frpc runtime state. They do **not** guarantee public reachability, local-service health or actual packets/traffic. Active edges require the relevant server running and the proxy enabled/online (or visitor enabled).
- Edge animation runs only in fullscreen and is disabled for reduced motion. Closing the fullscreen dialog returns to the complete inline overview.

[ProxyDistribution](../site/src/pages/Dashboard/ProxyDistribution.tsx) uses ranked horizontal bars plus an accessible table and focus/hover tooltip. Keep one hue for this magnitude series; no decorative categorical rainbow or fixed minimum panel height.

## Resource Lists, Filters, and States

The resource patterns live in [ServersPage.view.tsx](../site/src/pages/Servers/ServersPage.view.tsx), [ProxiesPage.view.tsx](../site/src/pages/Proxies/ProxiesPage.view.tsx) and [VisitorsPage.view.tsx](../site/src/pages/Visitors/VisitorsPage.view.tsx):

- Desktop tables; real resource cards at ≤760px. Render the appropriate structure rather than keeping two hidden sets of controls/dialogs mounted.
- Server name/address/port form one identity; proxy protocol joins its name, and public endpoint/local address form one mapping. IPv6 literals are bracketed by [formatEndpoint](../site/src/lib/endpoints.ts).
- Reuse `ResourceListToolbar`, `SearchField`, `RefreshButton`, `PaginationBar` and `ConfirmDeleteDialog`. Secondary/destructive actions use [MoreActions](../site/src/components/MoreActions.tsx), accessible without hover. Filtered zero results offer clearing filters, not first-install creation instructions.
- Proxy batch selection works on the visible page on both desktop and phone, with a visible selection toolbar. Disable competing actions while a batch is executing. Selection belongs to **page + search + filter**, not the whole installation.
- [usePaginatedList](../site/src/hooks/usePaginatedList.ts) owns search debounce, polling, paging, aborts/stale-response handling and mutation guards. Its optional `queryKey` isolates external filters and resets the effective page to 1 immediately; old filtered data must not be treated as matching a new query.
- [proxyFilters.ts](../site/src/pages/Proxies/proxyFilters.ts) and [useProxies.ts](../site/src/pages/Proxies/useProxies.ts) combine server/protocol/state filters with search using safe PocketBase parameters. Filters apply to the **complete collection query**, not only the current page. Invalid protocol/state values are normalized; global statistics remain independent of filtering.

Three separate proxy concepts must stay distinguishable:

| Concept | Component / meaning |
| --- | --- |
| Configuration intent | `ProxyStatusToggle`: enabled/disabled; button can change the desired setting |
| Tunnel runtime | `ProxyRuntimeBadge`: enabled and online, enabled but offline, or deliberately disabled (neutral) |
| Public reachability / traffic | `ProxyHealth`: independent external probe and today's frps traffic |

[ProxyHealth](../site/src/components/ProxyHealth.tsx) continues to accept `probeDisabled` separately from status. True suppresses stale probes and shows a gray disabled badge even with no API data; traffic/connections/history remain available. Missing/false keeps existing behavior. Clicking traffic opens its 7-day chart/table. A missing probe is not proof of failure. Active proxy filters use enabled+online, enabled+not-online, and disabled separately; the neutral “Not online (includes disabled)” global tile is not an outage count.

## Forms and Server Details

Server/proxy/visitor forms remain full pages, not cramped drawers. They use [FormActions](../site/src/components/FormActions.tsx) with a sticky action dock above the mobile bottom bar and enough focus-scroll margin to keep controls usable. Async submission disables duplicate actions. Preserve the existing view/index/hook split and payload semantics.

[AdvancedSection](../site/src/components/AdvancedSection.tsx) is a native disclosure whose children remain mounted, so collapsing does not reset edits. New forms collapse optional configuration; edits open it. Proxy validation errors inside advanced settings open that group. Required server/authentication, proxy/network, external-probe settings and visitor target/listener remain outside optional groups. Never clear hidden values when changing type or opening a section.

The proxy form's translated positive “External reachability probe” switch appears for TCP/HTTP/HTTPS, including supported plugins. `probeEnabled = record.probeDisabled !== true` and `probeDisabled = !probeEnabled` persist for create/edit/clone; hiding it for other types must not reset the value. It has an associated label/description and is independent of frpc `healthCheck` and desired proxy status.

[ServerDetailPage.view.tsx](../site/src/pages/ServerDetail/ServerDetailPage.view.tsx) places probe history and latency side by side on desktop, stacked on phone; its proxy list follows the same endpoint/runtime/configuration pattern as the global list and becomes cards on phone. Live logs use an optional disclosure. Existing API polling/credentials/export behavior is unchanged.

## Settings, Charts, and Accessibility

[SettingsPage.view.tsx](../site/src/pages/Settings/SettingsPage.view.tsx) keeps URL-owned selection; [SettingsPage.css](../site/src/pages/Settings/SettingsPage.css) scopes the 220px section sidebar, which becomes an internally scrolling horizontal row at ≤760px. Content `min-width: 0` keeps wide API tables from widening the page. Avoid global `.nav-item` overrides and `!important`.

- [TrafficDialog](../site/src/components/TrafficDialog.tsx) retains validated fixed series colors `#0090ff`/`#ef5f00`, legend, tooltips and table. Newly added categorical palettes require validation for both theme surfaces and color-vision deficiencies.
- [LatencyChart](../site/src/components/LatencyChart.tsx) retains a non-negative left margin and `YAxis width="auto"`. Check actual SVG tick bounds with 280ms, 1200ms and 12000ms, after refresh, at 320px and desktop in both themes. Preserve normal reveal clipping when motion is enabled.
- `index.css` no longer globally removes Recharts focus outlines; keyboard focus stays visible. Search-clear/copy/theme/language/more-action controls are real buttons. Icon-only controls need translated names and visible focus.
- Use `notifyError`/Sonner for operations. Root [ErrorBoundary](../site/src/components/ErrorBoundary.tsx) handles render/lazy-chunk failures with explicit recovery, never an automatic reload loop. Recoverable data requests report their own failure.
- Short `PageTransition` (0.18s), `PageHeader`/`Reveal` (0.2s) respect reduced motion. Global reduced-motion CSS disables status-dot/spinner loops. A motion `exit` must belong to an inner AnimatePresence, never inadvertently join the page exit.
- All user-facing text goes through `t()` with matched `zh.json`/`en.json` keys. Do not introduce hard-coded fallback text or a new language state.

## Verification and Remaining Debt

Regression tests include [MainLayout.test.tsx](../site/src/layouts/MainLayout.test.tsx), [resourceLists.test.tsx](../site/src/pages/resourceLists.test.tsx), [consoleInteractions.test.tsx](../site/src/components/consoleInteractions.test.tsx), topology/fullscreen/search tests, external-probe persistence tests, filtered-query race tests, icon and locale guards.

For browser acceptance, use isolated mock API fixtures without real tokens, server credentials or production records. Check 320px, 390px, 760/761px, tablet and desktop, both themes/languages, long names/domains, IPv6, empty/error/refresh states, batch selection, dialogs, keyboard access and normal/reduced motion. No horizontal **page** overflow; intentional scrolling inside settings navigation, graph/table or log containers is allowed. Unit tests do not prove rendered geometry or production performance.

Remaining debt: some legacy form labels/error messages and chart motion/accessibility patterns are still page-specific; the root motion setting does not by itself stop every opacity loop or SVG SMIL animation. Do not claim universal reduced-motion compliance without checking those components. High-cardinality topology intentionally prioritizes completeness over fitting legible labels in one small viewport; fullscreen locate/table are the reading paths.
