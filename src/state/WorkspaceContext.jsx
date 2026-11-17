/*
  Session and workspace state. One provider owns the current company, its plan
  and persistence; every page reads the derived model from here.

  Session kinds:
    demo     fictional company, stored separately from real data
    local    browser-only workspace with no password and no real authentication
    supabase real account, when Supabase is configured
*/
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { can, checkLimit, limitOf, normalizePlan, PLANS } from '../../shared/entitlements.js'
import { emissionsKey, METHODS } from '../../shared/emissions.js'
import { DEMO_COMPANIES } from '../data/demoCompanies.js'
import { FX_SNAPSHOT } from '../data/fxSnapshot.js'
import { buildModel } from '../engine/model.js'
import { ApiError, api, setSessionHeaders } from '../services/api.js'
import { createLocalRepository, createSupabaseRepository } from '../services/repository.js'
import { createCompanyRecord, currentCompanyId, supabase } from '../services/supabase.js'

const SESSION_KEY = 'waymark.session'
const COLLECTION_LIMITS = { suppliers: 'suppliers', shipments: 'shipments', scenarios: 'scenarios', reports: 'reports' }

const WorkspaceContext = createContext(null)
export const useWorkspace = () => useContext(WorkspaceContext)

/** A demo/local session must never inherit the signed-in account's API identity. */
export const sessionApiHeaders = (session, token, plan, key) => session?.mode === 'supabase' && token
  ? { Authorization: `Bearer ${token}` }
  : { 'X-Waymark-Preview-Plan': plan, ...(key ? { 'X-Waymark-Workspace': key } : {}) }

export class PlanLimitError extends Error {
  constructor(key, limit, plan) {
    super(`The ${PLANS[plan].name} plan includes up to ${limit} ${key}.`)
    this.planLimit = true
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY))
  } catch {
    return null
  }
}

function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage can be blocked. The session then lasts for this page view only.
  }
}

const DEVICE_KEY = 'waymark.deviceKey'

/**
 * Identifies this browser's demo and local workspaces to the API, which keeps
 * their integration status, agent runs and approvals. It is a random value, not
 * a credential for any outside service, and a signed-in session never uses it.
 */
function deviceKey() {
  try {
    let key = localStorage.getItem(DEVICE_KEY)
    if (!/^[a-f0-9]{32}$/.test(key ?? '')) {
      key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(DEVICE_KEY, key)
    }
    return key
  } catch {
    return null
  }
}

