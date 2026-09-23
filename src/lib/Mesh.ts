import { Subscription } from 'expo-modules-core'
import { Platform } from 'react-native'

import type { InstallationId } from './Client'
import {
  BluetoothStatus,
  MeshPeer,
  MeshRadioState,
  isValidInstallationId,
  parseBluetoothStatus,
  parsePeers,
  parseRadioState,
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
 * package arrives never includes the peer (sub-project 2, final review I2).
 */
export const Mesh = {
  isSupported(): boolean {
    return Platform.OS === 'android'
  },

  /**
   * Idempotent for the same client. A new client object for the installation the
   * radio already serves (e.g. after a JS reload) rebinds the radio to it; a
   * different installation rejects with code `E_MESH_BUSY` until `stop()`.
   */
  async start(installationId: InstallationId | string): Promise<void> {
    assertAndroid()
    await XMTPModule.meshStart(installationId as InstallationId)
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

  /** Advertise the pairing-mode flag (spec §6) while an Add-contact screen is open. */
  setPairingMode(enabled: boolean): void {
    assertAndroid()
    XMTPModule.meshSetPairingMode(enabled)
  },

  /**
   * True once the local mesh node holds a valid key package for that installation.
   * Rejects with code `E_BAD_INSTALLATION_ID` if `peerInstallationId` is not 32-byte hex
   * (Task 8 review, Ruling 7) — validated here so a bad id never reaches native code, and
   * again there (MeshBridge.canMessage) as the ultimate guard.
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
}
