// Settings → Company Branding: display name, logo and optional details, stored on the server per workspace.
import { useEffect, useState } from 'react'
import { Card, Notice, TextInput, useToast } from '../../../components/app/kit.jsx'
import { Button, Icon, Logo } from '../../../components/ui.jsx'
import { useBranding } from '../../../state/branding.js'
import { useWorkspace } from '../../../state/WorkspaceContext.jsx'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
const MAX_UPLOAD = 2 * 1024 * 1024
const MAX_SIDE = 512

/**
 * Checks the file, decodes it (a damaged image fails here), and re-encodes it as a PNG no larger
 * than 512 px. Re-encoding drops metadata and anything that is not pixels.
 */
export async function prepareLogo(file) {
  if (!file) throw new Error('Choose an image file.')
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a PNG, JPEG or WebP image. SVG and other formats are not accepted.')
  if (file.size > MAX_UPLOAD) throw new Error('The image is larger than 2 MB. Use a smaller file.')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('The image could not be read. It may be damaged.')
  }
  if (!bitmap.width || !bitmap.height) throw new Error('The image has no visible size.')
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const png = canvas.toDataURL('image/png')
  // Photographic logos compress far better as WebP; use it when it is smaller.
  const webp = canvas.toDataURL('image/webp', 0.9)
  const best = webp.startsWith('data:image/webp') && webp.length < png.length ? webp : png
  if (best.length > 680_000) throw new Error('The logo is still too large after resizing. Use a simpler image.')
  return best
}

export default function BrandingTab() {
  const { ws } = useWorkspace()
  const branding = useBranding()
  const toast = useToast()
  const [form, setForm] = useState({ displayName: '', tagline: '', website: '' })
  const [logo, setLogo] = useState(undefined) // undefined = unchanged, null = remove, string = new
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({ displayName: branding.data?.displayName ?? '', tagline: branding.data?.tagline ?? '', website: branding.data?.website ?? '' })
    setLogo(undefined)
  }, [branding.data])

  const preview = logo === undefined ? branding.data?.logo : logo
  const name = form.displayName.trim() || ws.company.name
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const choose = async (file) => {
    setError('')
    try {
      setLogo(await prepareLogo(file))
    } catch (err) {
      setError(err.message)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await branding.save({ ...form, ...(logo !== undefined ? { logo } : {}) })
      toast('Company branding saved')
    } catch (err) {
      setError(err.status === 403 ? 'Only an owner or admin can change company branding.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card title="Branding details" subtitle="Shown beside Waymark branding. It never replaces the Waymark design.">
        {branding.status === 'error' && <Notice tone="warn" className="mb-3">Branding is stored on the Waymark server, which could not be reached: {branding.error}</Notice>}
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Company display name" hint={`Leave blank to use “${ws.company.name}”.`} maxLength={80} value={form.displayName} onChange={set('displayName')} />
            <TextInput label="Tagline" optional maxLength={140} value={form.tagline} onChange={set('tagline')} />
            <TextInput label="Website" optional type="url" placeholder="https://example.com" maxLength={200} value={form.website} onChange={set('website')} />
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-navy">Company logo</legend>
            <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB. It is resized to 512 px and checked again by the server.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-navy hover:bg-slate-50 focus-within:outline-2 focus-within:outline-brand-500">
                <Icon name="upload" className="h-4 w-4" /> {preview ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept={ACCEPTED.join(',')} className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {preview && <Button type="button" size="sm" variant="secondary" onClick={() => setLogo(null)}><Icon name="trash" className="h-4 w-4" /> Remove logo</Button>}
              {logo !== undefined && <span className="text-xs text-amber-700">Unsaved change</span>}
            </div>
          </fieldset>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save branding'}</Button>
          {branding.data?.updatedAt && <p className="text-xs text-slate-500">Last changed {new Date(branding.data.updatedAt).toLocaleString()}.</p>}
        </form>
      </Card>
      <Card title="Preview" subtitle="Where your branding appears">
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Logo tone="light" />
            <span className="h-6 border-s border-slate-300" />
            {preview ? <img src={preview} alt="Company logo preview" className="h-8 max-w-24 rounded bg-white object-contain p-0.5" /> : <Icon name="image" className="h-6 w-6 text-slate-400" />}
            <span className="truncate text-sm font-bold text-navy">{name}</span>
          </div>
          <ul className="space-y-1 text-xs text-slate-600">
            <li>· Top bar and Command Center</li>
            <li>· Generated PDF and print reports</li>
            <li>· Email alert header</li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