const workspaceKey = (session) => {
  const device = deviceKey()
  const scope = session?.mode === 'demo' ? session.demoId : session?.mode === 'local' ? session.id : null
  return device && scope ? `${device}-${scope}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96) : null
}

/** The records the API needs to rebuild this company's model for an agent run. Nothing else is sent. */
export const workspaceSnapshot = (ws) => ({
  company: ws.company, warehouses: ws.warehouses ?? [], products: ws.products ?? [], suppliers: ws.suppliers ?? [],
  shipments: ws.shipments ?? [], events: ws.events ?? [], alternatives: ws.alternatives ?? [], emissions: ws.emissions ?? {},
})

const LOCAL_INDEX_KEY = 'waymark.local.index'

/** Local workspaces in this browser, so spawned demo accounts can be reopened. */
export function localWorkspaces() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_INDEX_KEY)) ?? []
  } catch {
    return []
  }
}

function rememberLocal(entry) {
  try {
    localStorage.setItem(LOCAL_INDEX_KEY, JSON.stringify([...localWorkspaces().filter((w) => w.id !== entry.id), entry]))
  } catch {
    // Without storage the workspace simply is not listed for reopening.
  }
}

export const blankCompany = (id, name, plan = 'free') => ({
  id,
  name,
  isLocal: true,
  plan,
  onboardingComplete: false,
  hq: {},
  categories: [],
  preferredModes: [],
  finance: { mode: 'exact', currency: 'CAD', quick: {}, exact: {} },
  operations: {},
})

async function repositoryFor(session) {
  if (session.mode === 'demo') {
    const demo = DEMO_COMPANIES.find((d) => d.id === session.demoId) ?? DEMO_COMPANIES[0]
    return createLocalRepository(`waymark.demo.${demo.id}`, demo.build)
  }
  if (session.mode === 'local') {
    return createLocalRepository(`waymark.local.${session.id}`, () => ({ company: blankCompany(session.id, session.name ?? 'My company', session.plan) }))
  }
  let companyId = await currentCompanyId()
  if (!companyId) companyId = await createCompanyRecord(session.companyName ?? 'My company')
  return createSupabaseRepository(supabase, companyId)
}

export function WorkspaceProvider({ children }) {
  const [session, setSession] = useState(readSession)
  const [ws, setWs] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [loadError, setLoadError] = useState(null)
  const [health, setHealth] = useState(null)
  const [fx, setFx] = useState(FX_SNAPSHOT)
  const [carbon, setCarbon] = useState({ running: false, error: null, done: 0 })
  const repo = useRef(null)
  const tokenRef = useRef(null)
  const saveQueue = useRef(Promise.resolve())

  const plan = useMemo(() => {
    if (session?.mode === 'demo') return normalizePlan(session.tier)
    return normalizePlan(ws?.company?.plan)
  }, [session, ws])

  // The API trusts a preview plan only for anonymous traffic; a token always wins.
  useEffect(() => {
    const key = workspaceKey(session)
    setSessionHeaders(() => sessionApiHeaders(session, tokenRef.current, plan, key))
  }, [plan, session])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false, integrations: {} }))
    api.fx().then(setFx).catch(() => setFx(FX_SNAPSHOT))
  }, [])

  useEffect(() => {
    if (!supabase) return undefined
    supabase.auth.getSession().then(({ data }) => {
      tokenRef.current = data.session?.access_token ?? null
    })
    const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
      tokenRef.current = authSession?.access_token ?? null
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const load = useCallback(async (next) => {
    setStatus('loading')
    setLoadError(null)
    setWs(null)
    try {
      const repository = await repositoryFor(next)
      repo.current = repository
      setWs(await repository.load())
      setStatus('ready')
    } catch (err) {
      setLoadError(err.message ?? 'Could not load this workspace.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (session) load(session)
    else {
      repo.current = null
      setWs(null)
      setStatus('idle')
    }
  }, [session?.mode, session?.demoId, session?.id, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeSession = useCallback((next) => {
    writeSession(next)
    setSession(next)
  }, [])

  const openDemo = useCallback((demoId, tier = 'pro') => changeSession({ mode: 'demo', demoId, tier }), [changeSession])
  const setDemoTier = useCallback((tier) => changeSession({ ...session, tier }), [changeSession, session])
  const openLocal = useCallback(
    (name, spawnPlan = null) => {
      const entry = { mode: 'local', id: crypto.randomUUID(), name, plan: spawnPlan ?? 'free', spawnPlan }
      rememberLocal(entry)
      changeSession(entry)
    },
    [changeSession],
  )
  const reopenLocal = useCallback((entry) => changeSession(entry), [changeSession])
  const openSupabase = useCallback((companyName, spawnPlan = null) => changeSession({ mode: 'supabase', companyName, spawnPlan }), [changeSession])

  const endSession = useCallback(async () => {
    if (session?.mode === 'supabase') await supabase?.auth.signOut()
    tokenRef.current = null
    changeSession(null)
  }, [changeSession, session])

  const counts = useMemo(
    () => ({
      suppliers: ws?.suppliers?.length ?? 0,
      shipments: ws?.shipments?.length ?? 0,
      scenarios: ws?.scenarios?.length ?? 0,
      reports: ws?.reports?.length ?? 0,
    }),
    [ws],
  )

  /** Create or update a record, enforcing the plan's limit on anything new. */
  const saveRecord = useCallback(
    (collection, record) => {
      const repository = repo.current
      const operation = saveQueue.current.catch(() => {}).then(async () => {
      if (repository !== repo.current) throw new Error('The workspace changed before this record could be saved. Reopen the import in the intended workspace.')
      const latest = await repository.load()
      const list = latest[collection] ?? []
      const exists = list.some((r) => r.id === record.id)
      const key = COLLECTION_LIMITS[collection]
      if (key && !exists) {
        const check = checkLimit(plan, key, list.length)
        if (!check.allowed) throw new PlanLimitError(key, check.limit, plan)
      }
      const saved = { ...record, id: record.id ?? crypto.randomUUID() }
      await repository.put(collection, saved)
      setWs((w) => w?.company?.id !== latest.company.id ? w : ({
        ...w,
        [collection]: exists ? w[collection].map((r) => (r.id === saved.id ? saved : r)) : [...(w[collection] ?? []), saved],
      }))
      return saved
      })
      saveQueue.current = operation
      return operation
    },
    [ws, plan],
  )

  const deleteRecord = useCallback(async (collection, id) => {
    await repo.current.remove(collection, id)
    setWs((w) => ({ ...w, [collection]: w[collection].filter((r) => r.id !== id) }))
  }, [])

  const updateCompany = useCallback(
    async (patch) => {
      const company = { ...ws.company, ...patch }
      await repo.current.saveCompany(company)
      setWs((w) => ({ ...w, company }))
      return company
    },
    [ws],
  )

  const resetDemo = useCallback(async () => {
    setWs(await repo.current.reset())
  }, [])

  const model = useMemo(() => (ws?.company ? buildModel(ws, { fx }) : null), [ws, fx])

  const climatiqUsable = Boolean(health?.integrations?.climatiq) && can(plan, 'carbon.climatiq')

  /** Fetch a real Climatiq result for one route. Keeps the estimate if it fails. */
  const calculateClimatiq = useCallback(async (legs, weightKg) => {
    const result = await api.freightEmissions(legs, weightKg)
    const key = emissionsKey(legs, weightKg)
    await repo.current.putEmission(key, result)
    setWs((w) => ({ ...w, emissions: { ...w.emissions, [key]: result } }))
    return result
  }, [])

  /** Calculate every shipment still on the estimate, one at a time. */
  const refreshCarbon = useCallback(async () => {
    if (!model || !climatiqUsable) return
    const pending = model.shipments.filter((s) => s.emissions && s.emissions.method !== METHODS.climatiq)
    if (!pending.length) return
    setCarbon({ running: true, error: null, done: 0 })
    let done = 0
    let error = null
    // One unsupported route must not stop the others: it simply keeps its labelled estimate.
    for (const s of pending) {
      try {
        await calculateClimatiq(s.legs, Number(s.weightKg))
        done += 1
        setCarbon((c) => ({ ...c, done }))
      } catch (err) {
        const reason = err instanceof ApiError ? err.detail ?? err.message : 'Climatiq could not be reached.'
        error = `${s.reference}: ${reason}`
      }
    }
    setCarbon({ running: false, error, done })
  }, [model, climatiqUsable, calculateClimatiq])

  const carbonRequested = useRef(null)
  useEffect(() => {
    const key = `${ws?.company?.id}:${plan}`
    if (climatiqUsable && model && carbonRequested.current !== key) {
      carbonRequested.current = key
      refreshCarbon()
    }
  }, [climatiqUsable, model, plan, ws?.company?.id, refreshCarbon])

  /** What an agent run, a monitoring run or a sample-data load sends to the API. */
  const agentPayload = useCallback(() => ({ workspace: workspaceSnapshot(ws), fx: { rates: fx?.rates ?? {}, source: fx?.source, asOf: fx?.asOf } }), [ws, fx])

  const value = useMemo(
    () => ({
      session, status, loadError, ws, model, plan, health, fx, carbon, counts, climatiqUsable,
      isDemo: session?.mode === 'demo',
      isLocal: session?.mode === 'local',
      can: (feature) => can(plan, feature),
      limit: (key) => limitOf(plan, key),
      openDemo, setDemoTier, openLocal, reopenLocal, openSupabase, endSession,
      saveRecord, deleteRecord, updateCompany, resetDemo, refreshCarbon, calculateClimatiq, agentPayload,
      reload: () => session && load(session),
    }),
    [session, status, loadError, ws, model, plan, health, fx, carbon, counts, climatiqUsable, openDemo, setDemoTier, openLocal, reopenLocal, openSupabase, endSession, saveRecord, deleteRecord, updateCompany, resetDemo, refreshCarbon, calculateClimatiq, agentPayload, load],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
