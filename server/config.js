/*
  Server configuration. Secrets live only in process.env (loaded from a
  git-ignored .env), and never reach the browser. /api/health reports booleans.
*/

export function loadConfig(env = process.env) {
  return {
    port: Number(env.API_PORT) || 8787,
    allowedOrigins: (env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
    climatiqKey: env.CLIMATIQ_API_KEY || '',
    climatiqBaseUrl: env.CLIMATIQ_BASE_URL || 'https://api.climatiq.io',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    // Delay Assist and the AI Trade Analyst: any OpenAI-compatible provider, tried in order, then Anthropic if set.
    // Model names have no defaults on purpose. Pick one your provider currently offers.
    llmBaseUrl: env.LLM_BASE_URL || '',
    llmApiKey: env.LLM_API_KEY || '',
    llmModel: env.LLM_MODEL || '',
    llmFallbackBaseUrl: env.LLM_FALLBACK_BASE_URL || '',
    llmFallbackApiKey: env.LLM_FALLBACK_API_KEY || '',
    llmFallbackModel: env.LLM_FALLBACK_MODEL || '',
    aiDailyLimit: Number(env.AI_DAILY_LIMIT) || 200,
    supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
    trackingApiKey: env.TRACKING_API_KEY || '',
    trackingProvider: env.TRACKING_PROVIDER || '',
    openskyBaseUrl: env.OPENSKY_BASE_URL || 'https://opensky-network.org',
    openMeteoBaseUrl: env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com',
    geocodeBaseUrl: env.GEOCODE_BASE_URL || 'https://geocoding-api.open-meteo.com',
    fxBaseUrl: env.FX_BASE_URL || 'https://www.bankofcanada.ca',
    directoryBaseUrl: env.DIRECTORY_BASE_URL || 'https://www.wikidata.org',
    newsBaseUrl: env.NEWS_BASE_URL || 'https://news.google.com',
    gdeltBaseUrl: env.GDELT_BASE_URL || 'https://api.gdeltproject.org',
    // Shared daily ceiling for keyless demo traffic, so a public demo cannot exhaust a Climatiq quota.
    demoClimatiqDaily: Number(env.DEMO_CLIMATIQ_DAILY) || 300,
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 120,
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 10_000,

    // --- Waymark 3.0: integrations, agent and notifications ---
    // Where the browser reaches the app and the API. Used for OAuth redirects and notification links.
    appBaseUrl: (env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
    publicApiUrl: (env.PUBLIC_API_URL || env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
    // Server-side state (connections, agent runs, approvals). Empty keeps everything in memory.
    dataDir: env.WAYMARK_DATA_DIR ?? '.waymark-data',
    // Encrypts stored credentials and synced records. Without it a per-process key is used,
    // so saved credentials stop working after a restart and must be entered again.
    encryptionKey: env.INTEGRATIONS_ENCRYPTION_KEY || '',
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    extraAllowedHosts: (env.EXTRA_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean),

    // AI providers for the Agent Hub. Model ids are configuration, never code: provider line-ups change.
    anthropicEffort: env.ANTHROPIC_EFFORT ?? 'medium',
    openaiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || '',
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    xaiKey: env.XAI_API_KEY || '',
    xaiModel: env.XAI_MODEL || '',
    xaiBaseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
    agentMaxSteps: Number(env.AGENT_MAX_STEPS) || 8,
    agentMaxToolCalls: Number(env.AGENT_MAX_TOOL_CALLS) || 16,
    agentTimeoutMs: Number(env.AGENT_TIMEOUT_MS) || 120_000,

    // OAuth apps. Each provider needs its own registered app; see docs/INTEGRATIONS.md.
    quickbooksClientId: env.QUICKBOOKS_CLIENT_ID || '',
    quickbooksClientSecret: env.QUICKBOOKS_CLIENT_SECRET || '',
    quickbooksEnvironment: env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    quickbooksAuthUrl: env.QUICKBOOKS_AUTH_URL || 'https://appcenter.intuit.com/connect/oauth2',
    quickbooksTokenUrl: env.QUICKBOOKS_TOKEN_URL || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    quickbooksRevokeUrl: env.QUICKBOOKS_REVOKE_URL || 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    quickbooksApiBaseUrl: env.QUICKBOOKS_API_BASE_URL || '',
    quickbooksMinorVersion: env.QUICKBOOKS_MINOR_VERSION || '75',
    salesforceClientId: env.SALESFORCE_CLIENT_ID || '',
    salesforceClientSecret: env.SALESFORCE_CLIENT_SECRET || '',
    salesforceLoginUrl: (env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com').replace(/\/+$/, ''),
    salesforceApiVersion: env.SALESFORCE_API_VERSION || '',
    shopifyClientId: env.SHOPIFY_CLIENT_ID || '',
    shopifyClientSecret: env.SHOPIFY_CLIENT_SECRET || '',
    shopifyApiVersion: env.SHOPIFY_API_VERSION || '',
    shopifyWebhookSecret: env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET || '',
    slackClientId: env.SLACK_CLIENT_ID || '',
    slackClientSecret: env.SLACK_CLIENT_SECRET || '',
    slackApiBaseUrl: (env.SLACK_API_BASE_URL || 'https://slack.com/api').replace(/\/+$/, ''),
    slackAuthUrl: env.SLACK_AUTH_URL || 'https://slack.com/oauth/v2/authorize',
    // Commercial Open-Meteo subscription. Without it the free, non-commercial endpoint is used.
    openMeteoApiKey: env.OPEN_METEO_API_KEY || '',
    marineTrafficBaseUrl: (env.MARINETRAFFIC_BASE_URL || 'https://services.marinetraffic.com/api').replace(/\/+$/, ''),
    project44BaseUrl: (env.PROJECT44_BASE_URL || 'https://na12.api.project44.com').replace(/\/+$/, ''),
    // Background monitoring. 0 disables the timer; manual runs always work.
    monitorIntervalMinutes: Number(env.MONITOR_INTERVAL_MINUTES) || 0,
  }
}
