import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseMeshStats } from '../src/lib/meshCodec.ts'

const KEYS = [
  'seqRowsSigned',
  'seqRowsVerified',
  'seqRejectedMissingProof',
  'seqRejectedBadSignature',
  'seqRejectedWrongSigner',
  'seqEquivocations',
  'peersRejectedVersion',
]

test('parseMeshStats maps every counter', () => {
  const s = parseMeshStats(
    '{"seqRowsSigned":5,"seqRowsVerified":4,"seqRejectedMissingProof":1,"seqRejectedBadSignature":2,"seqRejectedWrongSigner":3,"seqEquivocations":0,"peersRejectedVersion":6}'
  )
  assert.deepEqual(s, {
    seqRowsSigned: 5,
    seqRowsVerified: 4,
    seqRejectedMissingProof: 1,
    seqRejectedBadSignature: 2,
    seqRejectedWrongSigner: 3,
    seqEquivocations: 0,
    peersRejectedVersion: 6,
  })
})

test('parseMeshStats returns null when the node is stopped or the JSON is bad', () => {
  assert.equal(parseMeshStats('null'), null)
  assert.equal(parseMeshStats(''), null)
  assert.equal(parseMeshStats('garbage'), null)
  assert.equal(parseMeshStats('[]'), null)
  assert.equal(parseMeshStats(undefined), null)
})

test('parseMeshStats reads a missing or non-numeric counter as 0', () => {
  const s = parseMeshStats('{"seqRowsSigned":"7"}')
  for (const k of KEYS) assert.equal(s[k], 0, k)
})

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('the native module, bridge and JSON expose every counter', () => {
  const mod = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/XMTPModule.kt')
  assert.match(mod, /Function\("meshStats"\) \{ -> meshBridge\.meshStatsJson\(\) \}/)
  const bridge = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshBridge.kt')
  assert.match(bridge, /fun meshStatsJson\(\): String = MeshJson\.meshStats\(Mesh\.stats\(\)\)/)
  const json = read('../android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/MeshJson.kt')
  for (const k of KEYS) assert.match(json, new RegExp(`"${k}" to s\\.${k}\\.toLong\\(\\)`), k)
})

test('the JS API guards Android and exports the type', () => {
  const mesh = read('../src/lib/Mesh.ts')
  assert.match(mesh, /stats\(\): MeshStats \| null \{\s*assertAndroid\(\)\s*return parseMeshStats\(XMTPModule\.meshStatsJson\(\)\)/)
  const index = read('../src/index.ts')
  assert.match(index, /export function meshStatsJson\(\): string \{\s*return XMTPModule\.meshStats\(\)/)
  assert.match(index, /MeshStats,\s*\} from '\.\/lib\/meshCodec'/)
})
