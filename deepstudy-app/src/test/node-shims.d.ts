declare const __dirname: string

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: BufferEncoding): string
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string
}

type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex'
