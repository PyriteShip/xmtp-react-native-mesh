# xmtp-mesh (React Native SDK fork)

This fork of `@xmtp/react-native-sdk` adds an `env: 'mesh'` transport: real XMTP v3 (MLS)
messaging over a Bluetooth Low Energy mesh, with no internet and no XMTP network nodes. Only the
transport changes — messages, groups and DMs are the same libxmtp objects the SDK already uses.

See `PATCHES.md` for the exact file-by-file diff against upstream, and the xmtp-mesh design doc
in the libxmtp fork (`docs/xmtp-mesh/DESIGN.md`) for how the mesh, restore convergence and
multi-hop relay actually work.

**Status: experimental, not audited, not protest-safe.** Do not rely on this for situations
where discovery or interception of your traffic would put you at risk. Multi-hop relay is
verified in the simulator; multi-hop on three or more real phones is not yet tested.

## What the fork adds

- **Mesh API** (`Mesh` export, Android only): `start`/`stop`, `resetNode`, `peers()`,
  `radioState()`, `bluetoothStatus()`, `requestedPermissions()`, `canMessage()`,
  `setPairingMode()`.
- **Relay**: `setRelayEnabled()`, `relayState()`, `relayStats()`, and a `meshRelay` event, for
  the multi-hop store-and-forward relay described in the design doc's Part R.
- **Signed sequencing**: `stats()` returns the order-check counters (rows signed and checked,
  rows refused by reason, peers refused for an older version), described in the design doc's
  §B13. A mesh.10 phone syncs only with mesh.10 phones.
- **Events**: `addPeersListener`, `addRadioListener`, `addBluetoothListener`, `addRelayListener`,
  `addIdentityListener` (restore convergence: `reloaded` / `rebaseNeeded` /
  `tooManyInstallations`).
- **`Client.meshRebaseInstallation`**: re-adds this installation to its inbox's identity log
  after a restore-convergence rebase.
- **`sendWithStatus`** on `Dm`/`Group`: reports `'published'` vs `'queued'` instead of just
  resolving, since a message sent to a peer that isn't reachable yet is normal on the mesh, not
  an error.

Everything above is **Android only**. On iOS, `env: 'mesh'` throws
`"XMTP env 'mesh' is supported on Android only"` before it reaches native code; other
environments (`local`, `dev`, `production`) are unaffected on both platforms.

## Base and versioning

- Base: upstream tag `v5.7.0` (commit noted in `PATCHES.md`).
- `package.json` keeps version `"5.7.0"` so a host app whose peer range is `^5.7.0` still
  resolves this fork; `MESH_FORK_VERSION` (exported from the package) names the fork's own
  release.
- Releases are tagged `rn-sdk-5.7.0-mesh.N`.

## The AAR it needs

The Android side of `env: 'mesh'` depends on `org.xmtp:android:4.10.0-rc2-mesh.N`
(see `android/build.gradle`), built from the xmtp-mesh libxmtp fork. It is not published to
Maven Central; build and install it into your local Maven repository (`~/.m2`) using the
instructions in that fork's `docs/xmtp-mesh/README.md`, then this package's
`android/build.gradle` picks it up via `mavenLocal()` (scoped to the `org.xmtp` group only).

## Building and testing this fork locally

```sh
yarn install --immutable
npm run test:node        # Node tests for the platform-independent mesh logic
npx tsc --noEmit -p tsconfig.json
```

`dev/pack-for-app` builds, tests, type-checks and packs the SDK into a tarball for installing
into a consuming app without publishing it.

## Licence

MIT, unchanged from upstream — see `LICENSE`.
