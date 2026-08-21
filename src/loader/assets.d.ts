// Binary assets esbuild inlines at build time.
//
// The loader build gives `.webm` the base64 loader, so an import of one is a
// string rather than a path: the install then needs nothing beside dist/, which
// is the promise stage-install.mjs checks and the reason there is no runtime
// file read here.
declare module '*.webm' {
  const base64: string;
  export default base64;
}
