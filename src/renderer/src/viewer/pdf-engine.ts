// pdf.js 설정의 원본. 이 모듈은 첫 문서를 열 때 동적으로 불러온다(App.tsx).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfjs-global';
// pdf_viewer.mjs는 평가될 때 globalThis.pdfjsLib을 읽으므로 반드시 pdfjs-global 뒤에 와야 한다.
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

export { EventBus, PDFLinkService, PDFViewer };
export const { AnnotationMode, PermissionFlag } = pdfjs;
export type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type InlineLoader = () => Promise<string>;

// 앱 CSP는 connect-src 'none'이므로 fetch로 자산을 읽을 수 없다. CSP를 풀지 않도록 CMap과 표준 글꼴을
// 지연 로드되는 JS 청크(script-src 'self')에 base64로 넣는다. 목록에 없는 이름은 불러올 방법 자체가 없다.
const cMaps = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?inline',
  import: 'default',
});
const standardFonts = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?inline',
  import: 'default',
});

function byFileName(loaders: Record<string, InlineLoader>): Map<string, InlineLoader> {
  return new Map(Object.entries(loaders).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1), load]));
}

const ASSET_LOADERS: Record<string, Map<string, InlineLoader>> = {
  cMapUrl: byFileName(cMaps),
  standardFontDataUrl: byFileName(standardFonts),
};

function decodeDataUrl(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// pdf.js의 BinaryDataFactory 계약. 워커가 자산을 요청하면 메인 스레드에서 이 객체가 응답한다.
class BundledAssetFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = ASSET_LOADERS[kind]?.get(filename);
    if (load === undefined) throw new Error('번들에 없는 pdf.js 자산');
    return decodeDataUrl(await load());
  }
}

export function loadPdf(data: Uint8Array): PDFDocumentLoadingTask {
  const base = document.baseURI;
  return pdfjs.getDocument({
    data,
    BinaryDataFactory: BundledAssetFactory,
    useWorkerFetch: false,
    cMapPacked: true,
    cMapUrl: new URL('pdfjs/cmaps/', base).href,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
    // WebAssembly는 CSP의 'wasm-unsafe-eval'이 필요하다. 정책을 풀지 않고 pdf.js의 JS 디코더를 쓴다.
    useWasm: false,
    wasmUrl: new URL('pdfjs/wasm/', base).href,
    useSystemFonts: true,
    enableXfa: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
}
