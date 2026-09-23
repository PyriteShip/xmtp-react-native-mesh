import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MESH_FORK_VERSION,
  MESH_UNSUPPORTED_MESSAGE,
  assertMeshSupported,
} from '../src/lib/meshSupport.ts'

test('names the fork version', () => {
  assert.equal(MESH_FORK_VERSION, '5.7.0-mesh.1')
})

test("'mesh' is allowed on Android", () => {
  assert.doesNotThrow(() => assertMeshSupported('mesh', 'android'))
})

test("'mesh' throws on iOS and web instead of reaching native code (spec §8)", () => {
  assert.throws(() => assertMeshSupported('mesh', 'ios'), { message: MESH_UNSUPPORTED_MESSAGE })
  assert.throws(() => assertMeshSupported('mesh', 'web'), { message: MESH_UNSUPPORTED_MESSAGE })
  assert.equal(MESH_UNSUPPORTED_MESSAGE, "XMTP env 'mesh' is supported on Android only")
})

test('other environments are untouched on every platform', () => {
  for (const env of ['dev', 'production', 'local']) {
    for (const os of ['android', 'ios']) assert.doesNotThrow(() => assertMeshSupported(env, os))
  }
})
