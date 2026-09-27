import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// src/index.ts imports 'react-native' and 'expo-modules-core' (runtime deps this
// fork's Node test harness doesn't have), so it can't be imported directly here
// (see test-node/meshCodec.test.mjs's sibling files for the no-runtime-imports
// convention that only src/lib/{meshSupport,meshCodec,sendOutcome}.ts follow).
// This test instead scans the source text: every static/client-creating wrapper
// that takes an `environment` param must call assertMeshSupported(...) as its
// first statement, so 'mesh' can never reach the iOS module or a static call
// that has no database key.
const indexPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const src = readFileSync(indexPath, 'utf8')

// The 4 client-creating call sites, plus the 7 static wrappers.
const GUARDED_FUNCTIONS = [
  'createRandom',
  'create',
  'build',
  'ffiCreateClient',
  'staticCanMessage',
  'staticInboxStatesForInboxIds',
  'staticRevokeInstallations',
  'ffiStaticRevokeInstallationsSignatureText',
  'ffiStaticApplySignature',
  'staticKeyPackageStatuses',
  'getOrCreateInboxId',
]

function functionBody(name) {
  // Matches `export async function <name>(` (word-boundary on the name so e.g.
  // "create" doesn't match "createRandom"), then captures up to the matching
  // top-level `{ ... }` of the function by tracking brace depth.
  const re = new RegExp(`export (?:async )?function ${name}\\s*\\(`)
  const match = re.exec(src)
  assert.ok(match, `no "export function ${name}(" found in src/index.ts`)
  const openParenIndex = match.index + match[0].length - 1
  // Find the end of the parameter list.
  let i = openParenIndex
  let parenDepth = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') parenDepth++
    else if (src[i] === ')') {
      parenDepth--
      if (parenDepth === 0) break
    }
  }
  // The function's opening body brace is the first "{" followed by a newline
  // (ignoring trailing spaces) after the parameter list — this repo's Prettier
  // formatting keeps single-line inline return-type object literals (e.g.
  // `Promise<{ [key: string]: boolean }>`) on one line, so they never match.
  const bodyBrace = /\{[ \t]*\r?\n/.exec(src.slice(i))
  assert.ok(bodyBrace, `no function body found for ${name}`)
  const bodyStart = i + bodyBrace.index
  let depth = 0
  let j = bodyStart
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(bodyStart + 1, j)
}

for (const name of GUARDED_FUNCTIONS) {
  test(`${name} calls assertMeshSupported(environment, Platform.OS) as its first statement`, () => {
    const body = functionBody(name)
    const firstStatement = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    assert.equal(
      firstStatement,
      'assertMeshSupported(environment, Platform.OS)',
      `${name}'s first statement is "${firstStatement}", not the mesh guard`
    )
  })
}
