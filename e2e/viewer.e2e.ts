import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KOREAN_UHC_TEXT,
  KOREAN_UTF16_TEXT,
  pageMarker,
  removeFixtures,
  writeFixtures,
  type FixtureFiles,
} from './fixtures/pdfs';

const root = join(__dirname, '..');
let files: FixtureFiles;
let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(() => {
  files = writeFixtures();
});
test.afterAll(() => {
  removeFixtures(files);
});

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'ai-pdf-viewer-e2e-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root, env: { ...process.env, AI_PDF_VIEWER_FAKE_PROVIDER: '1' } });
  page = await app.firstWindow();
  await page.getByTestId('app-version').filter({ hasText: '버전' }).waitFor();
  // 창은 그대로 보인다. 시험 중 사용자의 실제 마우스가 창 위를 지나면 시험의 드래그가 끊겨, 실제 마우스만 통과시킨다.
  // 시험 입력은 CDP로 렌더러에 직접 들어가므로 영향이 없다. 앱 코드가 아니라 시험에서만 설정한다.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true);
  });
  // 이 시점 이후의 모든 CSP 위반을 기록한다. 어떤 시험에서도 없어야 한다.
  await page.evaluate(() => {
    const scope = window as unknown as { violations: string[] };
    scope.violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
});

test.afterEach(async () => {
  const violations = await page.evaluate(() => (window as unknown as { violations: string[] }).violations);
  await app.close();
  rmSync(userData, { recursive: true, force: true });
  expect(violations).toEqual([]);
});

// 파일 선택 대화상자만 대체하고, 메뉴 항목을 실제로 눌러 메인 -> 렌더러 -> 메인 경로를 지난다.
async function openWithMenu(path: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, path);
  await app.evaluate(({ Menu }) => {
    (Menu.getApplicationMenu()?.getMenuItemById('open-pdf') as unknown as { click(): void }).click();
  });
}

// Chromium 입력 경로로 실제 파일을 끌어 놓는다. 스크립트로 만든 File과 달리 실제 경로가 붙는다.
async function dropFile(path: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [path], dragOperationsMask: 1 };
  const send = (type: 'dragEnter' | 'dragOver' | 'drop') => cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
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

const pageView = (number: number) => page.locator(`.page[data-page-number="${String(number)}"]`);
const pageInput = () => page.getByRole('textbox', { name: /현재 \d+쪽/ });

async function expectPageRendered(number: number): Promise<void> {
  await expect(pageView(number).locator('canvas').first()).toBeVisible();
  await expect(pageView(number)).toHaveAttribute('data-loaded', 'true', { timeout: 20_000 });
}

// 쪽 캔버스에서 흰색이 아닌 픽셀의 비율. 빈 쪽이나 그려지지 않은 쪽을 가려낸다.
function canvasStats(number: number) {
  return page.evaluate((target) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`.page[data-page-number="${String(target)}"] canvas`);
    if (canvas === null) throw new Error('캔버스가 없다');
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('컨텍스트가 없다');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 255) < 200) ink += 1;
    }
    const center = (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4;
    return {
      width: canvas.width,
      inkRatio: ink / (canvas.width * canvas.height),
      center: [data[center], data[center + 1], data[center + 2]],
    };
  }, number);
}

async function copySelection(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.copy();
  });
}

