import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Task 8 review, Ruling 7: watcher creation and cancellation must happen inside the SAME
// lock.withLock as Mesh.start / Mesh.stop / MeshNodeFiles.rotate. Before this fix, start()
// released the lock after Mesh.start and only then created watchers under a separate
// synchronized(this) block, while stopAndRotate() cancelled watchers BEFORE taking the lock.
// A concurrent start() and stopAndRotate() could interleave so that start()'s watchers bind
// to a radio that stopAndRotate has already stopped and rotated away, with nothing left to
// cancel them. Not exercisable from a JVM test (no android/src/test setup in this fork, and
// Kotlin coroutine/Mutex interleaving isn't observable from Node anyway), so this scans the
// Kotlin source text: it fails against the pre-fix code and passes once watcher management
// moves entirely inside lock.withLock, with the separate synchronized(this) mechanism gone.

const meshBridgePath = fileURLToPath(
  new URL(
    '../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt',
    import.meta.url
  )
)
const src = readFileSync(meshBridgePath, 'utf8')

/**
 * Extracts the `{ ... }` block starting at the first "{" at/after `from`, by brace depth.
 * Returns the block's inner text and the source index right after its closing "}".
 */
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

function kotlinFunctionBody(signaturePattern, label) {
  const match = signaturePattern.exec(src)
  assert.ok(match, `no match for ${label} in ${signaturePattern}`)
  return blockAfter(src, match.index + match[0].length)
}

test('MeshBridge.kt drops the separate synchronized(this) watcher mechanism', () => {
  assert.doesNotMatch(
    src,
    /synchronized\(this\)/,
    'watcher list access must be guarded only by lock.withLock, not a second synchronized(this) block'
  )
})

test('start() creates watchers inside lock.withLock, not after it releases', () => {
  const { inner: fnBody } = kotlinFunctionBody(
    /suspend fun start\(context: Context, client: Client, options: MeshOptions\)\s*/,
    'start'
  )
  const lockMatch = /lock\.withLock\s*/.exec(fnBody)
  assert.ok(lockMatch, `no lock.withLock found in start():\n${fnBody}`)
  const { inner: lockBody, end: lockEnd } = blockAfter(fnBody, lockMatch.index + lockMatch[0].length)
  assert.match(lockBody, /\bwatch\(radio\)/, `watcher creation must be inside lock.withLock:\n${lockBody}`)
  const afterLock = fnBody.slice(lockEnd)
  assert.doesNotMatch(
    afterLock,
    /\bwatchers\b/,
    `no watcher list access after lock.withLock releases:\n${afterLock}`
  )
})

test('stop() cancels watchers inside lock.withLock, not before it is taken', () => {
  const { inner: fnBody } = kotlinFunctionBody(/suspend fun stop\(context: Context\)\s*/, 'stop')
  const lockMatch = /lock\.withLock\s*/.exec(fnBody)
  assert.ok(lockMatch, `no lock.withLock found in stop():\n${fnBody}`)
  const beforeLock = fnBody.slice(0, lockMatch.index)
  assert.doesNotMatch(
    beforeLock,
    /\bcancelWatchers\(\)|\bwatchers\b/,
    `no watcher access before lock.withLock is taken:\n${beforeLock}`
  )
  const { inner: lockBody } = blockAfter(fnBody, lockMatch.index + lockMatch[0].length)
  assert.match(lockBody, /\bcancelWatchers\(\)/, `watcher cancellation must be inside lock.withLock:\n${lockBody}`)
})

test('stopAndRotate() cancels watchers inside lock.withLock, not before it is taken', () => {
  const { inner: fnBody } = kotlinFunctionBody(
    /suspend fun stopAndRotate\(\s*context: Context,\s*inboxId: String\?,\s*between: suspend \(\) -> Unit = \{\},?\s*\)\s*/,
    'stopAndRotate'
  )
  const lockMatch = /lock\.withLock\s*/.exec(fnBody)
  assert.ok(lockMatch, `no lock.withLock found in stopAndRotate():\n${fnBody}`)
  const beforeLock = fnBody.slice(0, lockMatch.index)
  assert.doesNotMatch(
    beforeLock,
    /\bcancelWatchers\(\)|\bwatchers\b/,
    `no watcher access before lock.withLock is taken:\n${beforeLock}`
  )
  const { inner: lockBody } = blockAfter(fnBody, lockMatch.index + lockMatch[0].length)
  assert.match(lockBody, /\bcancelWatchers\(\)/, `watcher cancellation must be inside lock.withLock:\n${lockBody}`)
})

test('dispose() clears the watcher list', () => {
  const { inner: fnBody } = kotlinFunctionBody(/fun dispose\(\)\s*/, 'dispose')
  assert.match(fnBody, /watchers\s*=\s*emptyList\(\)/, `dispose() must clear the watcher list:\n${fnBody}`)
})
