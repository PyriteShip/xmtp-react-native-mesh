/**
 * Parsers for the JSON strings the Android mesh bridge returns and emits
 * (MeshJson.kt). Malformed input never throws: a bad entry is dropped and a bad
 * document reads as the empty/"down" value. No runtime imports (see
 * test-node/).
 */
export interface MeshPeer {
  /** Connection-scoped id ("<shortId>#<n>"); never key contacts by it. */
  peerId: string
  inboxId: string
  /** Lowercase hex, no 0x. */
  installationId: string
}

export interface MeshRadioState {
  /** Advertising and scanning. False while Bluetooth is off or the radio is stopped. */
  up: boolean
  /** The foreground service holds foreground status (background delivery works). */
  foreground: boolean
}

export type BluetoothAdapterState = 'on' | 'off' | 'unsupported'

export interface BluetoothStatus {
  adapter: BluetoothAdapterState
  /** Runtime permissions the radio needs that are not granted yet. */
  missingPermissions: string[]
}

const HEX = /^[0-9a-f]+$/

function parse(json: unknown): unknown {
  if (typeof json !== 'string' || json === '') return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

export function parsePeers(json: unknown): MeshPeer[] {
  const doc = parse(json)
  if (!Array.isArray(doc)) return []
  const seen = new Set<string>()
  const peers: MeshPeer[] = []
  for (const raw of doc) {
    if (typeof raw !== 'object' || raw === null) continue
    const { peerId, inboxId, installationId } = raw as Record<string, unknown>
    if (
      !nonEmptyString(peerId) ||
      !nonEmptyString(inboxId) ||
      !nonEmptyString(installationId)
    )
      continue
    const hex = installationId.toLowerCase()
    if (!HEX.test(hex) || seen.has(peerId)) continue
    seen.add(peerId)
    peers.push({ peerId, inboxId, installationId: hex })
  }
  return peers
}

export function parseRadioState(json: unknown): MeshRadioState {
  const doc = parse(json)
  if (typeof doc !== 'object' || doc === null)
    return { up: false, foreground: false }
  const { up, foreground } = doc as Record<string, unknown>
  return { up: up === true, foreground: foreground === true }
}

export function parseBluetoothStatus(json: unknown): BluetoothStatus {
  const doc = parse(json)
  if (typeof doc !== 'object' || doc === null)
    return { adapter: 'unsupported', missingPermissions: [] }
  const { adapter, missingPermissions } = doc as Record<string, unknown>
  const state: BluetoothAdapterState =
    adapter === 'on' || adapter === 'off' ? adapter : 'unsupported'
  return {
    adapter: state,
    missingPermissions: parseStrings(JSON.stringify(missingPermissions ?? [])),
  }
}

export function parseStrings(json: unknown): string[] {
  const doc = parse(json)
  return Array.isArray(doc) ? doc.filter(nonEmptyString) : []
}