// 이벤트가 합쳐지지 않도록 사람이 끌듯이 조금씩 움직인다.
async function dragAcross(box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(box.x + (box.width * step) / 12 - 1, y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test('메뉴로 PDF를 열면 첫 쪽과 글자가 표시되고 단축키가 등록되어 있다', async () => {
  await expect(page.getByText('PDF를 여기에 끌어다 놓거나 열어 주세요')).toBeVisible();

  const accelerator = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-pdf')?.accelerator,
  );
  expect(accelerator).toBe('CmdOrCtrl+O');

  await openWithMenu(files.basic);
  await expectPageRendered(1);
  await expect(page.getByTestId('file-name')).toHaveText('basic 기본.pdf');
  await expect(page.getByTestId('page-count')).toHaveText('/ 12');
  await expect(pageInput()).toHaveValue('1');
  await expect(pageView(1).locator('.textLayer')).toContainText(pageMarker(1));
  await expect(page.getByText('PDF를 여기에 끌어다 놓거나 열어 주세요')).toBeHidden();
  expect((await canvasStats(1)).inkRatio).toBeGreaterThan(0.001);
});

test('빈 화면의 버튼으로 대화상자를 취소하면 아무 일도 일어나지 않는다', async () => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: 'PDF 열기' }).click();
  await expect(page.getByText('PDF를 여기에 끌어다 놓거나 열어 주세요')).toBeVisible();
  await expect(page.getByTestId('viewer-notice')).toBeHidden();
});

test('창에 끌어다 놓아 열고, PDF가 아니면 안내한다', async () => {
  await dropFile(files.notPdf);
  await expect(page.getByTestId('viewer-notice')).toHaveText(/PDF 파일만 열 수 있습니다/);

  await dropFile(files.basic);
  await expectPageRendered(1);
  await expect(page.getByTestId('file-name')).toHaveText('basic 기본.pdf');
  expect(page.url()).toBe('app://bundle/index.html');
});

test('렌더러는 임의 경로나 발급받지 않은 문서를 읽을 수 없다', async () => {
  const results = await page.evaluate(async () => ({
    forged: await window.api.openDroppedFile(new File(['%PDF-1.7'], 'forged.pdf')),
    unknownId: await window.api.readDocument({ id: '00000000-0000-4000-8000-000000000000' }),
    pathInsteadOfId: await window.api.readDocument(JSON.parse('{"id":"/etc/passwd"}') as never),
  }));
  expect(results).toEqual({
    forged: { ok: false, error: { code: 'INVALID_INPUT' } },
    unknownId: { ok: true, data: { status: 'rejected', reason: 'unreadable' } },
    pathInsteadOfId: { ok: false, error: { code: 'INVALID_INPUT' } },
  });
});

test('쪽 이동: 버튼, 번호 입력, 키보드, 메뉴, 스크롤', async () => {
  await openWithMenu(files.basic);
  await expectPageRendered(1);

  await expect(page.getByRole('button', { name: '이전 쪽' })).toBeDisabled();
  await page.getByRole('button', { name: '다음 쪽' }).click();
  await expect(pageInput()).toHaveValue('2');
  await expectPageRendered(2);

  await pageInput().fill('7');
  await pageInput().press('Enter');
  await expect(pageInput()).toHaveValue('7');
  await expectPageRendered(7);
  await expect(pageView(7)).toBeInViewport();

  // 번호 입력 뒤 포커스는 뷰어로 돌아오므로 쪽 이동 키가 바로 동작한다.
  await page.keyboard.press('ArrowRight');
  await expect(pageInput()).toHaveValue('8');
  await page.keyboard.press('PageUp');
  await expect(pageInput()).toHaveValue('7');
  await page.keyboard.press('End');
  await expect(pageInput()).toHaveValue('12');
  await expect(page.getByRole('button', { name: '다음 쪽' })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(pageInput()).toHaveValue('1');

  // 범위를 넘는 번호는 끝 쪽으로, 숫자가 아니면 그대로 둔다.
  await pageInput().fill('999');
  await pageInput().press('Enter');
  await expect(pageInput()).toHaveValue('12');
  await pageInput().fill('abc');
  await pageInput().press('Enter');
  await expect(pageInput()).toHaveValue('12');

  await app.evaluate(({ Menu }) => {
    (Menu.getApplicationMenu()?.getMenuItemById('first-page') as unknown as { click(): void }).click();
  });
  await expect(pageInput()).toHaveValue('1');

  // 스크롤하면 세로 중앙선에 걸린 쪽이 현재 쪽이 된다.
  const expected = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.viewer-scroll');
    const target = document.querySelector<HTMLElement>('.page[data-page-number="5"]');
    if (scroller === null || target === null) throw new Error('요소가 없다');
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta - scroller.clientHeight / 2 + 20;
    return '5';
  });
  await expect(pageInput()).toHaveValue(expected);
});

