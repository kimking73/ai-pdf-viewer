import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { pdfjsStaticAssets } from './scripts/vite-plugin-pdfjs-assets';

// 의존성은 모두 devDependencies에 두고 번들에 포함한다. electron-vite는 dependencies만
// 외부 모듈로 남기므로, 샌드박스 preload에 외부 require가 생기지 않고 패키지도 작게 유지된다.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), pdfjsStaticAssets()],
    // ?inline으로 번들할 pdf.js 자산의 확장자. src/renderer/src/viewer/pdf-engine.ts 참고.
    assetsInclude: ['**/*.bcmap', '**/*.pfb'],
  },
});
