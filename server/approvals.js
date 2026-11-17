/*
  Human approval for anything that leaves Waymark.

  An agent, the monitor, or a tool can only ever *request* an external action.
  The action runs in exactly one place, `execute`, and that function refuses
  any request whose status is not "approved". There is no other path to
  `notifier.deliver` for agent-originated messages, so no prompt and no tool
  call can send one on its own.

  A request is approved either by a person with the right role, or by a
  standing authorisation that an owner or admin switched on for a channel. Both
  are written to the request's audit trail.
*/
import { CHANNELS } from './notify.js'
import { randomToken } from './crypto.js'

const EXPIRY_MS = 7 * 86_400_000
export const APPROVAL_TYPES = { slack_message: { channel: 'slack', label: 'Send a Slack message' }, teams_message: { channel: 'teams', label: 'Send a Microsoft Teams message' } }
export const canDecide = (role) => role === 'owner' || role === 'admin'

export class ApprovalError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}

export function createApprovals({ store, notifier, integrations }) {
  const deciding = new Set()
  const stamp = () => new Date().toISOString()
  const audit = (approval, actor, event, note) => ({ ...approval, audit: [...(approval.audit ?? []), { at: stamp(), actor, event, ...(note ? { note: String(note).slice(0, 300) } : {}) }] })
  const save = (tenant, approval) => store.put(tenant, 'approval_requests', approval)

  async function list(tenant) {
    const all = await store.list(tenant, 'approval_requests')
    const cutoff = Date.now() - EXPIRY_MS
    for (const a of all) {
      if (a.status === 'pending' && Date.parse(a.createdAt) < cutoff) Object.assign(a, await save(tenant, audit({ ...a, status: 'expired' }, 'system', 'expired', 'No decision within 7 days.')))
    }
    return [...all].reverse()
  }

  /** The only function that performs an approved action. */
  async function execute(tenant, approval) {
    if (approval.status !== 'approved') throw new ApprovalError('This action has not been approved.', 403)
    const type = APPROVAL_TYPES[approval.type]
    if (!type) throw new ApprovalError('Unknown action type.', 400)
    if ((await integrations.statusOf(tenant, type.channel)) !== 'connected') {
      const note = `${CHANNELS[type.channel]} is not connected, so nothing was sent. Connect it in Integrations to deliver approved messages.`
      return save(tenant, audit({ ...approval, status: 'not_sent', result: { status: 'not_sent', detail: note }, executedAt: stamp() }, 'system', 'not_sent', note))
    }
    const delivery = await notifier.deliver(tenant, { channel: type.channel, message: approval.action.message, dedupeKey: approval.dedupeKey, approvalId: approval.id, actor: approval.decidedBy })
    const status = delivery.status === 'failed' ? 'failed' : 'executed'
    const note = delivery.status === 'sent' ? `Delivered to ${delivery.destination}.` : delivery.detail
    return save(tenant, audit({ ...approval, status, result: { deliveryId: delivery.id, status: delivery.status, detail: note }, executedAt: stamp() }, 'system', delivery.status === 'sent' ? 'executed' : delivery.status, note))
  }

  /**
   * Files a request. Asking twice for the same thing returns the first request,
   * so a repeated monitor run or a looping agent cannot pile up duplicates.
   */
  async function request(tenant, { type, title, message, reasoning, data = {}, consequences, createdBy, dedupeKey = null, runId = null, alertId = null }) {
    const def = APPROVAL_TYPES[type]
    if (!def) throw new ApprovalError('Unknown action type.', 400)
    // Without a connected channel the request is still filed, as a preview: approving it sends nothing.
    const connected = (await integrations.statusOf(tenant, def.channel)) === 'connected'
    if (dedupeKey) {
      const existing = (await store.list(tenant, 'approval_requests')).find((a) => a.type === type && a.dedupeKey === dedupeKey && ['pending', 'approved', 'executed', 'not_sent'].includes(a.status))
      if (existing) return { approval: existing, duplicate: true }
    }
    let approval = audit(
      {
        id: randomToken(9), type, status: 'pending', title: String(title).slice(0, 160),
        action: { channel: def.channel, label: def.label, message, preview: !connected },
        reasoning: String(reasoning ?? '').slice(0, 1200),
        data,
        consequences: consequences ?? `One message is posted to ${CHANNELS[def.channel]}, visible to everyone in that destination. Nothing else changes: no order, payment or record is created.`,
        createdBy, createdAt: stamp(), dedupeKey, runId, alertId,
      },
      createdBy, 'requested',
    )
    await save(tenant, approval)

    const prefs = await notifier.preferences(tenant, def.channel)
    if (prefs.autoSend && prefs.enabled && prefs.categories[message.category] !== false) {
      approval = audit({ ...approval, status: 'approved', decidedBy: `standing authorisation (${prefs.authorizedBy})`, decidedAt: stamp() }, 'policy', 'approved', `Automatic sending was authorised for ${CHANNELS[def.channel]} by ${prefs.authorizedBy} on ${prefs.authorizedAt}.`)
      await save(tenant, approval)
      approval = await execute(tenant, approval)
    }
    return { approval, duplicate: false }
  }

  async function decide(tenant, id, { decision, note, actor, role }) {
    const lock = `${tenant}:${id}`
    if (deciding.has(lock)) throw new ApprovalError('A decision is already in progress.', 409)
    deciding.add(lock)
    try {
    if (!canDecide(role)) throw new ApprovalError('Only an owner or admin can approve or reject actions.', 403)
    if (decision !== 'approve' && decision !== 'reject') throw new ApprovalError('decision must be "approve" or "reject".', 400)
    const approval = (await list(tenant)).find((a) => a.id === id)
    if (!approval) throw new ApprovalError('Approval request not found.', 404)
    if (approval.status !== 'pending') throw new ApprovalError(`This request is already ${approval.status}.`, 409)
    if (decision === 'reject') return save(tenant, audit({ ...approval, status: 'rejected', decidedBy: actor, decidedAt: stamp() }, actor, 'rejected', note))
    const approved = await save(tenant, audit({ ...approval, status: 'approved', decidedBy: actor, decidedAt: stamp() }, actor, 'approved', note))
    return execute(tenant, approved)
    } finally { deciding.delete(lock) }
  }

  return { list, request, decide, execute, pendingCount: async (tenant) => (await list(tenant)).filter((a) => a.status === 'pending').length }
}
