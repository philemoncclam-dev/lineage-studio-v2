// The vendored connectors reference Node's Buffer as a base64 fallback for
// test environments. The host tsconfig doesn't load @types/node for app code,
// so declare the one symbol used instead of pulling in all Node globals.
declare const Buffer: {
  from(input: string, encoding: string): { toString(encoding: string): string }
}
