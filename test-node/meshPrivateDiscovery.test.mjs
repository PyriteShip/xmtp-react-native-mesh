import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  normalizeAccountKey,
  parseContacts,
  parsePairingState,
  parseRestoreWindow,
} from '../src/lib/meshCodec.ts'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('parsePairingState maps pending pairings and refusals', () => {
  const s = parsePairingState(
    '{"on":true,"pending":[{"peerId":"p#3","code":"042917","confirmed":true,"peerConfirmed":false}],"refusals":[{"peerId":"p#4","code":"111111","conflictingInboxId":"inbox-m"}],"attemptsExhausted":1}'
  )
  assert.deepEqual(s, {
    on: true,
    pending: [{ peerId: 'p#3', code: '042917', confirmed: true, peerConfirmed: false }],
    refusals: [{ peerId: 'p#4', code: '111111', conflictingInboxId: 'inbox-m' }],
    attemptsExhausted: 1,
  })
})

test('parsePairingState drops malformed entries and reads stopped as null', () => {
  assert.equal(parsePairingState('null'), null)
  assert.equal(parsePairingState('garbage'), null)
  const s = parsePairingState('{"on":"yes","pending":[{"peerId":"p#1","code":"12345"},{"code":"123456"}],"refusals":[{"peerId":"p#2"}]}')
  assert.deepEqual(s, { on: false, pending: [], refusals: [], attemptsExhausted: 0 })
})

test('parseContacts maps contacts and drops bad rows', () => {
  assert.deepEqual(parseContacts('[{"inboxId":"a","generation":2,"autoAdded":true},{"generation":1},{"inboxId":"a","generation":3}]'), [
    { inboxId: 'a', generation: 2, autoAdded: true },
  ])
  assert.equal(parseContacts('null'), null)
})

test('parseRestoreWindow reads the end or null', () => {
  assert.equal(parseRestoreWindow('{"until":1790000000}'), 1790000000)
  assert.equal(parseRestoreWindow('{"until":null}'), null)
  assert.equal(parseRestoreWindow('bad'), null)
})

test('normalizeAccountKey accepts 32-byte hex only', () => {
  const k = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  assert.equal(normalizeAccountKey(k), k)
  assert.equal(normalizeAccountKey('0x' + k.toUpperCase()), k)
  assert.equal(normalizeAccountKey(k.slice(2)), null)
  assert.equal(normalizeAccountKey(undefined), null)
})

test('meshStart hands the account key and the restore flag to the native module', () => {
  const mod = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/XMTPModule.kt')
  assert.match(mod, /AsyncFunction\("meshStart"\) Coroutine \{ installationId: String, relay: Boolean, accountKeyHex: String, beginRestoreWindow: Boolean ->/)
  for (const fn of ['meshPairingState', 'meshConfirmPairing', 'meshRejectPairing', 'meshContacts', 'meshRemoveContact', 'meshForgetContact', 'meshResetDiscoveryKey', 'meshRestoreWindow', 'meshEndRestoreWindow', 'meshConfirmRestoredContact']) {
    assert.match(mod, new RegExp(`Function\\("${fn}"\\)`), fn)
  }
  const bridge = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt')
  assert.match(bridge, /accountKey\.fill\(0\)/)
  assert.match(bridge, /E_MESH_NOT_RUNNING/)
})

test('the JS API guards Android and exports the types', () => {
  const mesh = read('../src/lib/Mesh.ts')
  for (const fn of ['pairingState', 'confirmPairing', 'rejectPairing', 'contacts', 'removeContact', 'forgetContact', 'resetDiscoveryKey', 'restoreWindowUntil', 'endRestoreWindow', 'confirmRestoredContact']) {
    assert.match(mesh, new RegExp(`${fn}\\([^)]*\\)[^{]*\\{\\s*assertAndroid\\(\\)`), fn)
  }
  const index = read('../src/index.ts')
  for (const t of ['MeshPairingState', 'MeshPendingPairing', 'MeshPairingRefusal', 'MeshContact']) assert.match(index, new RegExp(t), t)
})
