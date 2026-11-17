# Waymark 3.0 refinement: implementation report

This report covers the UI/UX, navigation and platform changes requested in *UpdatesNeeded.docx*.
The `Fixes.docx` that document refers to, with its screenshots, was not supplied. The work follows the written requirements only.

## A. UI improvements

**New shared components** (in `src/components/app/kit.jsx`):

- `Drawer`: a side panel built on `<dialog>`. It opens from the inline-end edge and becomes a full-screen sheet on phones.
- `CompactPageHeader`, `MetricGrid` and `Metric`: compact page headers and summary-metric rows.
- `CollapsiblePanel`: a native `<details>` panel.
- `SearchInput`.
- `usePaged` and `Pager`: pagination.
- `BoundedList`: a scroll region with a maximum height.
- `SectionTabs`: tabs with their panel, keyboard support including RTL arrow keys, and unique ids.
- `StatusPill`.
- `WorkspaceLayout`: main content plus a secondary panel.

**New feature components:**

- `AiLauncher` (contextual AI) and `ReportAction` (report generation).
- `EnabledCapabilities` on the Command Center.
- `WeatherIntelligence`, rewritten as a one-line summary with a details drawer.

**Redesigned pages:**

| Page | Change |
|---|---|
| App shell | Two-level category navigation, a mobile drawer menu, and a slimmer top bar. Read Aloud and Text Size moved to Settings. |
| Command Center | Ask AI, plus an *Enabled capabilities* panel. Integration and AI status are shown separately from feature availability. |
| Supply Chain Map | Compact weather row with a details drawer. Collapsible filters. A larger map. The sidebar has searchable Locations/Routes tabs that replace the raw text list. Selection details include an Ask AI action. |
| Shipments | Clickable status overview, one-row filters, a paginated table with mode and status badges, and a shipment detail drawer. Activity and live aircraft moved to tabs; aircraft data now loads only when its tab is opened. |
| Risk Simulator | A 3-step workflow (Select scenario → Configure details → Review and run), described in detail below the table. |
| AI Agent Hub | Investigation-focused: suggestion cards, a live status panel with a bounded tool timeline, and results in tabs. History and Tool activity sit in a side tab panel. AI model configuration was removed from this page (it is in Settings); the active provider shows as a status pill. `?run=<id>` opens a saved run. |
| Agent Activity | Summary row; tabs for Monitoring, Alerts, Investigations and Tool history; paginated tables; an alert detail drawer. |
| Approvals | Summary metrics, a filterable request list and a decision panel. The detail panel separates the proposed action, reasoning, evidence, message preview and audit trail. Approve/Reject stay pinned for authorized roles. |
| AI Trade Analyst | Three columns at 1280px and wider (context, conversation, impact). On narrower screens the conversation comes first, with Context and Impact in tabs. The conversation scrolls inside a bounded area; the composer stays visible. |
| Inventory & Orders | Summary metrics; tabs for Inventory, Store stock & orders, Customer impact and Product mapping. Searchable, paginated tables; record detail drawer; sample-data labels kept. |
| Financial Intelligence | Summary metrics; tabs for Supplier comparison, Spending analysis, Financial impact, and Mappings & sources. Every figure is labelled *Accounting fact*, *Recorded input* or *Estimate*. |
| Settings | Reorganized into three groups (see section C). |

**Risk Simulator detail:**

- **Step 1:** scenario cards for the 10 scenario types the engine already supports, plus a Custom scenario (your own name, built on one of those supported models).
- **Step 2:** only the fields relevant to the chosen scenario appear. Each value is labelled *From your records*, *Planning default* or *Manual override*.
- **Step 3:** a summary of the inputs, validation errors and missing-information warnings. *Run Simulation* stays disabled until the inputs are valid.
- **Results tabs:** Risk summary, Impact analysis, Alternatives, Detailed evidence and Next steps (save, AI analysis, report).
- **Calculations:** `runScenario`, finance, recommendations and emissions are unchanged. The engine now runs only after you choose *Run Simulation*.
- **Summary band:** the High/Medium/Low band is a display summary of the engine outputs. It is labelled as such and is not a new risk calculation.

## B. Navigation

