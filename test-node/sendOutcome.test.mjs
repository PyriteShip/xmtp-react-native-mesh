import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSendError, isSyncFailedToWait, prepareThenPublish } from '../src/lib/sendOutcome.ts'

const WIRE = '[GroupError::SyncFailedToWait] Sync failed to wait for intent'

test('recognises the error code and the message text', () => {
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

test('SyncFailedToWait resolves as queued with the stored message id (DESIGN.md §B5.5)', async () => {
  const r = await prepareThenPublish(async () => 'm2', async () => { throw new Error(WIRE) })
  assert.deepEqual(r, { id: 'm2', status: 'queued' })
})

test('a different publish error still rejects', async () => {
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

// Once prepare succeeded, the message is stored Unpublished and a later publish may still send
// it, so a rejection must carry its id for reconciliation.
test('a non-SyncFailedToWait publish error carries the prepared messageId', async () => {
  const err = await prepareThenPublish(async () => 'm4', async () => {
    throw new Error('[GroupError::GroupInactive] Group is inactive')
  }).then(
    () => assert.fail('must reject'),
    (e) => e,
  )
  assert.match(err.message, /GroupInactive/)
  assert.equal(err.messageId, 'm4')
  assert.equal(isSendError(err), true)
})

test('a non-Error publish rejection is wrapped so it can carry the messageId', async () => {
  const err = await prepareThenPublish(async () => 'm5', async () => {
    throw 'boom'
  }).then(
    () => assert.fail('must reject'),
    (e) => e,
  )
  assert.equal(isSendError(err), true)
  assert.equal(err.messageId, 'm5')
  assert.match(err.message, /boom/)
})

test('isSendError is false for anything without a string messageId', () => {
  assert.equal(isSendError(new Error('x')), false)
  assert.equal(isSendError(null), false)
  assert.equal(isSendError('m1'), false)
  assert.equal(isSendError(Object.assign(new Error('x'), { messageId: 7 })), false)
})

test('a prepare failure carries no messageId (nothing was stored)', async () => {
  const err = await prepareThenPublish(async () => {
    throw new Error('Codec type is not registered')
  }, async () => {}).then(
    () => assert.fail('must reject'),
    (e) => e,
  )
  assert.equal(isSendError(err), false)
})
