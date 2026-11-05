import { homedir } from 'node:os';
import { join } from 'node:path';

// 패키징 작업 폴더를 저장소 밖에 둔다. 저장소가 iCloud 동기화 폴더(데스크탑 등)에 있으면
// 동기화 데몬이 .app 내부에 확장 속성을 붙여 codesign이 "resource fork, Finder information,
// or similar detritus not allowed"로 실패한다. 최종 DMG만 저장소의 release/로 복사한다.
export const PACKAGE_WORK_DIR = join(homedir(), 'Library', 'Caches', 'ai-pdf-viewer-build');
export const RELEASE_DIR = new URL('../release/', import.meta.url);
