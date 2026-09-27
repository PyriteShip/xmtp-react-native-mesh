import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Restore convergence (the xmtp-mesh design doc in the libxmtp fork, DESIGN.md §C4.4): the
// node's identity resyncs reach JS as 'meshIdentity' events, and the re-base goes through the
// client's own signer exactly like
// revokeAllOtherInstallations: native builds the request, the JS 'sign' listener signs it. Source
// scans: the fork has no JVM or RN runtime tests. The FFI re-base is exercised with a real test
// signer in libxmtp's bindings tests (mls::mesh::a_replaced_log_asks_for_a_rebase_that_a_test_signer_completes).

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const kt = '../android/src/main/java/expo/modules/xmtpreactnativesdk/'
const bridgeSrc = read(kt + 'mesh/MeshBridge.kt')
const jsonSrc = read(kt + 'mesh/MeshJson.kt')
const moduleSrc = read(kt + 'XMTPModule.kt')
const clientSrc = read('../src/lib/Client.ts')
const meshSrc = read('../src/lib/Mesh.ts')
const indexSrc = read('../src/index.ts')

function blockAfter(text, from) {
  const start = text.indexOf('{', from)
  assert.ok(start !== -1, `no "{" after index ${from}`)
  let depth = 0
  let i = start
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) break
  }
  return text.slice(start + 1, i)
}

test('the bridge forwards Mesh.identityEvents as meshIdentity events', () => {
  assert.match(bridgeSrc, /const val EVENT_IDENTITY = "meshIdentity"/)
  // watch(radio) is an expression-bodied function (`=`), not a block body, so there is no
  // enclosing `{`/`}` pair around its whole listOf(...) for blockAfter to brace-match from the
  // function signature. Slice from `private fun watch(` to the next `private fun` (or the rest of
  // the file) instead of brace-matching, which would only capture the first scope.launch { ... }.
  const watchStart = bridgeSrc.indexOf('private fun watch(radio: MeshRadio)')
  assert.ok(watchStart !== -1, 'no watch(radio: MeshRadio)')
  const nextFunStart = bridgeSrc.indexOf('private fun', watchStart + 1)
  const watch = nextFunStart === -1 ? bridgeSrc.slice(watchStart) : bridgeSrc.slice(watchStart, nextFunStart)
  assert.match(watch, /Mesh\.identityEvents\.collect \{ emit\(EVENT_IDENTITY, mapOf\("json" to MeshJson\.identity\(it\)\)\) \}/, watch)
  assert.match(moduleSrc, /MeshBridge\.EVENT_IDENTITY/)
  assert.match(jsonSrc, /"rebaseNeeded"/)
  assert.match(jsonSrc, /"tooManyInstallations"/)
})

test('meshRebaseInstallation signs with the JS signer and maps a full log to a code', () => {
  const at = moduleSrc.indexOf('AsyncFunction("meshRebaseInstallation")')
  assert.ok(at !== -1, 'no AsyncFunction("meshRebaseInstallation")')
  const fn = blockAfter(moduleSrc, at)
  assert.match(fn, /ReactNativeSigner\(/, fn)
  assert.match(fn, /signer = reactSigner/, fn)
  assert.match(fn, /MeshBridge\.mapTooManyInstallations \{ client\.meshRebaseInstallation\(reactSigner\) \}/, fn)
  assert.match(fn, /finally \{\s*signer = null/, fn)
  assert.match(bridgeSrc, /"E_MESH_TOO_MANY_INSTALLATIONS"/)
  assert.match(bridgeSrc, /isMeshTooManyInstallations\(\)/)
})

test('the JS client listens for sign requests during the re-base and always stops listening', () => {
  const at = clientSrc.indexOf('async meshRebaseInstallation(')
  assert.ok(at !== -1, 'no Client.meshRebaseInstallation')
  const fn = blockAfter(clientSrc, at)
  assert.match(fn, /addListener\(\s*'sign'/, fn)
  assert.match(fn, /XMTPModule\.meshRebaseInstallation\(/, fn)
  assert.ok((fn.match(/signSubscription\?\.remove\(\)/g) ?? []).length >= 3, 'removed on success, rejection and error')
  assert.match(indexSrc, /export async function meshRebaseInstallation\(/)
  assert.match(meshSrc, /addIdentityListener\(/)
  assert.match(meshSrc, /'meshIdentity'/)
})
