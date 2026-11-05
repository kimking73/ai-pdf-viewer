import * as pdfjs from 'pdfjs-dist';

// pdf_viewer.mjs가 평가될 때 전역 pdfjsLib에서 API를 꺼내므로 먼저 넣어 둔다.
(globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;
