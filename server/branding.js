/*
  Company branding: a display name, an optional logo and optional contact details.

  Stored server-side per tenant (store collection "platform_settings", id "branding"),
  so it follows the company across browsers and is available to reports and email.
  Only owners and admins can change it.

  The logo is accepted only as a PNG, JPEG or WebP data URL. The declared type must
  match the file's own signature, the decoded size is capped, and SVG (which can carry
  script) is refused outright. The browser re-encodes uploads before sending them,
  but the server does not rely on that.
*/
export const MAX_LOGO_BYTES = 512 * 1024
const SIGNATURES = {
  png: (b) => b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52,
  jpeg: (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
}

export class BrandingError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** Returns a clean data URL, or throws a BrandingError explaining what is wrong. */
export function validateLogo(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl ?? ''))
  if (!match) throw new BrandingError('The logo must be a PNG, JPEG or WebP image. SVG and other formats are not accepted.')
  const [, type, payload] = match
  const bytes = Buffer.from(payload, 'base64')
  if (!bytes.length) throw new BrandingError('The logo file is empty.')
  if (bytes.length > MAX_LOGO_BYTES) throw new BrandingError(`The logo is larger than ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`)
  if (!SIGNATURES[type](bytes)) throw new BrandingError('The logo file is damaged or is not the image type it claims to be.')
  if (type === 'png') {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (!width || !height || width > 4096 || height > 4096) throw new BrandingError('The logo dimensions are not valid (maximum 4096 × 4096 pixels).')
  }
  return `data:image/${type};base64,${bytes.toString('base64')}`
}

function validWebsite(value) {
  const raw = text(value, 200)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error()
    return url.toString()
  } catch {
    throw new BrandingError('The website must be a full web address, for example https://example.com.')
  }
}

export function createBranding({ store }) {
  async function get(tenant) {
    const saved = await store.get(tenant, 'platform_settings', 'branding')
    return saved ? { displayName: saved.displayName ?? '', logo: saved.logo ?? null, website: saved.website ?? '', tagline: saved.tagline ?? '', updatedAt: saved.updatedAt ?? null, updatedBy: saved.updatedBy ?? null } : null
  }

  async function save(tenant, patch, actor) {
    const current = (await get(tenant)) ?? { displayName: '', logo: null, website: '', tagline: '' }
    const next = { ...current }
    if (patch.displayName !== undefined) next.displayName = text(patch.displayName, 80)
    if (patch.tagline !== undefined) next.tagline = text(patch.tagline, 140)
    if (patch.website !== undefined) next.website = validWebsite(patch.website)
    if (patch.logo === null) next.logo = null
    else if (patch.logo !== undefined) next.logo = validateLogo(patch.logo)
    await store.put(tenant, 'platform_settings', { id: 'branding', ...next, updatedAt: new Date().toISOString(), updatedBy: actor })
    return get(tenant)
  }

  return { get, save }
}
