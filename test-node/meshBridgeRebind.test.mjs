import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Mesh is a process singleton, but XMTPModule (and its clients) is recreated on every JS
// reload. The bridge records which (installationId, client) the running radio serves,
// process-wide:
// - same installation, new Client object: stop, then start (rebind), so the radio never keeps
//   serving an orphaned Client;
// - a different installation: reject with E_MESH_BUSY instead of silently resolving.
// Source scan: coroutine/Mutex behaviour is not observable from Node and the fork has no JVM
// test setup.

const src = readFileSync(
  fileURLToPath(new URL('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt', import.meta.url)),
  'utf8'
)

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
  return text.slice(start + 1, i)
}

function body(signature, label) {
  const m = signature.exec(src)
  assert.ok(m, `no ${label} in MeshBridge.kt`)
  return blockAfter(src, m.index + m[0].length)
}

function lockBody(fn) {
  const m = /lock\.withLock\s*/.exec(fn)
  assert.ok(m, `no lock.withLock in:\n${fn}`)
  return blockAfter(fn, m.index + m[0].length)
}

test('the running record is process-wide (companion object), like Mesh itself', () => {
  const companion = body(/companion object\s*/, 'companion object')
  assert.match(companion, /var running: Running\? = null/, companion)
})

test('start rejects a different installation with E_MESH_BUSY', () => {
  const locked = lockBody(body(/suspend fun start\(context: Context, client: Client, options: MeshOptions, relay: Boolean\)\s*/, 'start'))
  assert.match(locked, /serving\.installationId != client\.installationId/, locked)
  assert.match(locked, /"E_MESH_BUSY"/, locked)
})

test('start rebinds a new Client object for the same installation: stop, then start', () => {
  const locked = lockBody(body(/suspend fun start\(context: Context, client: Client, options: MeshOptions, relay: Boolean\)\s*/, 'start'))
  assert.match(locked, /serving\?\.client !== client/, locked)
  const stopAt = locked.search(/\bMesh\.stop\(/)
  const startAt = locked.search(/\bMesh\.start\(/)
  assert.ok(stopAt !== -1 && startAt !== -1 && stopAt < startAt, `Mesh.stop must come before Mesh.start:\n${locked}`)
  assert.match(locked.slice(stopAt), /\bcancelWatchers\(\)|watchers = emptyList\(\)/, locked)
  assert.match(locked.slice(startAt), /running = Running\(/, locked)
})

test('stop and stopAndRotate forget the running record', () => {
  assert.match(lockBody(body(/suspend fun stop\(context: Context\)\s*/, 'stop')), /running = null/)
  const rotate = body(/suspend fun stopAndRotate\(\s*context: Context,\s*inboxId: String\?,\s*carryKey: ByteArray\? = null,\s*between: suspend \(\) -> Unit = \{\},?\s*\)\s*/, 'stopAndRotate')
  assert.match(lockBody(rotate), /running = null/)
})

test("a new installation's rotation also refuses the running radio's node", () => {
  const fn = body(/fun nodeForClientLocked\([^)]*\): MeshOptions\s*/, 'nodeForClientLocked')
  assert.match(fn, /running\?\.nodePath/, fn)
})