**Registry:** `src/state/viewPrefs.js` is the single feature list. Each feature has a `group`, and `featureForPath()` maps any URL to its feature.

| Category | Features |
|---|---|
| Main | Command Center |
| Intelligence | AI Agent Hub, AI Trade Analyst, Global Risk Intelligence, Agent Activity, Approvals |
| Solutions | Supply Chain Map, Shipments, Risk Simulator, Canadian Alternatives, Global Alternatives, Sustainability, Reports |
| Business | Integrations, Inventory & Orders, Financial Intelligence |

The brief listed a single "Supplier Alternatives" feature. The app has two pages for this, Canadian Alternatives and Global Alternatives, and both are kept.

**Behaviour:**

- **Active category:** derived from the URL, so deep links, refresh and back/forward all select the right category.
- **Category buttons:** each one opens the last page you used in that category (kept in session storage), or its first enabled page.
- **Stable layout:** the secondary bar has a fixed height. Disabled features are left out, and a category with nothing enabled links to Settings → Features.
- **Phones (below 768px):** a hamburger menu opens a drawer listing every category and its features.
- **Settings:** stays a system control (the gear icon), not a category.
- **Integrations:** `/app/integrations` is now the full Integrations page. It used to redirect into Settings.
- **Disabled features:** opening one by URL shows a notice that links to Settings → Features. Its data is never deleted.

## C. Settings

Settings is now in three groups:

- **Company:** Profile, **Company Branding** (new), **Products** (searchable list with an editor drawer), **Suppliers** (same pattern), Warehouses, Financials.
- **Platform:** **Features** (new), **AI & Models**, **Integrations** (compact status summary), **Email Notifications** (new).
- **Workspace:** **Accessibility & Display**, **Language** (new), Team, Plan, Admin.

**Changes within those tabs:**

- **Features:** grouped by navigation category, with search and a category filter. Each feature card shows its enabled state and plan availability, which comes from the entitlements in `shared/entitlements.js`.
- **AI & Models:** the existing AI preferences, moved out of the Agent Hub. Credentials stay server-side.
- **Integrations:** shows provider, verified status and last sync, with links to the Integrations page. Credential handling is not duplicated here.
- **Read Aloud:** an opt-in floating button on every page, plus a preview in Settings.
- **Text size:** unchanged behaviour, now set only in Settings.
- **Reduce motion:** a new switch, in addition to the operating-system setting.

## D. New functionality

