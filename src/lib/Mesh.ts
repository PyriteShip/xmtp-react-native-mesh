import { Subscription } from 'expo-modules-core'
import { Platform } from 'react-native'

import type { InstallationId } from './Client'
import {
  BluetoothStatus,
  MeshContact,
  MeshIdentityEvent,
  MeshPairingState,
  MeshPeer,
  MeshRadioState,
  MeshRelayState,
  MeshRelayStats,
  MeshStats,
  isValidInstallationId,
  normalizeAccountKey,
  parseBluetoothStatus,
  parseContacts,
  parseIdentityEvent,
  parseMeshStats,
  parsePairingState,
  parsePeers,
  parseRadioState,
  parseRelayState,
  parseRelayStats,
  parseRestoreWindow,
  parseStrings,
} from './meshCodec'
import { MESH_UNSUPPORTED_MESSAGE } from './meshSupport'
import * as XMTPModule from '../index'

function assertAndroid(): void {
  if (Platform.OS !== 'android') throw new Error(MESH_UNSUPPORTED_MESSAGE)
}

/**
 * The Bluetooth mesh radio for a client created with env 'mesh' (Android only).
 * Start it from the foreground after the client is ready and the runtime
 * permissions in `requestedPermissions()` are granted; `start` is idempotent.
 * The mesh node database is per inbox and follows that inbox's libxmtp database:
 * a client whose database does not exist yet (a new installation) gets a fresh
 * node on its own, and deleting the client's local database stops the radio and
 * rotates that inbox's node. `resetNode` is for recovery only.
 *
 * Before creating a DM with a nearby peer, wait for it in `peers()` AND for
 * `canMessage(me, peer.installationId)`: a DM created before the peer's key
 * package arrives never includes the peer.
 */
