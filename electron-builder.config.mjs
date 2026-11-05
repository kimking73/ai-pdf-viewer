import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_WORK_DIR, RELEASE_DIR } from './scripts/package-paths.mjs';

const appConfig = JSON.parse(readFileSync(new URL('./app.config.json', import.meta.url), 'utf8'));

/** @type {import('electron-builder').Configuration} */
export default {
  appId: appConfig.appId,
  productName: appConfig.productName,
  directories: { output: PACKAGE_WORK_DIR },
  files: ['out/**', 'package.json'],
  electronLanguages: ['ko', 'en'],
  npmRebuild: false,
  mac: {
    category: 'public.app-category.education',
    icon: 'build/icon.icns',
    target: ['dmg'],
    // 베타는 미서명 직접 배포(docs/decisions.md). 다만 Apple Silicon은 서명이 전혀 없는
    // 코드를 실행하지 않으므로 애드혹 서명('-')을 쓴다. 인증서나 공증과는 무관하다.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
  },
  dmg: { sign: false },
  afterAllArtifactBuild: ({ artifactPaths }) => {
    const releaseDir = fileURLToPath(RELEASE_DIR);
    mkdirSync(releaseDir, { recursive: true });
    const dmgs = artifactPaths.filter((path) => path.endsWith('.dmg'));
    for (const dmg of dmgs) copyFileSync(dmg, join(releaseDir, basename(dmg)));
    return [];
  },
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
};
