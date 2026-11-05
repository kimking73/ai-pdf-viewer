// 패키징된 .app을 직접 실행해 창, IPC, PDF 렌더링, 한글, 손상·암호 PDF를 확인한다.
// 패키징된 앱은 퓨즈로 --inspect를 막았으므로 Playwright의 Electron 실행 대신
// Chromium 원격 디버깅 포트로 붙는다. 앱 코드에 테스트용 분기를 두지 않기 위해서다.
//
// 선택: SMOKE_SHOTS=<폴더>에 스크린샷을 남긴다. SMOKE_DOCUMENT=<PDF 경로>를 주면 그 문서의 모든 쪽을
// SMOKE_SHOTS에 찍는다(저작권 있는 문서를 저장소 밖에서 눈으로 확인하는 용도).
/* global window, document, location, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KOREAN_UHC_TEXT, KOREAN_UTF16_TEXT, pageMarker, removeFixtures, writeFixtures } from '../e2e/fixtures/pdfs.ts';
import { PACKAGE_WORK_DIR } from './package-paths.mjs';

const root = join(import.meta.dirname, '..');
const { productName } = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { SMOKE_SHOTS: shotsDir, SMOKE_DOCUMENT: inspectDocument } = process.env;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const outputDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
// 다른 위치의 .app(예: DMG에서 꺼낸 사본)을 확인하려면 경로를 인수로 넘긴다.
const appBundle = process.argv[2] ?? join(PACKAGE_WORK_DIR, outputDir, `${productName}.app`);
const executable = join(appBundle, 'Contents', 'MacOS', productName);
if (!existsSync(executable)) {
  console.error(`패키징된 앱이 없다: ${executable}\n먼저 npm run package:mac 을 실행한다.`);
  process.exit(1);
}

function waitForDebuggerUrl(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('30초 안에 디버깅 포트가 열리지 않았다'));
    }, 30_000);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(stderr);
      if (match) {
        clearTimeout(timer);
        resolve(`http://${match[1]}`);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`앱이 먼저 종료됐다(코드 ${code})\n${stderr}`));
    });
  });
}

// 앱을 새로 띄워 작업을 실행한다. 첫 쪽 시간을 재는 경우 pdf.js를 아직 불러오지 않은 상태가 된다.
async function withApp(task) {
  const userData = mkdtempSync(join(tmpdir(), 'ai-pdf-viewer-smoke-'));
  const child = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${userData}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let browser;
  try {
    browser = await chromium.connectOverCDP(await waitForDebuggerUrl(child));
    const page = browser.contexts()[0]?.pages()[0] ?? (await browser.contexts()[0]?.waitForEvent('page'));
    if (!page) throw new Error('창을 찾지 못했다');
    await page.getByTestId('app-version').filter({ hasText: `버전 ${version}` }).waitFor({ timeout: 15_000 });
    await page.evaluate(() => {
      window.violations = [];
      window.dragEvents = [];
      for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
        window.addEventListener(type, () => window.dragEvents.push(type), true);
      }
      document.addEventListener('securitypolicyviolation', (event) => {
        window.violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });
    const log = [];
    page.on('console', (message) => log.push(`${message.type()}: ${message.text().slice(0, 300)}`));
    page.on('pageerror', (error) => log.push(`pageerror: ${error.message.slice(0, 300)}`));
    try {
      await task(page);
    } catch (error) {
      // 실패 원인을 알 수 있도록 그 순간의 화면 상태를 남긴다.
      const snapshot = await page
        .evaluate(() => {
          const first = document.querySelector('.page[data-page-number="1"]');
          return {
            title: document.title,
            notice: document.querySelector('[data-testid=viewer-notice]')?.textContent,
            count: document.querySelector('[data-testid=page-count]')?.textContent,
            opening: document.querySelector('[data-testid=opening]') !== null,
            dragEvents: window.dragEvents.slice(-8),
            pages: document.querySelectorAll('.page').length,
            firstLoaded: first?.getAttribute('data-loaded'),
            firstText: first?.querySelector('.textLayer')?.textContent?.slice(0, 60),
          };
        })
        .catch(() => null);
      console.error(`상태: ${JSON.stringify(snapshot)}\n콘솔: ${JSON.stringify(log)}`);
      throw error;
    }
    const violations = await page.evaluate(() => window.violations);
    if (violations.length > 0) throw new Error(`CSP 위반: ${violations.join(', ')}`);
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// 실제 경로가 붙도록 Chromium 입력 경로로 파일을 끌어 놓는다.
async function drop(page, path) {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [path], dragOperationsMask: 1 };
  const send = (type) => cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
  await send('dragEnter');
  await send('dragOver');
  // Chromium은 렌더러가 dragover에 응답한 뒤에야 drop을 전달한다. 쪽을 그리느라 바쁘면 응답이 늦어
  // drop이 버려질 수 있으므로, 렌더러가 처리를 마칠 때까지 기다렸다가 사람의 끌기처럼 한 번 더 보낸다.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
  await send('dragOver');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
  await send('drop');
  await cdp.detach();
}

const loaded = (page, number) =>
  page.locator(`.page[data-page-number="${number}"][data-loaded="true"]`).waitFor({ timeout: 30_000 });

const inkRatio = (page, number) =>
  page.evaluate((target) => {
    const canvas = document.querySelector(`.page[data-page-number="${target}"] canvas`);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 200) ink += 1;
    return ink / (canvas.width * canvas.height);
  }, number);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  확인: ${message}`);
}

async function shot(page, name) {
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`) });
}

async function checkBasics(page, files) {
  const state = await page.evaluate(async () => ({
    url: location.href,
    title: document.title,
    require: typeof window.require,
    process: typeof window.process,
    invalid: await window.api.getVersion({ component: 'nope' }),
  }));
  const expected = {
    url: 'app://bundle/index.html',
    title: productName,
    require: 'undefined',
    process: 'undefined',
    invalid: { ok: false, error: { code: 'INVALID_INPUT' } },
  };
  if (JSON.stringify(state) !== JSON.stringify(expected)) {
    throw new Error(`예상과 다르다: ${JSON.stringify(state)}`);
  }
  check(true, `앱 기본 상태 ${JSON.stringify(state)}`);

  const notice = page.getByTestId('viewer-notice');

  await drop(page, files.password);
  await notice.filter({ hasText: '암호가 걸린 PDF는 열 수 없습니다' }).waitFor();
  check(true, '암호 PDF 안내');
  await drop(page, files.corruptTruncated);
  await notice.filter({ hasText: '이 파일은 손상되어 열 수 없습니다' }).waitFor();
  check(true, '손상 PDF 안내, 앱 유지');

  await drop(page, files.basic);
  await loaded(page, 1);
  const textLayer = page.locator('.page[data-page-number="1"] .textLayer');
  await textLayer.filter({ hasText: pageMarker(1) }).waitFor();
  check((await inkRatio(page, 1)) > 0.001, '영문 PDF 렌더링과 표준 글꼴, worker 동작');
  await page.getByRole('button', { name: '다음 쪽' }).click();
  await loaded(page, 2);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await loaded(page, 2);
  check(true, '쪽 이동과 확대');

  await drop(page, files.korean);
  await textLayer.filter({ hasText: KOREAN_UTF16_TEXT }).waitFor({ timeout: 15_000 });
  await textLayer.filter({ hasText: KOREAN_UHC_TEXT }).waitFor();
  await loaded(page, 1);
  check((await inkRatio(page, 1)) > 0.001, '한글 CMap 자산으로 글자 추출과 렌더링');
  await shot(page, 'packaged-korean');

  await drop(page, files.jpx);
  await page.getByTestId('file-name').filter({ hasText: 'jpx.pdf' }).waitFor();
  await loaded(page, 1);
  // 표시 속성은 그리기 시작에 붙는다. 디코딩이 끝나야 캔버스가 들어오므로 캔버스도 기다린다.
  await page.locator('.page[data-page-number="1"] canvas').first().waitFor({ state: 'attached', timeout: 20_000 });
  const center = await page.evaluate(() => {
    const canvas = document.querySelector('.page[data-page-number="1"] canvas');
    const { data } = canvas
      .getContext('2d')
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1);
    return [data[0], data[1], data[2]];
  });
  check(center[0] > 180 && center[1] < 60 && center[2] < 60, `JPEG 2000 JS 디코더 색 ${center.join(',')}`);
}

// 패키지의 배포 CSP에서 패널과 영역 썸네일이 동작하고, 가짜 응답이 꺼져 있으며, 키 없이는 아무것도 보내지 않는지 본다.
// 실제 답변은 키가 필요해 여기서 확인하지 않는다.
async function checkTutor(page, files) {
  await drop(page, files.basic);
  await loaded(page, 1);
  await page.getByTestId('scope-line').filter({ hasText: 'p.1~2' }).waitFor();
  await page.getByTestId('scope-provider').filter({ hasText: 'OpenAI' }).waitFor();
  check((await page.getByTestId('fake-banner').count()) === 0, '패널, 메인이 확정한 범위, 가짜 응답 꺼짐');
  await shot(page, 'tutor-empty');

  const box = await page.locator('.page[data-page-number="1"]').boundingBox();
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 20, start.y + step * 15);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.getByTestId('selection-chip').filter({ hasText: '선택 영역 · p.1' }).waitFor();
  const thumbnail = await page.getByTestId('selection-chip').locator('img').evaluate((image) => image.naturalWidth);
  check(thumbnail > 0, '영역 선택 칩의 썸네일이 표시됨');
  await shot(page, 'tutor-area');

  const input = page.getByTestId('question-input');
  await input.fill('이 수식이 뭔가요');
  await input.press('Enter');
  await page.getByTestId('no-key').waitFor();
  check((await input.inputValue()) === '이 수식이 뭔가요', '키가 없으면 전송하지 않고 질문을 유지함');
  check((await page.getByTestId('turn').count()) === 0, '키가 없으면 대화에 턴이 생기지 않음');
  await shot(page, 'tutor-no-key');

  // 설정 창도 배포 CSP에서 뜨는지 본다. 키는 넣지 않는다.
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('open-settings').click();
  const settings = await opened;
  await settings.getByTestId('key-input').waitFor();
  check((await settings.getByTestId('provider-openai').count()) === 1, '패널의 [설정]으로 키 입력 창이 열림');
  await shot(settings, 'settings');
}

async function measureFirstPage(path, label) {
  await withApp(async (page) => {
    await drop(page, path);
    await page.getByTestId('page-count').filter({ hasText: '/ 300' }).waitFor({ timeout: 30_000 });
    await loaded(page, 1);
    const ms = await page.evaluate(() => performance.getEntriesByName('pdf-first-page').at(-1)?.duration ?? -1);
    const megabytes = (statSync(path).size / 1024 / 1024).toFixed(1);
    console.log(`  측정: 300쪽 ${label}(${megabytes}MB) 첫 쪽 표시 ${ms.toFixed(0)}ms (앱 실행 직후 첫 문서)`);
    if (!(ms > 0 && ms < 3000)) throw new Error(`첫 쪽 표시가 3초 안에 끝나지 않았다: ${ms}`);
  });
}

async function inspectAllPages(path) {
  await withApp(async (page) => {
    await drop(page, path);
    await page.getByTestId('page-count').waitFor({ timeout: 30_000 });
    await loaded(page, 1);
    const count = Number((await page.getByTestId('page-count').textContent()).replace('/', '').trim());
    for (let number = 1; number <= count; number += 1) {
      await page.getByRole('textbox', { name: /현재 \d+쪽/ }).fill(String(number));
      await page.keyboard.press('Enter');
      await loaded(page, number);
      await page.waitForTimeout(150);
      await shot(page, `document-p${String(number).padStart(2, '0')}`);
    }
    console.log(`  문서 ${count}쪽을 찍었다`);
  });
}

let failed = false;
const files = writeFixtures();
try {
  if (inspectDocument) {
    await inspectAllPages(inspectDocument);
  } else {
    await withApp((page) => checkBasics(page, files));
    await withApp((page) => checkTutor(page, files));
    await measureFirstPage(files.large, '글만');
    await measureFirstPage(files.largeWithImages, '쪽마다 이미지');
  }
  console.log(`통과: ${executable}`);
} catch (error) {
  failed = true;
  console.error(`실패: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  removeFixtures(files);
}
process.exit(failed ? 1 : 0);
