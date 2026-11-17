# Waymark accessibility changes

The app now has saved text sizes (100%, 115%, 130%, 150%), browser read aloud,
and offline guided Help. Controls are in the app top bar; Display settings
also explain accessibility and contain the text-size control.

Text size changes the root font size. A small head script restores the saved
size before rendering. Existing pixel-based app text was converted to rem.
Phone layouts wrap controls and fieldset headers, allow fieldsets to shrink, use single-column metric grids, and keep wide
tables and feature navigation in their own scroll regions. KPI tile markup,
labels, and the Application navigation landmark are preserved.

Read aloud extracts visible headings, labelled figures, definition lists,
alerts/status messages and table rows in document order. Table values include
column labels. Decorative/aria-hidden content and closed disclosures are
excluded. The panel supports sections, Play, Pause/resume, Stop and saved
speed. Navigation, closing and unmounting cancel speech. Only voices marked
as local device voices are used, to avoid sending company text to a voice
service. If no device voice is available, the panel explains this. Browsers
without Web Speech hide the button and show an explanation in Settings.

Help uses hand-written topics, stop-word removal, simple suffix stemming,
domain synonyms, one-edit/transposition typo tolerance, TF-IDF and cosine
similarity. It presents alternatives when scores are close, and a topic
browser when nothing matches. The matcher is a pure function. Topics cover
all nine FEATURES, all nine Settings tabs, Delay Assist, adding shipments,
the dashboard vehicle and the accessibility controls. Tours use data-tour
attributes, navigate between pages, show a spotlight and explanation, support
Back/Next/Finish/Escape, trap keyboard focus, make the background inert, and
restore focus. Hidden/unavailable targets get an explanation. No runtime
dependencies, AI calls, analytics, or external services were added.

## Pages audited

| Page | Review and changes |
| --- | --- |
| Overview / Command Center | Preserved KPI DOM; checked heading order, names and feeds; added sparkline values, stable tour targets, responsive tiles and reduced-motion alert scrolling. Decorative 3D scene remains aria-hidden. |
| Supply Chain Map | Reviewed named filters, marker controls and details headings; added a text disclosure of locations/routes and keyboard access in the SVG fallback. Shared map alternatives also appear in Simulator and sourcing pages. |
| Shipments | Reviewed search/filter labels and edit/delete names; made rows keyboard operable without replacing their accessible cell text; moved aria-sort to table headers; added a shipment tour target. |
| Delay Assist | Reviewed labelled radios, checkboxes, fields, step navigation and outcome tables; added section headings, draft tab panels, a tour target and a keyboard-focusable table scroll region. |
| Risk Simulator | Reviewed input labels, result announcements, chart labels and the response table; added arrow/Home/End tab navigation and linked tab panels, a tour target and a focusable table scroll region. Existing strategy/timeline text alternatives are retained. |
| Canadian Alternatives | Reviewed lead form, comparison and recommendation tables; corrected skipped lead heading levels; fixed the search field minimum width on phones; added a tour target and shared map alternatives. |
| Global Alternatives | Reviewed country toggle names/states, assumptions and comparisons; added a tour target and shared map alternatives. |
| Sustainability | Reviewed labelled filters, chart descriptions and existing View as table disclosures; retained chart/table values and added a documentation tour target. Shared chart text scales in rem. |
| Reports | Reviewed generation/export controls, custom-builder checkboxes, saved-report delete names and table headers; added a tour target and named, keyboard-focusable report table scrolling. |
| AI Trade Analyst | Reviewed the labelled record picker, keyboard alternative to drag/drop, question field, remove buttons, conversation log and textual impact panel; added a context tour target. Existing AI behavior was not changed. |
| World Situation | Reviewed search/filter labels, source links, article headings and textual region counts; added arrow/Home/End category tabs, linked tab panels and a stable tour target. |
| Company Settings (all nine tabs) | Reviewed fields, switches, upload controls, record editors, confirmations and gates. All tabs now deep link and support arrow/Home/End navigation with linked tab panels. Switches have concise accessible names. Display includes accessibility controls/explanations. |

Shared fixes include a Skip to content link, focus moving to the page heading
after lazy route loading, visible focus styles, associated field hints and
errors, live notices, and native-dialog focus restoration. Native showModal
provides focus containment, background exclusion and Escape handling for
existing dialogs, Help search and read aloud. The tour uses its own focus
containment because it must highlight content outside a native modal.

## Verification and limits

- `npm.cmd test`: 167 Vitest tests passed, plus 14 HS chapter checks and 15 trade-news checks. Includes 22 new Help tests for realistic questions, domain synonyms, misspellings, no-match questions, ambiguity, topic coverage and deterministic behavior.
- Production Vite build passed; it still reports large bundle warnings.
- Focused browser run: 5/5 journeys passed (demo setup plus text size, speech and guided Help). It checked all app pages and all nine Settings tabs (20 route states) at 360px and 150%, plus the Add shipment dialog, text persistence, route focus, keyboard shipment details, tab keys, speech controls and narrated table labels, unavailable speech, tour navigation/focus/Escape and hidden-target handling. A dashboard phone screenshot was inspected.
- Final `npm.cmd run test:e2e` against the production build: **43/43 journeys passed**, including all existing workflows and the new accessibility journeys. An earlier run exposed an asynchronous test assertion; the tab-key check now waits for React Router to finish selecting the tab.

No real NVDA, JAWS or VoiceOver session, physical phone, Safari/Firefox session,
or audible OS voice output was available. Speech behavior was exercised with
a deterministic Web Speech stub in Chromium; voice availability/pronunciation
and screen-reader announcements still need human assistive-technology testing.
Authenticated Supabase accounts and every plan/data combination were not
manually verified. This is an accessibility improvement, not a WCAG
conformance certification.

Help matching and tours need no network service. The existing app still needs
its host for the initial load and any uncached lazy route assets; no service
worker or offline app installation was added. Tours explain actions and leave
editing/approval to the user. Device voices may need to be installed in the OS.

## Files

Added: `src/components/app/Accessibility.jsx`, `src/components/map/MapText.jsx`,
`src/help/topics.js`, `src/help/matcher.js`, `tests/help.test.js`, and this report.

Changed: `index.html`, `src/state/viewPrefs.js`, `src/index.css`,
`src/components/app/{AppShell,CommandHero,kit,charts,companyForms,OptionCompare}.jsx`,
`src/components/map/{SupplyMap,SvgMap}.jsx`,
`src/pages/app/{Overview,MapPage,Shipments,DelayResolve,Simulator,Alternatives,Sustainability,Reports,Analyst,WorldSituation,Settings}.jsx`,
and `e2e/run.mjs`. Some files only gained stable tour attributes or rem text sizes.

On this Windows setup PowerShell blocks npm.ps1, so validation used npm.cmd
(the same npm scripts). The existing full e2e suite uses live exchange rates
and needs external network access. `E2E_ONLY=accessibility` optionally selects
the accessibility journeys for focused debugging.