test('확대와 축소: 버튼, 범위 제한, 폭 맞춤, 핀치', async () => {
  await openWithMenu(files.basic);
  await expectPageRendered(1);
  const zoom = page.getByTestId('zoom-level');
  const parse = async (): Promise<number> => Number((await zoom.textContent())?.replace('%', ''));
  const pageWidth = async (): Promise<number> => (await pageView(1).boundingBox())?.width ?? 0;

  const fitted = await parse();
  const fittedWidth = await pageWidth();
  await expect(page.getByRole('button', { name: '폭 맞춤' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect.poll(parse).toBeGreaterThan(fitted);
  await expect.poll(pageWidth).toBeGreaterThan(fittedWidth);
  await expect(page.getByRole('button', { name: '폭 맞춤' })).toHaveAttribute('aria-pressed', 'false');
  await expectPageRendered(1);

  await page.getByRole('button', { name: '폭 맞춤' }).click();
  await expect.poll(parse).toBe(fitted);

  const zoomOut = page.getByRole('button', { name: '축소' });
  for (let step = 0; step < 15 && (await zoomOut.isEnabled()); step += 1) await zoomOut.click();
  await expect(zoom).toHaveText('50%');
  await expect(zoomOut).toBeDisabled();

  const zoomIn = page.getByRole('button', { name: '확대', exact: true });
  for (let step = 0; step < 15 && (await zoomIn.isEnabled()); step += 1) await zoomIn.click();
  await expect(zoom).toHaveText('400%');
  await expect(zoomIn).toBeDisabled();

  // 메뉴의 폭 맞춤과 트랙패드 핀치(ctrlKey가 붙은 wheel).
  await app.evaluate(({ Menu }) => {
    (Menu.getApplicationMenu()?.getMenuItemById('fit-width') as unknown as { click(): void }).click();
  });
  await expect.poll(parse).toBe(fitted);
  await page.evaluate(() => {
    document
      .querySelector('.viewer-scroll')
      ?.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -30, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  });
  await expect.poll(parse).toBeGreaterThan(fitted);
});

test('텍스트를 끌어 선택하고 복사한다', async () => {
  await openWithMenu(files.basic);
  await expectPageRendered(1);
  const span = pageView(1).locator('.textLayer span', { hasText: pageMarker(1) }).first();
  await expect(span).toBeVisible();
  const box = await span.boundingBox();
  if (box === null) throw new Error('글자 위치가 없다');

  await dragAcross(box);
  await page.screenshot({ path: join(root, 'test-results', 'selection-dev.png') });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(pageMarker(1));

  const previous = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await copySelection();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()).then((text) => text.trim()))
      .toBe(pageMarker(1));
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previous);
  }
});

test('복사 금지 문서는 읽을 수 있지만 복사되지 않는다', async () => {
  await openWithMenu(files.copyRestricted);
  await expectPageRendered(1);
  await expect(page.getByTestId('copy-restricted')).toBeVisible();
  expect((await canvasStats(1)).inkRatio).toBeGreaterThan(0.001);

  const previous = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('clipboard-before'));
    const span = pageView(1).locator('.textLayer span').first();
    const box = await span.boundingBox();
    if (box === null) throw new Error('글자 위치가 없다');
    await dragAcross(box);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

    // 선택을 스크립트로 강제해도 복사 동작이 본문을 내보내지 않는다.
    await page.evaluate(() => {
      const target = document.querySelector('.page[data-page-number="1"] .textLayer');
      if (target !== null) window.getSelection()?.selectAllChildren(target);
    });
    await copySelection();
    await page.waitForTimeout(300);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('clipboard-before');
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previous);
  }

  // 복사 제한이 다음 문서로 이어지지 않는다.
  await openWithMenu(files.basic);
  await expect(page.getByTestId('file-name')).toHaveText('basic 기본.pdf');
  await expect(page.getByTestId('copy-restricted')).toBeHidden();
});

