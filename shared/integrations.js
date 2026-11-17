/*
  The integration catalogue: one description of every provider, read by the
  API (to decide what each connection needs) and by the Integrations page (to
  draw it). Nothing here says a provider is connected. Status is always worked
  out on the server from a verified connection.
*/

export const INTEGRATION_CATEGORIES = [
  { id: 'ai', label: 'AI Models' },
  { id: 'accounting', label: 'Accounting and Financial' },
  { id: 'commerce', label: 'CRM and Commerce' },
  { id: 'import', label: 'Data Import' },
  { id: 'weather', label: 'Weather and Risk Intelligence' },
  { id: 'logistics', label: 'Logistics' },
  { id: 'events', label: 'Global Events' },
  { id: 'communication', label: 'Communication' },
]

export const STATUS = {
  connected: { label: 'Connected', tone: 'emerald' },
  not_connected: { label: 'Not Connected', tone: 'slate' },
  configuration_required: { label: 'Configuration Required', tone: 'amber' },
  syncing: { label: 'Syncing', tone: 'sky' },
  error: { label: 'Error', tone: 'rose' },
  demo: { label: 'Demo Mode', tone: 'amber' },
  access_pending: { label: 'Access Pending', tone: 'sky' },
}

/*
  auth:
    apikey   a secret typed into Waymark, or set in the server environment
    oauth    the provider's own consent screen; needs an OAuth app registered on the server
    webhook  a destination URL created inside the provider
    none     key-less public service
    builtin  part of Waymark, nothing to connect
*/
export const INTEGRATIONS = [
  {
    id: 'anthropic', category: 'ai', name: 'Claude', vendor: 'Anthropic', icon: 'sparkles', auth: 'apikey', llm: true,
    description: 'Runs agent investigations and plain-language explanations.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'model', label: 'Model', modelPicker: true }],
    permissions: ['Receives only the task you type and the tool results needed to answer it'],
    features: ['Agent investigations', 'Tool calling', 'Streaming', 'Recommendation explanations'],
    envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
  },
  {
    id: 'openai', category: 'ai', name: 'OpenAI GPT', vendor: 'OpenAI', icon: 'sparkles', auth: 'apikey', llm: true,
    description: 'Alternative model for agent investigations.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'model', label: 'Model', modelPicker: true }],
    permissions: ['Receives only the task you type and the tool results needed to answer it'],
    features: ['Agent investigations', 'Tool calling', 'Streaming'],
    envKeys: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
  },
  {
    id: 'gemini', category: 'ai', name: 'Google Gemini', vendor: 'Google', icon: 'sparkles', auth: 'apikey', llm: true,
    description: 'Alternative model for agent investigations.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'model', label: 'Model', modelPicker: true }],
    permissions: ['Receives only the task you type and the tool results needed to answer it'],
    features: ['Agent investigations', 'Tool calling', 'Streaming'],
    envKeys: ['GEMINI_API_KEY', 'GEMINI_MODEL'],
  },
  {
    id: 'xai', category: 'ai', name: 'Grok', vendor: 'xAI', icon: 'sparkles', auth: 'apikey', llm: true,
    description: 'Alternative model for agent investigations.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'model', label: 'Model', modelPicker: true }],
    permissions: ['Receives only the task you type and the tool results needed to answer it'],
    features: ['Agent investigations', 'Tool calling', 'Streaming'],
    envKeys: ['XAI_API_KEY', 'XAI_MODEL'],
  },
  {
    id: 'quickbooks', category: 'accounting', name: 'QuickBooks Online', vendor: 'Intuit', icon: 'card', auth: 'oauth', sync: true, demo: true, dataset: 'finance',
    description: 'Vendors, bills and purchases for supplier cost analysis. Read-only.',
    permissions: ['Read vendors', 'Read bills and purchases', 'Read chart of accounts', 'Read budgets, where they exist', 'Waymark never writes to your books'],
    features: ['Financial Intelligence', 'Supplier cost comparison', 'Disruption cost context for the agent'],
    envKeys: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
    setup: 'Register an app at developer.intuit.com and add the redirect URI shown below.',
  },
  {
    id: 'salesforce', category: 'commerce', name: 'Salesforce', vendor: 'Salesforce', icon: 'users', auth: 'oauth', sync: true, demo: true, dataset: 'crm',
    description: 'Accounts, opportunities and orders, to see which customers a delay could reach.',
    permissions: ['Read accounts', 'Read opportunities', 'Read orders, when your org has them enabled', 'Read-only: nothing is created or changed'],
    features: ['Customer Impact panel', 'Customer context for the agent'],
    envKeys: ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'],
    setup: 'Create a Connected App (or External Client App) with the "api" and "refresh_token" scopes and the redirect URI shown below.',
  },
  {
    id: 'shopify', category: 'commerce', name: 'Shopify', vendor: 'Shopify', icon: 'tag', auth: 'apikey', oauthOptional: true, sync: true, demo: true, dataset: 'commerce',
    description: 'Orders, products and inventory levels, to spot stockout risk behind a late shipment.',
    fields: [
      { key: 'shop', label: 'Shop domain', placeholder: 'your-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', secret: true, hint: 'From a custom app in your Shopify admin with the read scopes listed below.' },
    ],
    permissions: ['read_products', 'read_inventory', 'read_orders', 'read_locations', 'Customer names, emails and addresses are not requested'],
    features: ['Inventory & Orders', 'Stockout risk', 'Inventory context for the agent'],
    envKeys: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
  },
  {
    id: 'csv', category: 'import', name: 'CSV import', vendor: 'Waymark', icon: 'upload', auth: 'builtin', importer: true,
    description: 'Upload suppliers, shipments, inventory or purchasing costs from a .csv file.',
    permissions: ['Files are read in your browser', 'Only rows you confirm are saved to your workspace'],
    features: ['Column mapping', 'Validation and duplicate checks', 'Templates'],
  },
  {
    id: 'excel', category: 'import', name: 'Excel import', vendor: 'Waymark', icon: 'file', auth: 'builtin', importer: true,
    description: 'Upload the same data from an .xlsx workbook.',
    permissions: ['Files are read in your browser', 'Only rows you confirm are saved to your workspace'],
    features: ['Column mapping', 'Validation and duplicate checks', 'Templates'],
  },
  {
    id: 'openmeteo', category: 'weather', name: 'Open-Meteo', vendor: 'Open-Meteo', icon: 'cloud', auth: 'none', optionalKey: true,
    description: 'Weather forecasts for the ports, airports and warehouses on your routes.',
    permissions: ['Sends route coordinates only', 'No company or shipment details leave Waymark'],
    features: ['Weather alerts', 'Shipment weather checks', 'Weather signals in the simulator and monitoring'],
    envKeys: ['OPEN_METEO_API_KEY'],
    notice: 'The key-less Open-Meteo API is for non-commercial use. Commercial deployments need an Open-Meteo API subscription: set OPEN_METEO_API_KEY on the server.',
  },
  {
    id: 'marinetraffic', category: 'logistics', name: 'MarineTraffic', vendor: 'Kpler', icon: 'anchor', auth: 'apikey', demo: true, commercial: true, dataset: 'tracking',
    description: 'Vessel positions and port calls for ocean shipments.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }],
    permissions: ['Sends vessel identifiers (IMO or MMSI) you have recorded on a shipment'],
    features: ['Vessel position', 'ETA signals', 'Tracking timeline'],
    notice: 'Needs a paid MarineTraffic API subscription. Waymark ships the adapter and data contract; it has not been exercised against a live account.',
  },
  {
    id: 'project44', category: 'logistics', name: 'project44', vendor: 'project44', icon: 'route', auth: 'apikey', demo: true, commercial: true, dataset: 'tracking',
    description: 'Multimodal shipment milestones and predicted arrival times.',
    fields: [{ key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client secret', secret: true }],
    permissions: ['Sends container, bill of lading or air waybill numbers you have recorded on a shipment'],
    features: ['Milestone timeline', 'Predicted ETA', 'Delay signals'],
    notice: 'Needs a project44 contract and API credentials. Waymark ships the adapter and data contract; it has not been exercised against a live account.',
  },
  {
    id: 'news', category: 'events', name: 'News and disruption feed', vendor: 'Google News RSS and GDELT', icon: 'newspaper', auth: 'none',
    description: 'Trade, port, strike and weather headlines, matched to your suppliers and routes.',
    permissions: ['Sends fixed search terms only', 'Headline, publisher, date and link are read; article text is not'],
    features: ['Global Risk Intelligence', 'Event matching', 'Disruption context for the agent'],
  },
  {
    id: 'slack', category: 'communication', name: 'Slack', vendor: 'Slack', icon: 'bell', auth: 'webhook', oauthOptional: true, channel: true,
    description: 'Send approved risk alerts to a Slack channel.',
    fields: [{ key: 'webhookUrl', label: 'Incoming webhook URL', secret: true, placeholder: 'https://hooks.slack.com/services/…', hint: 'Create one in your Slack app under Incoming Webhooks. Or use "Add to Slack" when the Slack app is set up on the server.' }],
    permissions: ['Post messages to the channel you choose', 'List public channels, to offer that choice (OAuth only)', 'Waymark does not read your messages'],
    features: ['Risk alerts', 'Test messages', 'Delivery history'],
    envKeys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  },
  {
    id: 'teams', category: 'communication', name: 'Microsoft Teams', vendor: 'Microsoft', icon: 'users', auth: 'webhook', channel: true,
    description: 'Send approved risk alerts to a Teams channel or chat.',
    fields: [{ key: 'webhookUrl', label: 'Workflow webhook URL', secret: true, placeholder: 'https://…logic.azure.com/…', hint: 'In Teams, add the "Post to a channel when a webhook request is received" workflow and paste its URL.' }],
    permissions: ['Post adaptive cards to the destination that owns the webhook', 'Waymark does not read your messages'],
    features: ['Risk alerts', 'Test notifications', 'Delivery status'],
    notice: 'Teams destinations are created with Workflows (Power Automate). Some tenants restrict Workflows or external webhooks; ask your Microsoft 365 administrator if the workflow is unavailable.',
  },
]

export const integrationById = (id) => INTEGRATIONS.find((i) => i.id === id) ?? null
export const LLM_PROVIDER_IDS = INTEGRATIONS.filter((i) => i.llm).map((i) => i.id)

/** What a notification can be about. Preferences and the agent's drafting tools share this list. */
export const NOTIFICATION_CATEGORIES = [
  { id: 'high_risk_shipment', label: 'High-risk shipment detected' },
  { id: 'weather_disruption', label: 'Weather disruption warning' },
  { id: 'supplier_alternative', label: 'Supplier alternative recommended' },
  { id: 'cost_impact', label: 'Significant cost-impact scenario' },
  { id: 'inventory_risk', label: 'Inventory risk' },
  { id: 'investigation_complete', label: 'Agent investigation completed' },
]

/** The newest quarterly Shopify Admin API version that has been released by `now`. */
export function shopifyApiVersion(now = new Date()) {
  const quarter = Math.floor(now.getUTCMonth() / 3) * 3 + 1
  return `${now.getUTCFullYear()}-${String(quarter).padStart(2, '0')}`
}
