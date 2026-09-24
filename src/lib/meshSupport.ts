/**
 * xmtp-mesh fork of @xmtp/react-native-sdk 5.7.0: XMTP over a Bluetooth mesh
 * (env 'mesh', Android only). package.json keeps "5.7.0" so hosts whose peer
 * range is ^5.7.0 still resolve it; this constant names the fork.
 *
 * No runtime imports: test-node/ loads this file directly with Node's type
 * stripping.
 */
export const MESH_FORK_VERSION = '5.7.0-mesh.1'

export const MESH_UNSUPPORTED_MESSAGE =
  "XMTP env 'mesh' is supported on Android only"

/**
 * Called before any native client creation. The iOS module has no mesh
 * transport and its env switch falls back to the dev network for unknown
 * names, so 'mesh' must never reach it (spec §8).
 */
export function assertMeshSupported(env: string, platformOs: string): void {
  if (env === 'mesh' && platformOs !== 'android') {
    throw new Error(MESH_UNSUPPORTED_MESSAGE)
  }
}
