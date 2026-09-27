import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A few smaller MeshBridge/XMTPModule invariants (source scan; no JVM test setup in the fork):
// - the "radio down" events are emitted inside the lock, so a start that runs right after a
//   stop can never be followed by a stale up:false / peers:[].
// - stopAndRotate emits "radio down" even when `between` throws; deleteLocalDatabase's mesh
//   branch rotates only when the libxmtp DB file is really gone, otherwise it throws.
// - dropClient forgets the client's MeshOptions and stops a radio that serves it.

const dir = '../android/src/main/java/expo/modules/xmtpreactnativesdk/'
const read = (rel) => readFileSync(fileURLToPath(new URL(dir + rel, import.meta.url)), 'utf8')
const bridgeSrc = read('mesh/MeshBridge.kt')
const moduleSrc = read('XMTPModule.kt')

function blockAfter(text, from) {
  const start = text.indexOf('{', from)
  assert.ok(start !== -1, `no "{" found from index ${from}`)
  let depth = 0
  let i = start
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return { inner: text.slice(start + 1, i), end: i + 1 }
}

function body(src, signature, label) {
  const m = signature.exec(src)
  assert.ok(m, `no ${label}`)
  return blockAfter(src, m.index + m[0].length).inner
}

function splitAtLock(fn) {
  const m = /lock\.withLock\s*/.exec(fn)
  assert.ok(m, `no lock.withLock in:\n${fn}`)
  const { inner, end } = blockAfter(fn, m.index + m[0].length)
  return { locked: inner, after: fn.slice(end) }
}

const STOP = /suspend fun stop\(context: Context\)\s*/
const STOP_AND_ROTATE = /suspend fun stopAndRotate\(\s*context: Context,\s*inboxId: String\?,\s*carryKey: ByteArray\? = null,\s*between: suspend \(\) -> Unit = \{\},?\s*\)\s*/

test('stop emits "radio down" inside the lock', () => {
  const { locked, after } = splitAtLock(body(bridgeSrc, STOP, 'stop'))
  assert.match(locked, /\bemitStopped\(\)/, locked)
  assert.doesNotMatch(after, /\bemitStopped\(\)/, after)
})

test('stopAndRotate emits "radio down" inside the lock, in a finally', () => {
  const { locked, after } = splitAtLock(body(bridgeSrc, STOP_AND_ROTATE, 'stopAndRotate'))
  assert.match(locked, /\btry\s*\{[\s\S]*\bbetween\(\)[\s\S]*\}\s*finally\s*\{[^}]*\bemitStopped\(\)\s*\}/, locked)
  assert.doesNotMatch(after, /\bemitStopped\(\)/, after)
})

test('deleteLocalDatabase rotates only when the libxmtp DB file is gone', () => {
  const fn = body(moduleSrc, /AsyncFunction\("deleteLocalDatabase"\) Coroutine \{ installationId: String ->\s*/, 'deleteLocalDatabase')
  const between = body(fn, /meshBridge\.stopAndRotate\(context, client\.inboxId, carryKey\)\s*/, 'the stopAndRotate between block')
  assert.match(between, /client\.deleteLocalDatabase\(\)/, between)
  assert.match(between, /File\(client\.dbPath\)\.exists\(\)/, between)
  assert.match(between, /throw CodedException\(\s*"E_MESH_DB_NOT_DELETED"/, between)
})

test('dropClient forgets the MeshOptions and stops a radio that serves the client', () => {
  const fn = body(moduleSrc, /AsyncFunction\("dropClient"\) Coroutine \{ installationId: String ->\s*/, 'dropClient')
  assert.match(fn, /meshOptions\.remove\(installationId\)/, fn)
  assert.match(fn, /meshBridge\.stopIfServing\(context, installationId\)/, fn)
  const { locked } = splitAtLock(body(bridgeSrc, /suspend fun stopIfServing\(context: Context, installationId: String\)\s*/, 'stopIfServing'))
  assert.match(locked, /running\?\.installationId != installationId\) return@withLock/, locked)
  assert.match(locked, /\bcancelWatchers\(\)[\s\S]*\bMesh\.stop\([\s\S]*running = null[\s\S]*\bemitStopped\(\)/, locked)
})
