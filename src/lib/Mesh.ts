import { Platform } from 'react-native'

import type { InstallationId } from './Client'
import {
  MeshPeer,
  MeshRadioState,
  parsePeers,
  parseRadioState,
} from './meshCodec'
import { MESH_UNSUPPORTED_MESSAGE } from './meshSupport'
import * as XMTPModule from '../index'

function assertAndroid(): void {
  if (Platform.OS !== 'android') throw new Error(MESH_UNSUPPORTED_MESSAGE)
}

/**
 * The Bluetooth mesh radio for a client created with env 'mesh' (Android only).
 * Start it from the foreground after the client is ready and the Bluetooth
 * runtime permissions are granted. `start` is idempotent. Deleting the client's
 * local database stops it and moves the next client to a fresh node database;
 * `resetNode` does the same when no client exists.
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

  /** Verified peers now (installation proved inbox membership); group by inboxId. */
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
}
