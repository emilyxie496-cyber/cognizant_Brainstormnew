// Tours explain one decision or action at a time and never submit forms.
export const FEATURE_WORKFLOWS = {
  map: [
    ['feature-map', 'Choose Direction and Transport mode to narrow the routes. Pro filters also support supplier, product, status and risk.'],
    ['page-content', 'Select a supplier node to inspect its location, sourcing share, lead time and documentation. Country-level locations are estimates.'],
    ['page-content', 'Select a shipment marker to inspect status, ETA, route weather and tracking options. Schedule markers are not live positions.'],
    ['page-content', 'Use Analyze to investigate a selected record, or open Supplier Alternatives to compare sourcing options. Finish the tour to use the controls.'],
  ],
  shipments: [
    ['feature-shipments', 'Filter by direction, mode, status or supplier to find the shipment records you need.'],
    ['add-shipment', 'After finishing the tour, choose Add shipment. Select a supplier and product, then enter the reference, route, status and dates.'],
    ['page-content', 'Open a shipment to inspect its events, costs, emissions and tracking. Edit the record when you have updated information.'],
    ['page-content', 'For delayed shipments, choose Resolve to compare responses and record a reviewed decision. Check the updated shipment afterward.'],
  ],
  simulator: [
    ['page-content', 'Choose the disruption scenario you want to test. Advanced scenarios require the appropriate plan.'],
    ['feature-simulator', 'Set the affected supplier or hub, then adjust the scenario inputs, such as delay days or a cost increase.'],
    ['page-content', 'Review added cost, delivery impact, inventory shortfall and the response comparison. These are hypothetical estimates; inspect the assumptions.'],
    ['page-content', 'Name and save the scenario to reopen it later or use its estimates in Financial Intelligence and Reports.'],
  ],
  canadian: [
    ['feature-canadian', 'Choose the product and current supplier that form the basis of your Canadian supplier comparison.'],
    ['page-content', 'Inspect each alternative’s price, freight, lead time, emissions and documentation. Missing quotes remain unknown.'],
    ['page-content', 'Change the recommendation priorities to compare cost, delivery, emissions and sourcing-evidence trade-offs.'],
    ['page-content', 'Review assumptions before choosing a candidate. Request a quote where prices are missing, or save a comparison when your plan supports it.'],
  ],
  global: [
    ['feature-global', 'Select the product and current supplier you want to compare across international sourcing markets.'],
    ['page-content', 'Choose candidate countries and inspect landed cost, transport route, lead-time and emissions assumptions.'],
    ['page-content', 'Adjust your priorities and compare the recommendations. Country estimates do not prove that a supplier can deliver your product.'],
    ['page-content', 'Review unknown prices and documentation gaps before saving a comparison or investigating a specific supplier.'],
  ],
  sustainability: [
    ['page-content', 'Review recorded transport emissions and their calculation method. Estimates and provider calculations are labeled separately.'],
    ['page-content', 'Compare emissions by mode, supplier, country or shipment to identify the largest contributors.'],
    ['feature-sustainability', 'Inspect sourcing documentation. Verified requires supporting evidence; unknown indicates a gap in the records.'],
    ['page-content', 'Update supplier evidence in Settings or generate a Sustainability Report when supported by your plan.'],
  ],
  reports: [
    ['feature-reports', 'Choose a report type. Available types depend on your plan and use the current saved workspace records.'],
    ['feature-reports', 'Choose Generate after ending the tour, then read the report’s sections, assumptions and source timestamps.'],
    ['page-content', 'Save the report to retain it in this workspace, subject to the saved-report limit. Reopen saved reports to inspect their contents.'],
    ['page-content', 'Export PDF for a formatted document or CSV for its tables. Review estimates and missing information before sharing.'],
  ],
  agent: [
    ['agent-question', 'Choose a ready AI provider or the built-in planner. Type a focused question or select a suggested investigation.'],
    ['ai-preferences', 'Review financial, customer and inventory sharing permissions and save any changes. External models receive your task text and permitted tool results.'],
    ['agent-question', 'After finishing the guide, choose Run investigation. Watch the timeline for completed tools, errors and withheld results.'],
    ['agent-history', 'Review evidence, confidence and uncertainty, save any generated report, and reopen investigations from history. Proposed messages are reviewed in Approvals.'],
  ],
  world: [
    ['feature-world', 'Choose a news category to view trade, shipping, policy or disruption reporting.'],
    ['page-content', 'Filter by location, relevance, date or transport mode. Review the publisher, publication date and source link.'],
    ['page-content', 'Inspect matched suppliers and shipments. A headline match indicates possible exposure, not a confirmed delay.'],
    ['page-content', 'Choose Investigate on a story to prefill an Agent Hub question, or Read at source to verify the original reporting.'],
  ],
  activity: [
    ['monitor-settings', 'Review monitoring status, last success and any recorded error. Check whether scheduling is server-based or browser-only.'],
    ['monitor-settings', 'Select monitored signals, minimum risk and cost threshold. An owner or admin can save the configuration.'],
    ['page-content', 'Choose Run now after the guide to analyze current records. Inspect detected alerts, recommendations and related investigations.'],
    ['monitor-alerts', 'Dismiss reviewed alerts or reopen them later. Follow the investigation and approval links to inspect evidence and proposed actions.'],
  ],
  approvals: [
    ['page-content', 'Pending requests appear first. Open the message preview to inspect the proposed action and destination.'],
    ['page-content', 'Read the reasoning, supporting records and expected consequences. A disconnected destination is a preview that cannot deliver a message.'],
    ['page-content', 'Owners and admins can add an optional note and choose Approve or Reject after ending the tour. Approval can send a real message when connected.'],
    ['page-content', 'Check the resulting status and audit history. not_sent means nothing was delivered; it is not a successful send.'],
  ],
  integrations: [
    ['integration-filters', 'Search for a provider or filter by category and connection status. Matching providers remain grouped in sections on this page.'],
    ['feature-integrations', 'Open the relevant section, such as AI Integrations or Accounting and Financial. Review the provider’s permissions and setup requirements.'],
    ['feature-integrations', 'Choose Configure after the tour and supply credentials or complete provider authorization. Then test the connection; a saved key alone is not verification.'],
    ['feature-integrations', 'Use Sync now where supported, then inspect health, synchronization time and Activity history. Data Import provides the CSV/XLSX workflow.'],
    ['feature-integrations', 'For Slack or Teams, review notification categories and automatic-send permissions. A test message is a real external post and requires your explicit action.'],
  ],
  inventory: [
    ['inventory-records', 'Review saved stock quantities and inbound shipments. Unknown availability is not the same as zero stock.'],
    ['page-content', 'For connected store data, compare stockouts, open-order demand and supply exposure. Check the source and synchronization time.'],
    ['inventory-mapping', 'Map store products to the correct Waymark products and confirm suggestions. Unlinked products cannot establish shipment dependencies.'],
    ['page-content', 'Review potentially affected customer commitments and CRM mappings. Use Investigate to inspect evidence and possible responses.'],
  ],
  finance: [
    ['page-content', 'Review annual import/freight inputs and accounting-provider health. Accounting facts require a successful synchronization.'],
    ['finance-suppliers', 'Compare supplier spend, purchase costs and lead times. Check the currency and whether each figure is recorded, synced or estimated.'],
    ['page-content', 'For connected books, inspect period spending, payables, categories and vendor mappings. Period spending and annual inputs have different time bases.'],
    ['finance-scenarios', 'Review saved hypothetical disruption costs or start an investigation. Scenarios are planning estimates, not expenses already incurred.'],
  ],
  analyst: [
    ['feature-analyst', 'Select the shipments, suppliers, headlines or other context you want the analyst to examine.'],
    ['feature-analyst', 'Enter a focused question about the selected records. Do not assume that a reported event has already caused a business disruption.'],
    ['page-content', 'Run the analysis after the guide. Review supporting evidence, assumptions and unavailable information.'],
    ['page-content', 'Inspect underlying records, compare alternatives or test a scenario before making an operational decision.'],
  ],
}

