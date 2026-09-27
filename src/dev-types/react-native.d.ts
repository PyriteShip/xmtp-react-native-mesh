// xmtp-mesh: local-only ambient shim so `tsc --noEmit` can resolve `Platform.OS`
// (src/index.ts) without the full `react-native` package installed here.
// `react-native` is a peerDependency ("*"): this fork's own package.json has no
// devDependency on it and none is installed in this repo (unlike `example/`,
// whose own node_modules is not installed either). A consuming app always
// supplies the real `react-native` and its own types; this file is not part of
// the public API (nothing in src/index.ts imports or re-exports it) and a
// consumer's TypeScript program never reaches into an unreferenced .d.ts file
// nested inside node_modules/@xmtp/react-native-sdk/build/**, so it cannot
// shadow or conflict with the app's real `react-native` types.
declare module 'react-native' {
  export const Platform: { OS: string }
}