export const Mesh = {
  isSupported(): boolean {
    return Platform.OS === 'android'
  },

  /**
   * Idempotent for the same client. A new client object for the installation the
   * radio already serves (e.g. after a JS reload) rebinds the radio to it; a
   * different installation rejects with code `E_MESH_BUSY` until `stop()`.
   * `accountKey`: the account's 32-byte private key as hex (the key the recovery phrase
   * restores); the node derives its link keys from it and keeps only those. Anything else
   * rejects with `E_MESH_BAD_ACCOUNT_KEY`. `beginRestoreWindow`: true on the first start after
   * a restore from the recovery phrase, so contacts reconnect by themselves for 72 hours.
   */
  async start(
    installationId: InstallationId | string,
    options: { relay?: boolean; accountKey: string; beginRestoreWindow?: boolean }
  ): Promise<void> {
    assertAndroid()
    const key = normalizeAccountKey(options?.accountKey)
    if (!key) {
      throw Object.assign(new Error('accountKey must be a 32-byte hex private key'), { code: 'E_MESH_BAD_ACCOUNT_KEY' })
    }
    await XMTPModule.meshStart(installationId as InstallationId, options.relay ?? true, key, options.beginRestoreWindow ?? false)
  },

  /** The user's relay choice; applies to a running radio at once (no restart). */
  async setRelayEnabled(enabled: boolean): Promise<void> {
    assertAndroid()
    await XMTPModule.meshSetRelayEnabled(enabled)
  },

  relayState(): MeshRelayState {
    assertAndroid()
    return parseRelayState(XMTPModule.meshRelayStateJson())
  },

  /** Counters since the relay engine started; null while stopped. */
  relayStats(): MeshRelayStats | null {
    assertAndroid()
    return parseRelayStats(XMTPModule.meshRelayStatsJson())
  },

  /**
   * Signed-sequencing counters (order checks) since the node was opened; null while
   * stopped. A snapshot: call it when you need it, don't poll.
   */
  stats(): MeshStats | null {
    assertAndroid()
    return parseMeshStats(XMTPModule.meshStatsJson())
  },

  async stop(): Promise<void> {
    assertAndroid()
    await XMTPModule.meshStop()
  },

  /**
   * Recovery only: stops the radio and moves `inboxId`'s node (every inbox's when
   * omitted) to a fresh database. Never needed for correctness, and harmful when
   * the inbox's libxmtp database is kept: that installation then reopens on an
   * empty node that does not know it.
   */
  async resetNode(inboxId?: string): Promise<void> {
    assertAndroid()
    await XMTPModule.meshResetNode(inboxId)
  },

  /** Verified peers now; `peerId` is connection-scoped, so group by `inboxId`. */
  peers(): MeshPeer[] {
    assertAndroid()
    return parsePeers(XMTPModule.meshPeersJson())
  },

  radioState(): MeshRadioState {
    assertAndroid()
    return parseRadioState(XMTPModule.meshRadioStateJson())
  },

  /**
   * Pairing mode (the libxmtp fork's DESIGN.md §B14.4): advertise the pairing flag and accept
   * pairing links while the in-person pairing screen is open. The node also leaves it by itself
   * after a pairing or 5 unfinished ones.
   */
  setPairingMode(enabled: boolean): void {
    assertAndroid()
    XMTPModule.meshSetPairingMode(enabled)
  },

  /** Pairing mode, open pairings with their codes, and refusals; null while stopped. Poll while the pairing screen is open. */
  pairingState(): MeshPairingState | null {
    assertAndroid()
    return parsePairingState(XMTPModule.meshPairingStateJson())
  },

  /** The person compared the codes and they match. */
  confirmPairing(peerId: string): void {
    assertAndroid()
    XMTPModule.meshConfirmPairing(peerId)
  },

  /** The codes differ, or the person declined. */
  rejectPairing(peerId: string): void {
    assertAndroid()
    XMTPModule.meshRejectPairing(peerId)
  },

  /** Contacts this phone recognises nearby; null while stopped. */
  contacts(): MeshContact[] | null {
    assertAndroid()
    return parseContacts(XMTPModule.meshContactsJson())
  },

  /** Stop recognising and accepting this contact, and close its links. */
  removeContact(inboxId: string): boolean {
    assertAndroid()
    return XMTPModule.meshRemoveContact(inboxId)
  },

  /** Remove and forget completely, so a key this contact claimed is free for someone else. */
  forgetContact(inboxId: string): boolean {
    assertAndroid()
    return XMTPModule.meshForgetContact(inboxId)
  },

  /** A new discovery key: people you removed stop recognising this phone. Returns the new generation. */
  resetDiscoveryKey(): number {
    assertAndroid()
    return XMTPModule.meshResetDiscoveryKey()
  },

  /** The restore window's end (unix seconds), or null. */
  restoreWindowUntil(): number | null {
    assertAndroid()
    return parseRestoreWindow(XMTPModule.meshRestoreWindowJson())
  },

  endRestoreWindow(): void {
    assertAndroid()
    XMTPModule.meshEndRestoreWindow()
  },

  /** Keep a contact the restore window added back: it gets this phone's card from now on. */
  confirmRestoredContact(inboxId: string): boolean {
    assertAndroid()
    return XMTPModule.meshConfirmRestoredContact(inboxId)
  },

  /**
   * True once the local mesh node holds a valid key package for that installation.
   * Rejects with code `E_BAD_INSTALLATION_ID` if `peerInstallationId` is not 32-byte hex —
   * validated here so a bad id never reaches native code, and again there
   * (MeshBridge.canMessage) as the ultimate guard.
   */
  async canMessage(
    installationId: InstallationId | string,
    peerInstallationId: string
  ): Promise<boolean> {
    assertAndroid()
    if (!isValidInstallationId(peerInstallationId)) {
      throw Object.assign(
        new Error(`Not a 32-byte hex installation id: ${peerInstallationId}`),
        { code: 'E_BAD_INSTALLATION_ID' }
      )
    }
    return await XMTPModule.meshCanMessage(
      installationId as InstallationId,
      peerInstallationId
    )
  },

  /** Adapter state and the runtime permissions still missing. Also starts adapter events. */
  bluetoothStatus(): BluetoothStatus {
    assertAndroid()
    return parseBluetoothStatus(XMTPModule.meshBluetoothStatusJson())
  },

  /** What onboarding should request (radio permissions plus POST_NOTIFICATIONS on 33+). */
  requestedPermissions(): string[] {
    assertAndroid()
    return parseStrings(XMTPModule.meshRequestedPermissionsJson())
  },

  addPeersListener(cb: (peers: MeshPeer[]) => void): Subscription {
    return XMTPModule.emitter.addListener('meshPeers', (e: { json: string }) =>
      cb(parsePeers(e?.json))
    )
  },

  addRadioListener(cb: (state: MeshRadioState) => void): Subscription {
    return XMTPModule.emitter.addListener('meshRadio', (e: { json: string }) =>
      cb(parseRadioState(e?.json))
    )
  },

  addBluetoothListener(cb: (status: BluetoothStatus) => void): Subscription {
    return XMTPModule.emitter.addListener(
      'bluetoothState',
      (e: { json: string }) => cb(parseBluetoothStatus(e?.json))
    )
  },

  addRelayListener(cb: (state: MeshRelayState) => void): Subscription {
    return XMTPModule.emitter.addListener('meshRelay', (e: { json: string }) =>
      cb(parseRelayState(e?.json))
    )
  },

  /**
   * Restore convergence: the node replaced an inbox's identity log and the client reloaded it.
   * 'rebaseNeeded': this installation is not in its inbox's winning log; call
   * `client.meshRebaseInstallation(signer)`. 'tooManyInstallations': the winning log is full.
   * The latest event is replayed after `start`. Malformed events are dropped.
   */
  addIdentityListener(cb: (event: MeshIdentityEvent) => void): Subscription {
    return XMTPModule.emitter.addListener('meshIdentity', (e: { json: string }) => {
      const event = parseIdentityEvent(e?.json)
      if (event) cb(event)
    })
  },
}
