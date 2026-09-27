import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseRelayState, parseRelayStats } from '../src/lib/meshCodec.ts'

test('parseRelayState reads the bridge JSON and defaults safely', () => {
  assert.deepEqual(
    parseRelayState('{"userEnabled":true,"pausedForBattery":false,"active":true}'),
    { userEnabled: true, pausedForBattery: false, active: true }
  )
  assert.deepEqual(parseRelayState('garbage'), {
    userEnabled: true,
    pausedForBattery: false,
    active: false,
  })
})

test('parseRelayStats maps counters and returns null for none', () => {
  const s = parseRelayStats(
    '{"accepted":3,"duplicate":0,"droppedInvalid":0,"droppedExpired":0,"droppedShare":1,"droppedRate":2,"pushed":9,"originated":4,"delivered":2,"deliveredUnspooled":1,"refsSent":1}'
  )
  assert.equal(s.accepted, 3)
  assert.equal(s.deliveredUnspooled, 1)
  assert.equal(parseRelayStats('null'), null)
  assert.equal(parseRelayStats(''), null)
})

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('the native module exposes the relay functions and event', () => {
  const mod = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/XMTPModule.kt')
  assert.match(mod, /AsyncFunction\("meshStart"\) Coroutine \{ installationId: String, relay: Boolean ->/)
  assert.match(mod, /AsyncFunction\("meshSetRelayEnabled"\)/)
  assert.match(mod, /Function\("meshRelayState"\)/)
  assert.match(mod, /Function\("meshRelayStats"\)/)
  assert.match(mod, /MeshBridge\.EVENT_RELAY/)
})

test('the bridge watches Mesh.relay and resets it on stop', () => {
  const bridge = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt')
  assert.match(bridge, /Mesh\.relay\.collect/)
  assert.match(bridge, /const val EVENT_RELAY = "meshRelay"/)
  assert.match(bridge, /Mesh\.start\(app, client, options, relay = relay\)/)
})

test('the AAR pin is mesh.10', () => {
  assert.match(read('../android/build.gradle'), /org\.xmtp:android:4\.10\.0-rc2-mesh\.10"/)
})
