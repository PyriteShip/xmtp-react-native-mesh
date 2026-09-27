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

/** 'noPermission': BluetoothAdapter.isEnabled() needs BLUETOOTH_CONNECT on API 31+. */
export type BluetoothAdapterState =
  | 'on'
  | 'off'
  | 'unsupported'
  | 'noPermission'

export interface BluetoothStatus {
  adapter: BluetoothAdapterState
  /** Runtime permissions the radio needs that are not granted yet. */
  missingPermissions: string[]
}

const HEX = /^[0-9a-f]+$/

/** A 32-byte installation id (XMTP's InstallationId), as 64 hex characters, either case. */
const INSTALLATION_ID_HEX = /^[0-9a-fA-F]{64}$/

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
    adapter === 'on' || adapter === 'off' || adapter === 'noPermission'
      ? adapter
      : 'unsupported'
  return {
    adapter: state,
    missingPermissions: parseStrings(JSON.stringify(missingPermissions ?? [])),
  }
}

export function parseStrings(json: unknown): string[] {
  const doc = parse(json)
  return Array.isArray(doc) ? doc.filter(nonEmptyString) : []
}

/**
 * True for a 32-byte installation id as hex (64 characters). `Mesh.canMessage` and the native
 * `meshCanMessage` both validate the peer id this way before it reaches `hexToByteArray`: a
 * bad id must reject with a clear error, not silently decode to garbage bytes and read back as
 * `false`.
 */
export function isValidInstallationId(hex: unknown): hex is string {
  return typeof hex === 'string' && INSTALLATION_ID_HEX.test(hex)
}

export interface MeshRelayState {
  /** The user's choice (Settings); on by default. */
  userEnabled: boolean
  /** Below 15% battery and not charging; resumes at 20% or when charging. */
  pausedForBattery: boolean
  /** The node is relaying now. */
  active: boolean
}

export interface MeshRelayStats {
  accepted: number
  duplicate: number
  droppedInvalid: number
  droppedExpired: number
  droppedShare: number
  droppedRate: number
  pushed: number
  originated: number
  delivered: number
  deliveredUnspooled: number
  refsSent: number
}

const RELAY_DEFAULT: MeshRelayState = { userEnabled: true, pausedForBattery: false, active: false }

export function parseRelayState(json: unknown): MeshRelayState {
  const v = parse(json) as Partial<Record<keyof MeshRelayState, unknown>> | undefined
  if (!v || typeof v !== 'object') return { ...RELAY_DEFAULT }
  return {
    userEnabled: typeof v.userEnabled === 'boolean' ? v.userEnabled : true,
    pausedForBattery: v.pausedForBattery === true,
    active: v.active === true,
  }
}

const STAT_KEYS: (keyof MeshRelayStats)[] = [
  'accepted', 'duplicate', 'droppedInvalid', 'droppedExpired', 'droppedShare',
  'droppedRate', 'pushed', 'originated', 'delivered', 'deliveredUnspooled', 'refsSent',
]

export function parseRelayStats(json: unknown): MeshRelayStats | null {
  const v = parse(json) as Record<string, unknown> | null | undefined
  if (!v || typeof v !== 'object') return null
  const out = {} as MeshRelayStats
  for (const k of STAT_KEYS) out[k] = typeof v[k] === 'number' ? (v[k] as number) : 0
  return out
}

/**
 * Signed-sequencing counters of the running node (the libxmtp fork's DESIGN.md §B13),
 * counted since the node was opened.
 */
export interface MeshStats {
  /** Rows this node signed: as it ordered them, or at start for rows it held unsigned. */
  seqRowsSigned: number
  /** Rows from other phones whose signature was checked and accepted. */
  seqRowsVerified: number
  /** Frames refused: a row had no signature. */
  seqRejectedMissingProof: number
  /** Frames refused: a signature did not match the row. */
  seqRejectedBadSignature: number
  /** Frames refused: signed by an installation that may not order this group. */
  seqRejectedWrongSigner: number
  /** Two different rows signed by one installation at the same place, kept as proof. */
  seqEquivocations: number
  /** Peers refused for speaking an older protocol version (mesh.10 syncs only with mesh.10). */
  peersRejectedVersion: number
}

const MESH_STAT_KEYS: (keyof MeshStats)[] = [
  'seqRowsSigned', 'seqRowsVerified', 'seqRejectedMissingProof', 'seqRejectedBadSignature',
  'seqRejectedWrongSigner', 'seqEquivocations', 'peersRejectedVersion',
]

export function parseMeshStats(json: unknown): MeshStats | null {
  const v = parse(json) as Record<string, unknown> | null | undefined
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {} as MeshStats
  for (const k of MESH_STAT_KEYS) {
    const n = v[k]
    out[k] = typeof n === 'number' && Number.isFinite(n) ? n : 0
  }
  return out
}

/** What the client did after the mesh node replaced an inbox's identity log (restore convergence). */
export type MeshIdentityOutcome = 'reloaded' | 'rebaseNeeded' | 'tooManyInstallations'

export interface MeshIdentityEvent {
  inboxId: string
  outcome: MeshIdentityOutcome
}

const IDENTITY_OUTCOMES: readonly MeshIdentityOutcome[] = [
  'reloaded',
  'rebaseNeeded',
  'tooManyInstallations',
]

export function parseIdentityEvent(json: unknown): MeshIdentityEvent | null {
  const doc = parse(json)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null
  const { inboxId, outcome } = doc as Record<string, unknown>
  if (!nonEmptyString(inboxId)) return null
  if (!IDENTITY_OUTCOMES.includes(outcome as MeshIdentityOutcome)) return null
  return { inboxId, outcome: outcome as MeshIdentityOutcome }
}
