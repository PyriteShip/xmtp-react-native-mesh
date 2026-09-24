import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Ruling 8 (SP3 final review I1): the mesh node is per inbox and follows the libxmtp DB. The
// fork learns the inbox at clientOptions time (build passes it; create/createRandom/
// ffiCreateClient compute it with generateInboxId(identity, nonce 0)), asks the AAR's
// MeshNodeFiles for that inbox's node (rotated first when the inbox's libxmtp DB does not
// exist yet), refuses to rotate a node that is still open, and reports libxmtp's "a mesh node
// serves exactly one local installation" as E_MESH_NODE_MISMATCH. Source scan: the fork has
// no JVM test setup, and the file logic itself is covered by the AAR's MeshNodeFilesTest.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const dir = '../android/src/main/java/expo/modules/xmtpreactnativesdk/'
const moduleSrc = read(dir + 'XMTPModule.kt')
const bridgeSrc = read(dir + 'mesh/MeshBridge.kt')
const gradle = read('../android/build.gradle')
const meshTs = read('../src/lib/Mesh.ts')
const indexTs = read('../src/index.ts')

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

function asyncFunctionBody(name) {
  const m = new RegExp(`AsyncFunction\\("${name}"\\) Coroutine \\{[^\\n]*->`).exec(moduleSrc)
  assert.ok(m, `no AsyncFunction("${name}") in XMTPModule.kt`)
  return blockAfter(moduleSrc, m.index)
}

function functionBody(src, signature, label) {
  const m = signature.exec(src)
  assert.ok(m, `no ${label}`)
  const from = m.index + m[0].length
  // An expression body (`= …`) runs to the next declaration; a block body is brace-matched.
  if (src[from] === '=') return src.slice(from, src.indexOf('\n\n', from))
  return blockAfter(src, from)
}

test('the fork pins AAR 4.10.0-rc2-mesh.6', () => {
  assert.match(gradle, /implementation "org\.xmtp:android:4\.10\.0-rc2-mesh\.6"/)
  assert.doesNotMatch(gradle, /4\.10\.0-rc2-mesh\.5/)
})

test('clientOptions picks the node for the inbox, not a device-wide one', () => {
  assert.doesNotMatch(moduleSrc, /MeshOptions\.currentNode\(/)
  const body = functionBody(moduleSrc, /private fun clientOptions\([^)]*meshInboxId: String\? = null,?\s*\): ClientOptions\s*/, 'clientOptions(…, meshInboxId)')
  assert.match(body, /meshBridge\.nodeForClientLocked\(/, body)
  assert.match(body, /authOptions\.dbDirectory/, body)
})

test('every creator hands clientOptions the inbox id', () => {
  assert.match(asyncFunctionBody('createRandom'), /meshInboxId = meshInboxIdFor\(privateKey\.publicIdentity\)/)
  assert.match(asyncFunctionBody('create'), /meshInboxId = meshInboxIdFor\(identity\)/)
  assert.match(asyncFunctionBody('build'), /meshInboxId = inboxId \?: meshInboxIdFor\(identity\)/)
  assert.match(asyncFunctionBody('ffiCreateClient'), /meshInboxId = meshInboxIdFor\(identity\)/)
})

test('the inbox id is generateInboxId(identity, nonce 0), computed locally', () => {
  const body = functionBody(moduleSrc, /private fun meshInboxIdFor\(identity: PublicIdentity\): String\s*/, 'meshInboxIdFor')
  assert.match(body, /generateInboxId\(identity\.ffiPrivate, 0uL\)/, body)
})

test('nodeForClientLocked follows the libxmtp DB and never rotates an open node', () => {
  const body = functionBody(bridgeSrc, /fun nodeForClientLocked\([^)]*\): MeshOptions\s*/, 'nodeForClientLocked')
  assert.match(body, /MeshNodeFiles\.forInbox\(/, body)
  assert.match(body, /MeshNodeFiles\.libxmtpDbFile\(/, body)
  assert.match(body, /\.forClient\(/, body)
  assert.match(body, /E_MESH_BUSY/, body)
  assert.match(body, /openNodePaths/, body)
})

test('stopAndRotate rotates one inbox (or all for a recovery reset)', () => {
  const body = functionBody(bridgeSrc, /suspend fun stopAndRotate\(\s*context: Context,\s*inboxId: String\?,\s*between: suspend \(\) -> Unit = \{\},?\s*\)\s*/, 'stopAndRotate(context, inboxId, between)')
  assert.match(body, /MeshNodeFiles\.forInbox\(app, inboxId\)\.rotate\(\)/, body)
  assert.match(body, /MeshNodeFiles\.rotateAll\(/, body)
})

test("deleteLocalDatabase rotates the client's own inbox", () => {
  assert.match(asyncFunctionBody('deleteLocalDatabase'), /meshBridge\.stopAndRotate\(context, client\.inboxId\)/)
})

test('resetNode takes an optional inbox id end to end', () => {
  assert.match(moduleSrc, /AsyncFunction\("meshResetNode"\) Coroutine \{ inboxId: String\? ->/)
  assert.match(bridgeSrc, /suspend fun resetNode\(context: Context, inboxId: String\?\)/)
  assert.match(indexTs, /export async function meshResetNode\(inboxId\?: string\): Promise<void>/)
  assert.match(meshTs, /async resetNode\(inboxId\?: string\): Promise<void>/)
})

test('"a mesh node serves exactly one local installation" surfaces as E_MESH_NODE_MISMATCH', () => {
  const body = functionBody(bridgeSrc, /suspend fun <T> mapNodeMismatch\(block: suspend \(\) -> T\): T\s*/, 'mapNodeMismatch')
  assert.match(bridgeSrc, /NODE_MISMATCH = "a mesh node serves exactly one local installation"/)
  assert.match(body, /\bNODE_MISMATCH\b/, body)
  assert.match(body, /E_MESH_NODE_MISMATCH/, body)
  const creation = functionBody(moduleSrc, /private suspend fun <T> meshClientCreation\(authParams: String, block: suspend \(\) -> T\): T\s*/, 'meshClientCreation')
  assert.match(creation, /MeshBridge\.mapNodeMismatch\s*\{/, creation)
  assert.match(asyncFunctionBody('meshStart'), /MeshBridge\.mapNodeMismatch\s*\{/)
})
