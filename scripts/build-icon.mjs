// build/icon.svg에서 macOS 아이콘 build/icon.icns를 만든다. 아이콘을 바꿀 때만 실행한다.
// 렌더링은 Playwright의 Chromium, 묶음은 macOS의 sips와 iconutil을 쓴다.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const svg = readFileSync('build/icon.svg', 'utf8');
const work = mkdtempSync(join(tmpdir(), 'app-icon-'));
const master = join(work, 'master.png');
const iconset = join(work, 'icon.iconset');
mkdirSync(iconset);

try {
  const executablePath = process.env.ICON_CHROMIUM;
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  await page.screenshot({ path: master, omitBackground: true });
  await browser.close();

  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const name = `icon_${String(size)}x${String(size)}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('sips', ['-z', pixels, pixels, master, '--out', join(iconset, name)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns']);
  console.log('build/icon.icns를 만들었다');
} finally {
  rmSync(work, { recursive: true, force: true });
}
