import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSyncFailedToWait, prepareThenPublish } from '../src/lib/sendOutcome.ts'

const WIRE = '[GroupError::SyncFailedToWait] Sync failed to wait for intent'

test('recognises the error code and the message text (Review Focus 3)', () => {
  assert.equal(isSyncFailedToWait(new Error(WIRE)), true)
  assert.equal(isSyncFailedToWait(new Error('Sync failed to wait for intent')), true)
  assert.equal(isSyncFailedToWait(new Error('[ClientError::Group] [GroupError::SyncFailedToWait] x')), true)
  assert.equal(isSyncFailedToWait(WIRE), true)
  assert.equal(isSyncFailedToWait(new Error('[GroupError::GroupInactive] Group is inactive')), false)
  assert.equal(isSyncFailedToWait(null), false)
  assert.equal(isSyncFailedToWait({ message: 42 }), false)
})

test('a publish that succeeds is published', async () => {
  const r = await prepareThenPublish(async () => 'm1', async () => {})
  assert.deepEqual(r, { id: 'm1', status: 'published' })
})

test('SyncFailedToWait resolves as queued with the stored message id (spec §5)', async () => {
  const r = await prepareThenPublish(async () => 'm2', async () => { throw new Error(WIRE) })
  assert.deepEqual(r, { id: 'm2', status: 'queued' })
})

test('a different publish error still rejects (Review Focus 3)', async () => {
  await assert.rejects(
    prepareThenPublish(async () => 'm3', async () => { throw new Error('[GroupError::GroupInactive] Group is inactive') }),
    /GroupInactive/,
  )
})

test('a prepare failure rejects before publishing', async () => {
  let published = false
  await assert.rejects(
    prepareThenPublish(async () => { throw new Error('Codec type is not registered') }, async () => { published = true }),
    /Codec type/,
  )
  assert.equal(published, false)
})