test('손상된 PDF는 앱을 멈추지 않고 이유를 안내하며 이전 문서를 유지한다', async () => {
  for (const path of [files.corruptGarbage, files.corruptNoHeader, files.corruptTruncated]) {
    await openWithMenu(path);
    await expect(page.getByTestId('viewer-notice')).toHaveText(/이 파일은 손상되어 열 수 없습니다/);
    await expect(page.getByText('PDF를 여기에 끌어다 놓거나 열어 주세요')).toBeVisible();
    await page.getByRole('button', { name: '안내 닫기' }).click();
  }

  await openWithMenu(files.basic);
  await expectPageRendered(1);
  await openWithMenu(files.corruptGarbage);
  await expect(page.getByTestId('viewer-notice')).toHaveText(/손상되어/);
  await expect(page.getByTestId('file-name')).toHaveText('basic 기본.pdf');
  await expect(pageView(1).locator('.textLayer')).toContainText(pageMarker(1));
  await expect(page.getByTestId('page-count')).toHaveText('/ 12');
});

test('암호 PDF는 입력란 없이 열 수 없다고 안내한다', async () => {
  await openWithMenu(files.password);
  await expect(page.getByTestId('viewer-notice')).toHaveText(/암호가 걸린 PDF는 열 수 없습니다/);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText('PDF를 여기에 끌어다 놓거나 열어 주세요')).toBeVisible();
  await page.screenshot({ path: join(root, 'test-results', 'password-notice-dev.png') });
});

test('한글: 내장하지 않은 글꼴도 CMap으로 읽고 그린다', async () => {
  await openWithMenu(files.korean);
  await expectPageRendered(1);
  const textLayer = pageView(1).locator('.textLayer');
  await expect(textLayer).toContainText(KOREAN_UTF16_TEXT);
  await expect(textLayer).toContainText(KOREAN_UHC_TEXT);
  expect((await canvasStats(1)).inkRatio).toBeGreaterThan(0.001);
  await page.screenshot({ path: join(root, 'test-results', 'korean-dev.png') });
});

test('JPEG 2000 이미지는 WebAssembly 없이 JS 디코더로 그린다', async () => {
  await openWithMenu(files.jpx);
  await expectPageRendered(1);
  const { center } = await canvasStats(1);
  expect(center[0]).toBeGreaterThan(180);
  expect(center[1]).toBeLessThan(60);
  expect(center[2]).toBeLessThan(60);
});

test('PDF 안의 스크립트는 실행되지 않고 외부 링크는 열리지 않으며 내부 링크만 이동한다', async () => {
  await openWithMenu(files.links);
  await expectPageRendered(1);
  const links = pageView(1).locator('.annotationLayer a');
  await expect(links).toHaveCount(2);

  const external = page.locator('.annotationLayer a[title="https://example.com/outside"]');
  await expect(external).not.toHaveAttribute('href');
  await external.click();
  await expect(page.getByTestId('viewer-notice')).toContainText('외부 링크는 열지 않습니다: https://example.com/outside');
  expect(page.url()).toBe('app://bundle/index.html');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // 문서를 열 때 실행되도록 등록된 스크립트의 흔적이 없다. 샌드박스 스크립팅도 올라오지 않았다.
  const scripting = await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    return { sandbox: typeof scope.pdfjsSandbox, app: typeof scope.app, event: typeof scope.event };
  });
  expect(scripting.sandbox).toBe('undefined');
  expect(scripting.app).toBe('undefined');
  await expect(page.getByTestId('viewer-notice')).not.toContainText('pdf-script-ran');

  await page.locator('.annotationLayer a:not([title="https://example.com/outside"])').click();
  await expect(pageInput()).toHaveValue('3');
});

