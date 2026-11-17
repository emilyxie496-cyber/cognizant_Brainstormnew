# Waymark 3.0 integrations

Open **Settings → Integrations** to manage providers. The grouped catalogue lives at `/app/settings?tab=integrations`; it is no longer a Command Center feature tile or primary navigation item. Existing `/app/integrations` links and OAuth callbacks redirect to this Settings tab.

All external credentials are submitted to Express and encrypted server-side. Never prefix a secret with `VITE_`. A catalogue listing is not evidence of connection. Use Configure, Test connection and Sync now; health and timestamps come from actual calls. Demo Mode always denotes sample fixtures. Disconnect removes credentials, the provider's dataset and mappings; provider revocation is attempted when supported. Remove remote app access in the provider console as well.

OAuth uses `${PUBLIC_API_URL}/api/integrations/oauth/callback`, registered exactly with the provider. `APP_BASE_URL` is the browser return location. States expire after ten minutes and are single-use even on denied/failed callbacks. A restart loses outstanding states; start authorization again. Missing OAuth app settings produce Configuration Required. Commercial tracking access can be marked Access Pending; that button records a local state and does not apply to the vendor.

| Provider | Setup / credentials / scopes | Data and verification | Sync / sample / limitations |
| --- | --- | --- | --- |
| Claude | Anthropic key and explicit accessible model; configure in Integrations or `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Official SDK model-list verification; Messages streaming/tool calls | No fixture model responses in live mode. Actual model availability is account-specific; default model is inherited and must be verified. |
| OpenAI GPT | OpenAI key and model; `OPENAI_API_KEY`, `OPENAI_MODEL` | Models endpoint, Chat Completions SSE and tools | Mocked locally; paid quota and compatible model required. |
| Google Gemini | Gemini key and model; `GEMINI_API_KEY`, `GEMINI_MODEL` | OpenAI-compatible models/chat endpoints | Mock-compatible protocol; account/model capability verification still required. |
| xAI Grok | xAI key and model; `XAI_API_KEY`, `XAI_MODEL` | OpenAI-compatible models/chat endpoints | Mock-compatible protocol; quota and model access required. |
| QuickBooks Online | Intuit app ID/secret, sandbox or production environment; `com.intuit.quickbooks.accounting`; callback above | OAuth token exchange, company verification; vendors, bills, purchases, accounts, available budgets | Read-only application behavior (the Accounting scope itself is broader). Manual sync, sample finance fixtures. Local OAuth mock coverage; production app approval and live read verification required. |
| Salesforce | Connected/External Client App ID/secret; `api refresh_token`; callback above | Identity verification, accounts, opportunities, available orders | Read-only manual sync, sample CRM fixtures. Org object permissions, API plan and API version must permit queries. Live flow unverified. |
| Shopify | Shop `.myshopify.com` domain and Admin API token, or configured OAuth app; `read_products read_inventory read_orders read_locations`; callback above | GraphQL shop verification; products/stock, open orders, locations; customer names/addresses not requested | Manual bounded sync and sample commerce fixtures. Protected customer-data approval may still apply to order data. Webhook checks raw-body HMAC with `SHOPIFY_WEBHOOK_SECRET`; webhook marks data stale rather than silently claiming a full sync. |
| CSV | No key; `.csv`, maximum 5 MB | Browser parse, preview, column mapping, row/type/reference validation and duplicate checks | Supplier, shipment, product/stock and purchasing-vendor templates. Confirm valid rows to save; plan/storage failures are reported individually. No overwrite; skipped/unmapped columns shown. |
| Excel | No key; `.xlsx`, maximum 5 MB | Bounded ZIP/OOXML parsing, same validation and persistence as CSV | First worksheet only, 256 columns, 10,000 rows, 25 MB expanded. No `.xls`, formulas, macros or external relationships. Convert dates to ISO text and formulas to values before import. |
| Open-Meteo | Keyless for permitted noncommercial use; commercial `OPEN_METEO_API_KEY` | Public forecast calls; only coordinates sent | Cached forecast signals with source/freshness on map, detail, simulator and dashboard. Forecast exposure never changes shipment status. No live verification claimed in automated tests. |
| MarineTraffic | Commercial API subscription/key and compatible API service endpoint | Vessel identifiers and position normalization; access tested through subscription endpoint | Sample vessel timeline available. The exact live service/parameters require subscription-level verification. Not production certified. |
| project44 | Commercial contract, region-specific API, client ID/secret | Client-credentials token, identifier tracking and normalized events | Sample milestones available. Tracking resource/version and identifier permissions require account verification; token issuance alone does not prove tracking-product entitlement. |
| News/disruption | Public Google News RSS / GDELT access | Source headline, publisher, publication time and link; rule-based route exposure matching | Existing Global Risk Intelligence preserved, with agent investigation links. Feed outage/rate limits shown; headlines are evidence of reporting, not confirmed business consequences. |
| Slack | Incoming webhook, or OAuth app (`chat:write channels:read`); callback above | OAuth auth test or an explicitly requested real test post; choose channel ID for OAuth | Category preferences, standing authorization and delivery history. Webhook remains unverified until successful authorized test. No incoming message reads. |
| Microsoft Teams | Teams Workflows webhook authorized by the Microsoft 365 tenant | Explicit real test post verifies webhook; Adaptive Card payloads | Category preferences, standing authorization and delivery history. Destination belongs to the workflow. Tenant restrictions, workflow owner continuity and endpoint evolution require account validation. |

Provider setup references checked during implementation: [Intuit OAuth](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0), [Shopify protected data](https://shopify.dev/docs/apps/launch/protected-customer-data), [MarineTraffic API services](https://support.marinetraffic.com/en/articles/9552798-how-to-access-and-review-your-api-services), [project44 visibility](https://developers.project44.com/guides/shippers/visibility/parcel). These confirm setup constraints; documentation access does not verify this application's live adapter behavior.

## Agent and approvals

Choose a ready model or the internal planner in AI Agent Hub. Settings → AI saves the preferred provider and opt-in financial/customer/inventory sharing permissions. The same persisted preferences are read in Agent Hub. The task text itself goes to the selected model: do not type information you want excluded. Tool access enforces sharing on the server, including tools that mix categories. Conservative withholding may prevent a tool from running if any category it returns is excluded.

Inspect the timeline, duration, tool status and supporting JSON. Results include provenance, confidence, uncertainty and token usage when available. Ungrounded model summaries are marked and accompanied by a verified tool summary. Reopen history after interrupted streaming. Save generated reports into Reports; existing plan limits apply. External message tools create approval requests, never direct sends. Only owners/admins can decide. `not_sent` means no connected destination; `executed` with a sent delivery is a successful external action. Standing automatic-send authorization is an explicit owner/admin preference per channel/category.

## Import and business data

Integrations → Import records → choose record type → download template → upload CSV/XLSX → correct mapping → inspect row errors/unmapped columns → confirm. Suppliers and purchasing inputs feed the existing shared model, shipment rows feed maps/simulation/reporting, and product rows appear in inventory and agent inventory tools. Shipment supplier/product references must exist first. Import products and suppliers before shipments. Reload retains records in browser storage or Supabase, according to the workspace type. Costs import creates new supplier/vendor purchasing inputs, not accounting ledger entries. Existing vendors are deliberately not overwritten.

Map Shopify products to Waymark products and Salesforce accounts to products in Inventory & Orders. Map QuickBooks vendors to suppliers in Financial Intelligence. Suggestions require confirmation. Unmapped dependencies are unknown, never safe by assumption. Accounting totals describe the synchronized period; annual sourcing inputs and accounting transactions have different time bases. Foreign-currency documents are excluded from combined totals until conversion is supported.

## Demonstration and monitoring

Open a Pro demo company, then AI Agent Hub → Run guided demo. Sample QuickBooks, Salesforce, Shopify and project44 datasets are loaded. The internal planner runs a simulated weather investigation, evaluates existing scenario/alternative engines, reads finance and stock/customer impact, generates a report and drafts a Slack preview. Review Approvals, approve the disconnected preview (`not_sent`), then review Agent Activity. No live LLM or external notification is needed.

Agent Activity exposes monitoring settings, last success/error, alerts and dismissal history, investigations and tool history. Run now updates the authorized workspace snapshot. See [DEPLOY.md](../DEPLOY.md) for restart recovery, single-instance scheduling, browser fallback, persistence and migration requirements.

## Troubleshooting

- API unreachable: full platform requires Express; check `VITE_API_BASE`, CORS and `/api/health`.
- Invalid OAuth state: restart authorization; check exact callback URL and a single/sticky server instance.
- Key cannot be read: restore the original encryption key or reconnect; do not claim an old connection is live.
- Model not ready: verify the key, available model and account quota in Integrations.
- Import saved fewer rows: review validation, duplicates, plan limits and storage errors; existing rows are never overwritten.
- Monitoring stale: submit Run now after browser record edits; inspect the saved-snapshot and scheduling limits.
- Missing source permissions: inspect integration health and sync job warnings; do not infer empty provider data means there are no orders or bills.
