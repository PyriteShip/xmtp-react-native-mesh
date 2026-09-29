# xmtp-mesh patches on xmtp-react-native

This fork adds the xmtp-mesh environment (serverless XMTP over a Bluetooth mesh,
Android only) to the React Native SDK. The table below lists every change to a
file that already exists upstream, so a rebase knows where conflicts can come from.

Base tag: v5.7.0
Base commit: f0a3d5ecec7552ee479de24b2f151db3e85fbb50

- Everything lives on the default branch. Releases are tagged
  `rn-sdk-5.7.0-mesh.N`.
- It depends on the libxmtp fork's AAR, `org.xmtp:android:4.10.0-rc2-mesh.N`, built from the
  xmtp-mesh libxmtp fork; see its `docs/xmtp-mesh/README.md` for how to build and install it
  locally.
- Regenerate the file lists with `git diff --name-status <Base commit> HEAD`.
  `.github/xmtp-mesh/check-patches.sh PATCHES.md` fails if an edited upstream file is
  missing from the table below. The weekly upstream-drift workflow runs it.

## Edits to upstream files

| File | Purpose |
|---|---|
| `.gitignore` | Typedoc's `docs/` ignore narrowed to `docs/*` so `docs/xmtp-mesh/` is tracked. |
| `.github/dependabot.yml` | Emptied: no Dependabot version updates in this fork (upstream bumps are tracked by the weekly upstream-drift check). |
| `android/build.gradle` | Adds mavenLocal (limited to `org.xmtp`) and pins org.xmtp:android:4.10.0-rc2-mesh.11. |
| `android/src/main/java/expo/modules/xmtpreactnativesdk/XMTPModule.kt` | Maps env `mesh` to `XMTPEnvironment.MESH` with a per-inbox node, creating clients under `MeshBridge.withNodeLock`. Adds the mesh functions (start, stop, reset node, pairing mode, peers, radio state, Bluetooth status, requested permissions, `meshCanMessage`) and their events. `deleteLocalDatabase` rotates the node DB. Adds meshRebaseInstallation and the meshIdentity event (restore convergence). `meshStart` takes the user's relay choice; adds `meshSetRelayEnabled`, `meshRelayState`, `meshRelayStats` and the meshRelay event. Adds `meshStats` (signed-sequencing counters). `meshStart` takes the account key and the restore flag; adds the pairing, contacts and restore-window functions (private discovery). |
| `package.json` | Adds the `test:node` script. |
| `src/index.ts` | Adds the `mesh*` native wrappers. Widens `environment` to `XMTPEnvironment`. Adds the `assertMeshSupported` guard in `create`, `build` and `createRandom` (iOS throws under `mesh`). Adds meshRebaseInstallation and exports MeshIdentityEvent/MeshIdentityOutcome. Adds the relay wrappers (`meshStart`'s `relay` param, `meshSetRelayEnabled`, `meshRelayStateJson`, `meshRelayStatsJson`) and exports MeshRelayState/MeshRelayStats. Adds `meshStatsJson` and exports MeshStats. Adds the pairing, contacts and restore-window wrappers and exports MeshPairingState/MeshPendingPairing/MeshPairingRefusal/MeshContact. |
| `src/lib/Client.ts` | Adds `'mesh'` to `XMTPEnvironment`. Adds Client.meshRebaseInstallation. |
| `src/lib/Conversation.ts` | Declares `sendWithStatus`. |
| `src/lib/Dm.ts` | Adds `sendWithStatus` (prepareMessage, then publishPreparedMessages). |
| `src/lib/Group.ts` | Adds `sendWithStatus` (prepareMessage, then publishPreparedMessages). |

## New files

| Path | Files | What |
|---|---|---|
| `android/src/main/java/expo/modules/xmtpreactnativesdk/mesh/` | 2 | `MeshBridge.kt`, `MeshJson.kt`. |
| `src/lib/` (`Mesh.ts`, `meshCodec.ts`, `meshSupport.ts`, `sendOutcome.ts`) | 4 | The JS mesh API and send outcome. |
| `src/dev-types/react-native.d.ts` | 1 | Types for the Node test harness. |
| `dev/pack-for-app` | 1 | Packs the SDK for the app. |
| `test-node/` | 12 | Node tests (`npm run test:node`). |
| `PATCHES.md`, `.github/xmtp-mesh/`, `.github/workflows/upstream-drift.yml` | 10 | This file and the weekly upstream-drift check. |
| `docs/xmtp-mesh/README.md` | 1 | What this fork adds, and how to build/install the AAR it needs. |
