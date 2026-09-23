import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePeers,
  parseRadioState,
  parseBluetoothStatus,
  parseStrings,
} from '../src/lib/meshCodec.ts'

const A = { peerId: 'a1b2c3d4e5f60718#1', inboxId: 'inbox-a', installationId: 'aa'.repeat(32) }

test('parses verified peers', () => {
  assert.deepEqual(parsePeers(JSON.stringify([A])), [A])
})

test('lowercases installation ids', () => {
  const upper = { ...A, installationId: 'AA'.repeat(32) }
  assert.equal(parsePeers(JSON.stringify([upper]))[0].installationId, 'aa'.repeat(32))
})

test('radio state defaults to down when absent or malformed', () => {
  assert.deepEqual(parseRadioState(JSON.stringify({ up: true, foreground: false })), { up: true, foreground: false })
  assert.deepEqual(parseRadioState(''), { up: false, foreground: false })
  assert.deepEqual(parseRadioState('{"up":"yes"}'), { up: false, foreground: false })
})

// Review Focus 4: the native side is trusted, but a listener must never throw on a bad payload.
test('drops malformed peers instead of throwing', () => {
  const json = JSON.stringify([
    A,
    { ...A, peerId: 'dup' },
    { ...A, peerId: 'dup', inboxId: 'inbox-b' },          // duplicate peerId: first wins
    { peerId: 'x#2', inboxId: 'inbox-c', installationId: 'not-hex' },
    { peerId: 'x#3', inboxId: '', installationId: 'ab' },
    null,
    42,
  ])
  assert.deepEqual(parsePeers(json).map((p) => p.peerId), [A.peerId, 'dup'])
  assert.deepEqual(parsePeers(''), [])
  assert.deepEqual(parsePeers('{not json'), [])
  assert.deepEqual(parsePeers('{"peers":[]}'), [])
  assert.deepEqual(parsePeers(undefined), [])
})

test('parses Bluetooth status and defaults safely', () => {
  assert.deepEqual(
    parseBluetoothStatus(JSON.stringify({ adapter: 'off', missingPermissions: ['android.permission.BLUETOOTH_SCAN'] })),
    { adapter: 'off', missingPermissions: ['android.permission.BLUETOOTH_SCAN'] },
  )
  assert.deepEqual(parseBluetoothStatus(JSON.stringify({ adapter: 'weird' })), { adapter: 'unsupported', missingPermissions: [] })
  assert.deepEqual(parseBluetoothStatus('nope'), { adapter: 'unsupported', missingPermissions: [] })
})

test('parses a permission list', () => {
  assert.deepEqual(parseStrings('["a","",3,"b"]'), ['a', 'b'])
  assert.deepEqual(parseStrings('{}'), [])
})
