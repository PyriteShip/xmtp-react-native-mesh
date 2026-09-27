import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// MeshBridge.stop() and a node rotation must never be composed as two separate lock
// acquisitions — a concurrent meshStart can slip into the gap between them, reopen the
// pre-rotation generation, and have it deleted out from under it. MeshBridge.kt's
// stopAndRotate(context, between) holds ONE lock acquisition across stop -> between -> rotate;
// resetNode and deleteLocalDatabase's mesh branch (XMTPModule.kt) must call it instead of
// calling stop()/rotate() as separate statements. This can't be exercised by a JVM test (the
// fork has no android/src/test setup — Kotlin coroutines/Mutex interleaving isn't observable
// from Node anyway), so this scans the Kotlin source text instead: it fails against code that
// makes two separate calls and passes once both call sites go through stopAndRotate.

const meshBridgePath = fileURLToPath(
  new URL('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt', import.meta.url)
)
const xmtpModulePath = fileURLToPath(
  new URL('../android/src/main/java/expo/modules/xmtpreactnativesdk/XMTPModule.kt', import.meta.url)
)
const meshBridgeSrc = readFileSync(meshBridgePath, 'utf8')
const xmtpModuleSrc = readFileSync(xmtpModulePath, 'utf8')

/** Extracts the `{ ... }` block starting at the first "{" at/after `from`, by brace depth. */
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

function kotlinFunctionBody(src, signaturePattern, label) {
  const match = signaturePattern.exec(src)
  assert.ok(match, `no match for ${label} in ${signaturePattern}`)
  return blockAfter(src, match.index + match[0].length)
}

test('MeshBridge.resetNode calls stopAndRotate, not stop()/rotate() as separate calls', () => {
  const body = kotlinFunctionBody(meshBridgeSrc, /suspend fun resetNode\(context: Context, inboxId: String\?\)\s*/, 'resetNode')
  assert.match(body, /\bstopAndRotate\(context, inboxId\)/, `resetNode's body was:\n${body}`)
  assert.doesNotMatch(body, /\bstop\(context\)/, `resetNode must not call stop() directly:\n${body}`)
  assert.doesNotMatch(body, /\brotate\(context\)/, `resetNode must not call rotate() directly:\n${body}`)
})

test("deleteLocalDatabase's mesh branch calls meshBridge.stopAndRotate, not stop()/rotate() as separate calls", () => {
  const asyncFnMatch = /AsyncFunction\("deleteLocalDatabase"\) Coroutine \{ installationId: String ->\s*/.exec(
    xmtpModuleSrc
  )
  assert.ok(asyncFnMatch, 'no "deleteLocalDatabase" AsyncFunction found in XMTPModule.kt')
  const fnBody = blockAfter(xmtpModuleSrc, asyncFnMatch.index + asyncFnMatch[0].length)
  const meshBranchMatch = /if \(client\.environment == XMTPEnvironment\.MESH\)\s*/.exec(fnBody)
  assert.ok(meshBranchMatch, 'no mesh branch found in deleteLocalDatabase')
  const meshBranch = blockAfter(fnBody, meshBranchMatch.index + meshBranchMatch[0].length)
  assert.match(meshBranch, /\bmeshBridge\.stopAndRotate\(/, `mesh branch was:\n${meshBranch}`)
  assert.doesNotMatch(meshBranch, /\bmeshBridge\.stop\(/, `mesh branch must not call meshBridge.stop() directly:\n${meshBranch}`)
  assert.doesNotMatch(meshBranch, /\bmeshBridge\.rotate\(/, `mesh branch must not call meshBridge.rotate() directly:\n${meshBranch}`)
})

test('MeshBridge declares stopAndRotate with a between callback run under its own lock', () => {
  assert.match(
    meshBridgeSrc,
    /suspend fun stopAndRotate\(\s*context: Context,\s*inboxId: String\?,\s*carryKey: ByteArray\? = null,\s*between: suspend \(\) -> Unit = \{\},?\s*\)/,
    'MeshBridge.kt must declare stopAndRotate(context, inboxId, carryKey, between)'
  )
})