| Item | Status |
|---|---|
| Contextual AI | **Done.** `AiLauncher` uses `/api/agent/run` (streamed) with the provider saved in Settings, or the built-in planner when none is set. Server-side authorization, data-sharing settings, tool limits and approvals all still apply. It is on the Command Center, Map (with or without a selection), Shipments, Shipment details, Risk Simulator results, Global Risk Intelligence, Canadian/Global Alternatives, Inventory & Orders and Financial Intelligence. It is hidden when the AI Agent Hub feature is off. |
| Company branding | **Done.** Server-side per tenant (`server/branding.js`; `GET/PUT /api/branding`, owner/admin only). Logos: PNG/JPEG/WebP only. The browser decodes and re-encodes to at most 512px; the server checks the file signature, size (≤512 KB) and dimensions. SVG is refused. Branding appears in the top bar, reports and emails. |
| Email alerts | **Done (mock-verified).** `server/email.js`: branded HTML template with a plain-text fallback, all dynamic values escaped. Recipient validation with an optional domain allowlist; 24-hour duplicate suppression; hourly rate limit; per-tenant storage. Triggers: new monitoring alerts, finished automated investigations, pending approvals and monitoring failures. Provider adapters exist for Resend, SendGrid and Postmark; the default is a mock outbox. **Live delivery is unverified** because no provider credentials were available. Anonymous demo/local workspaces never send live mail. |
| Report generation | **Done.** `ReportAction` builds a branded jsPDF report (header, footer, logo, page numbers, tables) and a print-ready HTML view that works in all six languages, including RTL. Reports can be saved into the existing Reports history. Available on the Risk Simulator, AI Agent Hub runs, AI Trade Analyst, Inventory & Orders and Financial Intelligence; the existing Reports page PDFs now carry company branding too. The PDF uses built-in Latin fonts, so for Hindi, Arabic and Chinese it is produced in English and the UI points to the print view. |
| Multilingual support | **Partial.** i18next and react-i18next, with six languages (en, hi, ar, zh-CN, es, fr) and English fallback. Translated: navigation, top bar, feature names and descriptions, all Settings structure, the Features/Language tabs, the AI launcher, reports UI, capabilities panel and status labels. Arabic switches the workspace to RTL, and physical CSS classes were converted to logical ones (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`). **Not yet translated:** the body text of individual feature pages (table headers, help copy, engine-generated descriptions), which still appears in English. Business data is deliberately never translated. |

## E. Responsive verification

`e2e/responsive.mjs` (`npm run test:responsive`) opens the Maple Trail demo in headless Edge and visits 17 workspace pages at 375, 430, 768, 1024 and 1440px. It then repeats 4 pages at 375 and 1440px in Arabic, for 93 page/width checks in total. It checks:

- no page errors;
- every page renders its heading;
- no horizontal page overflow;
- a deep link selects the right category;
- the mobile menu lists every category;
- Arabic sets `dir="rtl"` and shows translated navigation.

**Result: all 93 checks pass.** I also looked at screenshots of the Simulator at 1440px and the Arabic Command Center at 375px.

## F. Automated testing

- `npm test`: **226/226 Vitest tests pass** (215 existing plus 11 new in `tests/refinement.test.js` covering the navigation registry, translation key and placeholder coverage, branding validation and tenant isolation, and email rules), plus both script checks (14 and 15 checks).
- `npm run build`: **succeeds.**
- `npm run test:responsive`: **93/93 pass.**
- `npm run test:e2e` (the existing end-to-end suite): see the note in section G.
- There is no lint or type-check configuration in the repository.

## G. Known limitations

- **Feature page body text** is still English in other languages (see section D).
- **PDF reports** in Hindi, Arabic and Chinese come out in English; use the print view for those languages.
- **Live email delivery** has not been tested against a real provider.
- **The Supabase edge function** (`supabase/functions/waymark-api`, used for static-host deployments) does not implement the new branding and email routes. Those need the Node API.
- **Feature toggles** are stored per browser in localStorage, as before. They hide navigation only; the server still enforces plans and roles.
- **The existing end-to-end suite** (`e2e/run.mjs`) was written against the old layout: top-bar Read Aloud and Text Size, the old Settings → Display feature list, the Integrations redirect into Settings, and the old Simulator and Agent Hub. Steps that rely on those will need their selectors updated. Result on this build: 14 steps pass and 33 fail. The failures are locator timeouts (for example the removed `Application` link strip and the old "Waymark Command Center" heading), not page errors; the suite needs its selectors updated to the new layout.

## H. Files changed

**New:**

- `src/i18n/index.js` and `src/i18n/resources/common.js`
- `src/state/branding.js`
- `src/components/app/AiLauncher.jsx`, `ReportAction.jsx` and `EnabledCapabilities.jsx`
- `src/pages/app/settings/` (`FeaturesTab`, `BrandingTab`, `PlatformTabs`, `RecordsTabs`)
- `server/branding.js` and `server/email.js`
- `tests/refinement.test.js`
- `e2e/responsive.mjs`
- this report

**Rewritten or substantially changed:**

- `AppShell.jsx`, `Accessibility.jsx`, `WeatherIntelligence.jsx`, `kit.jsx` (additions), `services/pdf.js`
- `Settings.jsx`, `Overview.jsx`, `MapPage.jsx`, `Shipments.jsx`, `Simulator.jsx`, `Agent.jsx`, `Activity.jsx`, `Approvals.jsx`, `Analyst.jsx`, `Inventory.jsx`, `FinancialIntelligence.jsx`

**Smaller edits:**

- `App.jsx`, `main.jsx`, `viewPrefs.js`, `api.js`, `help/topics.js`, `help/workflows.js`, `index.css`, `ui.jsx` (icons)
- `WorldSituation.jsx`, `Alternatives.jsx`, `Reports.jsx`
- `server/platform.js`, `app.js`, `approvals.js`, `monitor.js`, `config.js`, `shared/integrations.js`
- `.env.example`, `package.json` (adds `i18next` and `react-i18next`)
