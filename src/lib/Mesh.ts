import { Subscription } from 'expo-modules-core'
import { Platform } from 'react-native'

import type { InstallationId } from './Client'
import {
  BluetoothStatus,
  MeshPeer,
  MeshRadioState,
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
 * Deleting the client's local database stops it and moves the next client to a
 * fresh node database; `resetNode` does the same when no client exists.
 *
 * Before creating a DM with a nearby peer, wait for it in `peers()` AND for
 * `canMessage(me, peer.installationId)`: a DM created before the peer's key
 * package arrives never includes the peer (sub-project 2, final review I2).
 */
export const Mesh = {
  isSupported(): boolean {
    return Platform.OS === 'android'
  },

  async start(installationId: InstallationId | string): Promise<void> {
    assertAndroid()
    await XMTPModule.meshStart(installationId as InstallationId)
  },

  async stop(): Promise<void> {
    assertAndroid()
    await XMTPModule.meshStop()
  },

  async resetNode(): Promise<void> {
    assertAndroid()
    await XMTPModule.meshResetNode()
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

  /** True once the local mesh node holds a valid key package for that installation. */
  async canMessage(
    installationId: InstallationId | string,
    peerInstallationId: string
  ): Promise<boolean> {
    assertAndroid()
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
