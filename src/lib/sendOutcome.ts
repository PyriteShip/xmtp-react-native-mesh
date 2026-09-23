/**
 * Send, and say whether the message is on its way or only stored.
 *
 * libxmtp stores an outgoing message as Unpublished and marks it Published
 * only when a sync reads it back. `send` waits for that and fails with
 * SyncFailedToWait when it takes too long. On the Bluetooth mesh this is the
 * normal case for the side that is not the DM's sequencer (spec §5): the
 * message is stored and is delivered when the sequencer is reachable. So a
 * send is prepared (stored, id known) and then published, and SyncFailedToWait
 * reads as "queued". Any other publish error is a real failure and rejects.
 *
 * No runtime imports (test-node/ loads this file directly).
 */
export type SendStatus = 'published' | 'queued'

export interface SendResult<Id extends string = string> {
  id: Id
  status: SendStatus
}

const SYNC_FAILED_TO_WAIT = /SyncFailedToWait|Sync failed to wait for intent/

export function isSyncFailedToWait(err: unknown): boolean {
  const message =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null
        ? (err as { message?: unknown }).message
        : undefined
  return typeof message === 'string' && SYNC_FAILED_TO_WAIT.test(message)
}

export async function prepareThenPublish<Id extends string>(
  prepare: () => Promise<Id>,
  publish: () => Promise<unknown>
): Promise<SendResult<Id>> {
  const id = await prepare()
  try {
    await publish()
    return { id, status: 'published' }
  } catch (err) {
    if (isSyncFailedToWait(err)) return { id, status: 'queued' }
    throw err
  }
}
