import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePeers, parseRadioState } from '../src/lib/meshCodec.ts'

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
