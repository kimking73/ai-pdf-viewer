import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const PDFJS_ROOT = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

// pdf.js가 URL로 직접 불러오는 파일만 번들에 고정된 이름으로 넣는다.
// - standard_fonts: FontFace의 url()로 불러온다(font-src 'self').
// - *_nowasm_fallback.js: 워커가 import()로 불러오는 JPEG 2000, JBIG2 디코더(script-src 'self').
// CMap처럼 fetch가 필요한 자산은 CSP의 connect-src를 막아 두었으므로 pdf-engine.ts에서 다르게 읽는다.
function listAssets(): Map<string, string> {
  const assets = new Map<string, string>();
  for (const file of readdirSync(join(PDFJS_ROOT, 'standard_fonts'))) {
    if (/\.(?:pfb|ttf)$/.test(file)) assets.set(`standard_fonts/${file}`, join(PDFJS_ROOT, 'standard_fonts', file));
  }
  for (const file of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
    assets.set(`wasm/${file}`, join(PDFJS_ROOT, 'wasm', file));
  }
  return assets;
}

export function pdfjsStaticAssets(): Plugin {
  const assets = listAssets();
  return {
    name: 'pdfjs-static-assets',
    generateBundle() {
      for (const [name, source] of assets) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(source) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (request, response, next) => {
        const source = assets.get((request.url ?? '').split('?')[0]?.slice(1) ?? '');
        if (source === undefined) {
          next();
          return;
        }
        response.setHeader('Content-Type', source.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        response.end(readFileSync(source));
      });
    },
  };
}