export const SETTINGS_WORKFLOWS = {
  ai: ['Select a preferred provider. Configure its key and model in Integrations first, or select the internal planner.', 'Review each financial, customer and inventory sharing checkbox. Enable only the information you authorize the model to receive.', 'After ending this guide, save AI preferences. Reopen Agent Hub to use the persisted provider and permissions.'],
  profile: ['Review company name, industry, headquarters and province. Update the fields that have changed.', 'Enter known inventory coverage, typical lead time and shortfall-day cost. Leave unknown optional inputs blank.', 'After the guide, choose Save profile. Return to the Command Center to check the updated company inputs.'],
  display: ['Choose the theme, text size, reduced motion and whether a Read aloud button appears on every page.', 'Choose which Command Center sections are visible and the hero vehicle. These display preferences apply to this browser.', 'Return home to check the layout. Use Restore defaults here if you want to undo display preferences.'],
  features: ['Features are grouped by navigation category: Intelligence, Solutions and Business. Search or filter by category.', 'Turn a feature on or off with its switch. A feature that is off disappears from navigation; its data is kept.', 'Availability shows when some capabilities inside a feature need a higher plan. The server still enforces plan limits and roles.'],
  branding: ['Enter the company display name and optional tagline and website shown beside Waymark branding.', 'Upload a PNG, JPEG or WebP logo. It is checked, resized and validated again by the server; SVG is not accepted.', 'Save branding. It appears in the top bar, generated reports and email alerts. Only owners and admins can change it.'],
  email: ['Add authorized recipient addresses, one per line. Only owners and admins can change them.', 'Choose the minimum risk level and the alert categories that should be emailed.', 'Save, then send a test email. Without a configured email provider, messages go to a mock outbox and are not delivered.'],
  language: ['Choose one of six interface languages. The choice is saved in this browser.', 'Arabic switches the workspace to a right-to-left layout.', 'Business records such as supplier names and shipment references stay as entered; untranslated text falls back to English.'],
  products: ['Add a product or select an existing record to edit its name, category and identifying details.', 'Review suggested HS classification before accepting it. Suggestions are not verified customs classifications.', 'Save the product after the guide, then select it in shipments or inventory mappings. Check dependencies before deleting a record.'],
  suppliers: ['Add or edit a supplier, providing its name, country and known location.', 'Complete purchasing inputs, product links, transport assumptions and documentation using supported information.', 'Save the supplier after the guide and review updated sourcing figures. CSV import can add multiple supplier records.'],
  warehouses: ['Enter the warehouse name and Canadian city/province to locate the destination.', 'Check the returned location. Incorrect coordinates affect route and transit estimates.', 'Save the warehouse and assign it to the appropriate suppliers or shipments. Review destinations on the map.'],
  financials: ['Choose the appropriate financial-input mode and check currency and recorded amounts.', 'Enter supported purchasing, spend and freight assumptions. Missing values and estimates affect downstream calculations.', 'Save after the guide and check the resulting figures in the Command Center and Financial Intelligence.'],
  team: ['Review team information and whether real account-based collaboration is configured.', 'Check membership roles and plan limits before changing access. Viewers cannot approve operational actions.', 'Use only the account controls available here. Demo/local team information does not invite real users or grant external access.'],
  admin: ['Review the administrative actions available for this workspace and your role.', 'Read the scope of any reset or maintenance action and confirm the intended company or sample workspace.', 'After the guide, use an available action only after reviewing its confirmation. Check the resulting workspace state.'],
  plan: ['Compare your current plan’s access and record limits with other tiers.', 'Review limits for suppliers, shipments, scenarios and reports. Existing records remain after a tier reduction.', 'Demo tier changes preview feature access. Pricing is illustrative; this screen does not complete a paid subscription purchase.'],
}

export const EXTRA_WORKFLOWS = {
  'add-shipment': ['In the form, select supplier and product, then enter a unique reference, direction, transport mode, route and known dates.', 'Check required fields, save the shipment and verify it appears in the list. Open it to inspect saved details.'],
  vehicle: ['After the guide, select a vehicle and return home to inspect the scene. The choice persists in this browser.'],
  'text-size': ['After the guide, select a comfortable size from the Text size control. The setting scales application text.', 'Check forms and navigation at that size. The top-bar selector remains available on other pages and the choice survives reload.'],
  'read-aloud': ['After the guide, open Read aloud in the top bar, choose the page or section and a voice, then press Play.', 'Use Pause and Resume, adjust speed, or Stop to end reading. Changing pages stops the current reading.'],
  help: ['Choose a matching task guide. Next and Back move through individual workflow steps and highlight the relevant controls.', 'Finish or press Escape to return control to the app, then carry out the task. Tours never submit forms or approve actions for you.'],
}