test('300쪽 문서: 3초 안에 첫 쪽이 뜨고 스크롤 중에도 멈추지 않는다', async () => {
  for (const [label, path] of [
    ['글만', files.large],
    ['쪽마다 이미지', files.largeWithImages],
  ] as const) {
    await dropFile(path);
    await expect(page.getByTestId('page-count')).toHaveText('/ 300', { timeout: 20_000 });
    await expectPageRendered(1);
    const firstPageMs = await page.evaluate(() => performance.getEntriesByName('pdf-first-page').at(-1)?.duration ?? -1);
    console.log(`[측정] 300쪽 ${label}: 첫 쪽 표시 ${firstPageMs.toFixed(0)}ms`);
    expect(firstPageMs).toBeGreaterThan(0);
    expect(firstPageMs).toBeLessThan(3000);

    const frames = await page.evaluate(
      () =>
        new Promise<{ count: number; p95: number; max: number; endTop: number }>((resolve) => {
          const scroller = document.querySelector<HTMLElement>('.viewer-scroll');
          if (scroller === null) throw new Error('뷰어가 없다');
          const intervals: number[] = [];
          const start = performance.now();
          let last = start;
          const step = (now: number): void => {
            intervals.push(now - last);
            last = now;
            scroller.scrollTop += 80;
            if (now - start < 4000) {
              requestAnimationFrame(step);
              return;
            }
            intervals.sort((a, b) => a - b);
            resolve({
              count: intervals.length,
              p95: intervals[Math.floor(intervals.length * 0.95)] ?? 0,
              max: intervals.at(-1) ?? 0,
              endTop: scroller.scrollTop,
            });
          };
          requestAnimationFrame(step);
        }),
    );
    console.log(
      `[측정] 300쪽 ${label}: 4초 스크롤 ${String(frames.count)}프레임, p95 ${frames.p95.toFixed(1)}ms, 최대 ${frames.max.toFixed(1)}ms`,
    );
    expect(frames.p95).toBeLessThan(100);
    expect(frames.max).toBeLessThan(1000);

    // 지연 렌더링: 전체 300쪽 중 일부만 캔버스를 갖는다.
    const canvases = await page.locator('.page canvas').count();
    console.log(`[측정] 300쪽 ${label}: 캔버스 ${String(canvases)}개`);
    expect(canvases).toBeLessThan(40);
  }
});

test('확정 디자인 토큰이 도구 막대, 버튼, 쪽 그림자에 적용된다', async () => {
  const style = (selector: string, property: string) =>
    page.evaluate(
      ([target, name]) => {
        const element = document.querySelector(target ?? '');
        if (element === null) throw new Error('요소가 없다');
        return getComputedStyle(element).getPropertyValue(name ?? '');
      },
      [selector, property],
    );

  expect(await style('button.primary', 'border-radius')).toBe('9999px');
  expect(await style('button.primary', 'background-color')).toBe('rgb(0, 102, 204)');
  expect(await style('button.primary', 'color')).toBe('rgb(255, 255, 255)');
  expect(await style('body', 'font-family')).toContain('Apple SD Gothic Neo');
  expect(await style('body', 'word-break')).toBe('keep-all');

  await openWithMenu(files.basic);
  await expectPageRendered(1);
  expect(await style('.toolbar', 'background-color')).toBe('rgb(250, 250, 252)');
  expect(await style('.toolbar', 'font-size')).toBe('14px');
  expect(await style('.viewer', 'background-color')).toBe('rgb(245, 245, 247)');
  expect(await style('.toolbar button', 'border-radius')).toBe('8px');
  expect(await style('.pdfViewer .page', 'box-shadow')).toBe('rgba(0, 0, 0, 0.22) 3px 5px 30px 0px');

  // 눌림 효과. 누르고 있는 동안 0.95배로 줄어든다.
  const button = page.getByRole('button', { name: '폭 맞춤' });
  const box = await button.boundingBox();
  if (box === null) throw new Error('버튼 위치가 없다');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => button.evaluate((element) => getComputedStyle(element).transform)).toBe(
    'matrix(0.95, 0, 0, 0.95, 0, 0)',
  );
  await page.mouse.up();
});
