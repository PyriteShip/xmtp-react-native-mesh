import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Under env 'mesh', clientOptions (which picks, and may rotate, the inbox's node file) and the
// Client call that opens and binds that node must run inside
// MeshBridge.withNodeLock, the same lock stopAndRotate/resetNode hold. Otherwise a rotate can
// land between reading the generation and binding it, and the next launch opens an empty node
// for an installation bound to the old one. Kotlin lock interleaving is not observable from
// Node and the fork has no JVM test setup, so this scans the source.

const dir = '../android/src/main/java/expo/modules/xmtpreactnativesdk/'
const moduleSrc = readFileSync(fileURLToPath(new URL(dir + 'XMTPModule.kt', import.meta.url)), 'utf8')
const bridgeSrc = readFileSync(fileURLToPath(new URL(dir + 'mesh/MeshBridge.kt', import.meta.url)), 'utf8')

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

function asyncFunctionBody(name) {
  const m = new RegExp(`AsyncFunction\\("${name}"\\) Coroutine \\{[^\\n]*->`).exec(moduleSrc)
  assert.ok(m, `no AsyncFunction("${name}") in XMTPModule.kt`)
  return blockAfter(moduleSrc, m.index).inner
}

const CREATORS = {
  createRandom: /\bClient\.create\(/,
  create: /\bClient\.create\(/,
  build: /\bClient\.build\(/,
  ffiCreateClient: /\bClient\.ffiCreateClient\(/,
}

for (const [name, clientCall] of Object.entries(CREATORS)) {
  test(`${name}: clientOptions and the Client call run inside meshClientCreation`, () => {
    const body = asyncFunctionBody(name)
    const m = /\bmeshClientCreation\(authParams\)\s*/.exec(body)
    assert.ok(m, `${name} must go through meshClientCreation(authParams):\n${body}`)
    const { inner, end } = blockAfter(body, m.index + m[0].length)
    assert.match(inner, /\bclientOptions\(/, `${name}: clientOptions must be inside the lock:\n${inner}`)
    assert.match(inner, clientCall, `${name}: the Client call must be inside the lock:\n${inner}`)
    const outside = body.slice(0, m.index) + body.slice(end)
    assert.doesNotMatch(outside, /\bclientOptions\(/, `${name}: no clientOptions outside the lock`)
    assert.doesNotMatch(outside, clientCall, `${name}: no Client call outside the lock`)
  })
}

test('meshClientCreation takes MeshBridge.withNodeLock under env mesh', () => {
  const m = /private suspend fun <T> meshClientCreation\(authParams: String, block: suspend \(\) -> T\): T\s*/.exec(moduleSrc)
  assert.ok(m, 'XMTPModule.kt must declare meshClientCreation(authParams, block)')
  const { inner } = blockAfter(moduleSrc, m.index + m[0].length)
  assert.match(inner, /environment\s*!=\s*"mesh"/, inner)
  assert.match(inner, /\bmeshBridge\.withNodeLock\s*\{/, inner)
})

test('MeshBridge.withNodeLock holds the same lock as stopAndRotate', () => {
  const m = /suspend fun <T> withNodeLock\(block: suspend \(\) -> T\): T\s*/.exec(bridgeSrc)
  assert.ok(m, 'MeshBridge.kt must declare withNodeLock(block)')
  assert.match(bridgeSrc.slice(m.index, m.index + 200), /=\s*lock\.withLock\s*\{\s*block\(\)\s*\}/)
})
