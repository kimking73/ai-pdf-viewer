import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageMarker, removeFixtures, writeFixtures, type FixtureFiles } from './fixtures/pdfs';

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

async function menu(id: string): Promise<void> {
  await app.evaluate(({ Menu }, target) => {
    (Menu.getApplicationMenu()?.getMenuItemById(target) as unknown as { click(): void }).click();
  }, id);
}

async function open(path: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, path);
  await menu('open-pdf');
  await expect(page.locator('.page[data-page-number="1"]')).toHaveAttribute('data-loaded', 'true', { timeout: 20_000 });
  await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
}

const input = () => page.getByTestId('question-input');
const scopeLine = () => page.getByTestId('scope-line');
const turns = () => page.getByTestId('turn');
const pageBox = async (number: number) => {
  const box = await page.locator(`.page[data-page-number="${String(number)}"]`).boundingBox();
  if (box === null) throw new Error('쪽이 보이지 않는다');
  return box;
};

async function drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

// 글자가 없는 쪽 가운데에서 끈다.
async function dragArea(number = 1): Promise<void> {
  const box = await pageBox(number);
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.5;
  await drag({ x, y }, { x: x + 120, y: y + 90 });
}

async function dragText(): Promise<void> {
  const span = await page.locator('.page[data-page-number="1"] .textLayer span').getByText(pageMarker(1)).boundingBox();
  if (span === null) throw new Error('글자가 없다');
  const y = span.y + span.height / 2;
  await drag({ x: span.x + 1, y }, { x: span.x + span.width - 1, y }, 12);
}

const waitDone = () => expect(turns().last()).toHaveAttribute('data-status', 'done', { timeout: 20_000 });

test('패널의 [설정]으로 키 입력 창을 연다', async () => {
  const opened = app.waitForEvent('window');
  await page.getByTestId('open-settings').click();
  const settings = await opened;
  await expect(settings.getByTestId('settings')).toBeVisible();
  await expect(settings.getByTestId('provider-openai')).toBeVisible();
  await expect(settings.getByTestId('key-input')).toBeFocused();
  await expect(settings.getByTestId('key-save')).toBeDisabled();
});

test('패널의 기본 상태와 폭, 접기, 구분선', async () => {
  const panel = page.getByTestId('tutor-panel');
  await expect(panel).toContainText('문서를 열면 지금 보는 쪽을 함께 보며 답합니다');
  await expect(input()).toHaveCount(0);
  await expect(page.getByTestId('fake-banner')).toBeVisible();

  await open(files.basic);
  await expect(panel).toContainText('막히는 곳을 질문하거나');
  expect((await panel.boundingBox())?.width).toBe(396);

  const divider = page.getByTestId('panel-divider');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '412');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '380');

  // 끄는 동안에는 CSS 배율로만 맞추고, 끝나면 다시 그리며 보던 쪽을 유지한다.
  await menu('last-page');
  await expect(page.getByRole('textbox', { name: /현재 12쪽/ })).toBeVisible();
  const dividerBox = await divider.boundingBox();
  if (dividerBox === null) throw new Error('구분선이 없다');
  await page.mouse.move(dividerBox.x, 400);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x - 60, 400, { steps: 4 });
  await expect(page.locator('.pdfViewer')).toHaveAttribute('style', /scale/);
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', /^44[01]$/);
  await expect.poll(() => page.locator('.pdfViewer').getAttribute('style').then((style) => style ?? '')).not.toMatch(/scale\(/);
  await expect(page.getByRole('textbox', { name: /현재 12쪽/ })).toBeVisible();

  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '396');

  // 최소 창에서도 뷰어 최소 폭을 지킨다.
  await page.setViewportSize({ width: 800, height: 600 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(800, 600);
  });
  await expect(divider).toHaveAttribute('aria-valuenow', '360');
  const viewer = await page.locator('.viewer').boundingBox();
  expect(viewer?.width).toBeGreaterThanOrEqual(440);

  await menu('toggle-panel');
  await expect(panel).toBeHidden();
  await expect(divider).toHaveCount(0);
  await expect(page.getByTestId('panel-toggle')).toBeFocused();
  await menu('focus-question');
  await expect(panel).toBeVisible();
  await expect(input()).toBeFocused();
});

test('범위는 메인이 확정해 표시하고 쪽 이동을 따라가며 자세히는 Esc로 닫힌다', async () => {
  await open(files.basic);
  await expect(scopeLine()).toHaveText('p.1~2');
  await expect(page.getByTestId('scope-provider')).toHaveText('가짜 응답(전송 없음)');
  await expect(input()).toHaveAttribute('aria-describedby', 'tutor-scope');

  await menu('next-page');
  await expect(scopeLine()).toHaveText('p.1~3');
  await menu('last-page');
  await expect(scopeLine()).toHaveText('p.11~12');

  const toggle = page.getByRole('button', { name: '자세히' });
  await toggle.click();
  await expect(page.getByTestId('scope-details')).toContainText('문서 전체는 보내지 않습니다');
  await expect(page.getByTestId('scope-details')).toContainText('이전 대화 0턴');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('scope-details')).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // 렌더러가 범위를 정하거나 없는 문서를 대는 요청은 메인이 막는다.
  const forged = await page.evaluate(() =>
    Promise.all([
      window.api.resolveSendScope({ documentId: '00000000-0000-4000-8000-000000000000', currentPage: 1, pageCount: 1, selection: null }),
      window.api.resolveSendScope({ documentId: 'x', currentPage: 1, pageCount: 1, selection: null }),
    ]),
  );
  expect(forged[0]).toEqual({ ok: true, data: { status: 'no-document' } });
  expect(forged[1]).toEqual({ ok: false, error: { code: 'INVALID_INPUT' } });
});

test('영역 선택: 시작점 규칙, 칩, 입력창 포커스, 범위 고정, 해제', async () => {
  await open(files.basic);
  await dragArea();
  const chip = page.getByTestId('selection-chip');
  await expect(chip).toHaveAttribute('data-kind', 'area');
  await expect(chip).toContainText('선택 영역 · p.1');
  expect(await chip.locator('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  await expect(input()).toBeFocused();
  await expect(scopeLine()).toHaveText('p.1~2 · 선택 영역 1개(p.1)');
  await expect(page.getByTestId('selection-area')).toBeVisible();

  // 스크롤해도 범위는 선택 쪽 기준이고 3줄째로 알린다.
  await menu('last-page');
  await expect(page.getByTestId('scope-notice')).toHaveText('선택 기준입니다. 지금 보는 p.12은 보내지 않습니다.');
  await expect(scopeLine()).toHaveText('p.1~2 · 선택 영역 1개(p.1)');

  await chip.getByRole('button', { name: '선택 해제' }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByTestId('selection-overlay')).toHaveCount(0);
  await expect(scopeLine()).toHaveText('p.11~12');

  // 4px 미만은 클릭, 24px 미만은 버린다.
  await menu('first-page');
  const box = await pageBox(1);
  await drag({ x: box.x + 200, y: box.y + 500 }, { x: box.x + 210, y: box.y + 510 });
  await expect(chip).toHaveCount(0);

  // 쪽 경계를 넘겨도 시작한 쪽으로 제한한다.
  await menu('next-page');
  await expect(scopeLine()).toHaveText('p.1~3');
  const second = await pageBox(2);
  await drag({ x: second.x + 200, y: second.y + 60 }, { x: second.x + 300, y: second.y - 80 });
  await expect(chip).toContainText('p.2');
  const area = await page.getByTestId('selection-area').boundingBox();
  expect(area?.y).toBeGreaterThanOrEqual(second.y - 1);

  // 빈 곳 단일 클릭은 해제한다.
  await page.mouse.click(second.x + 200, second.y + 400);
  await expect(chip).toHaveCount(0);
});

test('영역 모드: 켜고 끄기, 글자 위에서도 영역, 1회용, 키보드 대안', async () => {
  await open(files.basic);
  const mode = page.getByTestId('area-mode');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('viewer-scroll').focus();
  await page.keyboard.press('Escape');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');

  await page.getByTestId('viewer-scroll').focus();
  await page.keyboard.press('r');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');

  const span = await page.locator('.page[data-page-number="1"] .textLayer span').first().boundingBox();
  if (span === null) throw new Error('글자가 없다');
  await drag({ x: span.x + 2, y: span.y + 2 }, { x: span.x + 90, y: span.y + 70 });
  await expect(page.getByTestId('selection-chip')).toHaveAttribute('data-kind', 'area');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');

  // 키보드: Enter로 놓고 방향키로 옮긴 뒤 Enter로 확정한다. Esc는 취소한다.
  await page.getByTestId('selection-chip').getByRole('button', { name: '선택 해제' }).click();
  await page.getByTestId('viewer-scroll').focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(page.locator('.area-draft')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.area-draft')).toBeHidden();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  const before = await page.locator('.area-draft').boundingBox();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  const after = await page.locator('.area-draft').boundingBox();
  expect(after?.y).toBeCloseTo((before?.y ?? 0) + 8, 0);
  expect(after?.width).toBeCloseTo((before?.width ?? 0) + 8, 0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selection-chip')).toHaveAttribute('data-kind', 'area');
  await expect(input()).toBeFocused();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
});

test('텍스트 선택: 칩과 질문하기, 포커스 유지, 복사, 전체 선택은 현재 쪽만', async () => {
  await open(files.basic);
  await page.getByTestId('viewer-scroll').focus();
  await dragText();
  const chip = page.getByTestId('selection-chip');
  await expect(chip).toHaveAttribute('data-kind', 'text');
  await expect(chip).toContainText(pageMarker(1));
  await expect(chip).toContainText(`${String(pageMarker(1).length)}자 · p.1`);
  await expect(input()).not.toBeFocused();
  await expect(scopeLine()).toHaveText('p.1~2 · 선택한 글 1개(p.1)');

  // 복사는 그대로 동작한다.
  const previous = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.copy();
    });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(pageMarker(1));
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previous);
  }

  await page.getByTestId('selection-ask').click();
  await expect(input()).toBeFocused();
  await expect(page.getByTestId('selection-ask')).toHaveCount(0);
  await expect(chip).toBeVisible();

  // 입력창의 전체 선택은 입력창만 고른다.
  await input().fill('abc');
  await menu('select-all');
  expect(await input().evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe(3);

  // 뷰어의 전체 선택은 현재 쪽 글만 고른다.
  await page.getByTestId('viewer-scroll').focus();
  await menu('select-all');
  await expect(chip).toContainText(pageMarker(1));
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected).toContain(pageMarker(1));
  expect(selected).not.toContain(pageMarker(2));

  // 뷰어 포커스의 Esc는 선택을 해제하고, 입력창의 Esc는 글을 지우지 않는다.
  await input().focus();
  await page.keyboard.press('Escape');
  await expect(input()).toHaveValue('abc');
  await expect(chip).toBeVisible();
  await page.getByTestId('viewer-scroll').focus();
  await page.keyboard.press('Escape');
  await expect(chip).toHaveCount(0);
});

test('답변 화면: 스트리밍, 가짜 표시, 읽은 내용, 근거 이동, 범위 밖 번호, 요약', async () => {
  await open(files.basic);
  await menu('next-page');
  await dragArea(2);
  await input().fill('이 수식이 뭔가요');
  await page.keyboard.press('Enter');

  await expect(input()).toHaveValue('');
  await expect(input()).toBeFocused();
  const turn = turns().last();
  await expect(turn).toContainText('이 수식이 뭔가요');
  await expect(page.getByTestId('frozen-scope')).toHaveText('확정 범위: p.1~3 · 선택 영역 1개 · 전송 안 함(가짜 응답)');
  await expect(page.getByTestId('reading')).toHaveText('p.2를 읽는 중…');
  await expect(page.getByTestId('stop')).toBeVisible();

  // 진행 중에는 입력할 수 있어도 Enter로 보내지 못하고 줄바꿈도 들어가지 않는다.
  await input().fill('다음 질문');
  await page.keyboard.press('Enter');
  await expect(input()).toHaveValue('다음 질문');
  await expect(turns()).toHaveCount(1);

  await expect(page.getByTestId('recap')).toContainText('읽은 내용');
  await expect(page.getByTestId('recap')).toContainText('(불확실)');
  await waitDone();
  await expect(page.getByTestId('fake-label')).toBeVisible();
  await expect(page.getByTestId('answer-paragraph').first()).toContainText('[가짜 응답]');
  await expect(page.getByTestId('source-general')).toHaveText('일반 지식');
  await expect(page.getByTestId('source-plain')).toContainText('p.53');
  await expect(page.getByTestId('source-summary')).toHaveText('근거: p.2 · 일반 지식 포함');

  await menu('last-page');
  // 전송 뒤 현재 쪽이 선택 쪽을 벗어나면 선택이 풀린다.
  await expect(page.getByTestId('selection-chip')).toHaveCount(0);
  await expect(scopeLine()).toHaveText('p.11~12');
  await expect(page.getByTestId('scope-provider')).toHaveText('이전 대화 일부 포함 · 가짜 응답(전송 없음)');

  const source = page.getByTestId('source-page');
  await expect(source).toHaveAttribute('aria-label', '근거 2쪽');
  await source.click();
  await expect(page.getByRole('textbox', { name: /현재 2쪽/ })).toBeVisible();
  await expect(source).toBeFocused();
});

test('중지와 다시 보내기, 잘못 읽음 흐름', async () => {
  await open(files.basic);
  await dragArea();
  await input().fill('첫 질문');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer-paragraph').first()).toBeVisible();

  await menu('stop-answer');
  await expect(turns().last()).toHaveAttribute('data-status', 'stopped');
  await expect(page.getByTestId('turn-ended')).toHaveText('중지됨');
  const partial = await page.getByTestId('answer-paragraph').first().textContent();
  expect(partial?.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '다시 보내기' }).click();
  await expect(turns()).toHaveCount(2);
  await waitDone();

  // 잘못 읽음: Esc로 닫으면 버튼으로 돌아온다.
  const wrong = page.getByTestId('wrong-read').last();
  await wrong.click();
  await expect(page.getByTestId('correction-input')).toBeFocused();
  await expect(page.getByTestId('correction')).toContainText('같은 범위(p.1~2 · 선택 영역 1개)');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('correction')).toHaveCount(0);
  await expect(wrong).toBeFocused();

  await wrong.click();
  await page.getByTestId('correction-input').fill('첨자가 i가 아니라 j입니다');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('recap-correction').last()).toContainText('첨자가 i가 아니라 j입니다');
  await expect(page.getByTestId('previous-answer')).toContainText('고치기 전 답변');
  await waitDone();
  await page.getByRole('button', { name: '자세히' }).click();
  await expect(page.getByTestId('scope-details')).toContainText('내가 고친 내용 1건');
});

test('패널이 접혀 있으면 답변 상태를 패널 버튼에 표시한다', async () => {
  await open(files.basic);
  await input().fill('질문');
  await page.keyboard.press('Enter');
  await menu('toggle-panel');
  const toggle = page.getByTestId('panel-toggle');
  await expect(toggle).toHaveAttribute('aria-label', '패널, 답변 받는 중');
  await expect(page.getByTestId('panel-status')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-label', '패널, 새 답변 있음', { timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', '패널');
});

test('자동 스크롤은 맨 아래에 있을 때만 따라가고 위로 올리면 맨 아래로 버튼이 뜬다', async () => {
  await open(files.basic);
  const conversation = page.getByTestId('conversation');
  for (const [index, question] of ['하나', '둘'].entries()) {
    await input().fill(question);
    await page.keyboard.press('Enter');
    // 새 턴이 생긴 뒤에 기다려야 앞 턴의 완료 상태로 넘어가지 않는다.
    await expect(turns()).toHaveCount(index + 1);
    await waitDone();
  }
  await input().fill('셋');
  await page.keyboard.press('Enter');
  await expect(turns()).toHaveCount(3);
  await expect(page.getByTestId('answer-paragraph').last()).toBeVisible();
  await conversation.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByTestId('jump-bottom')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await conversation.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByTestId('jump-bottom').click();
  await expect(page.getByTestId('jump-bottom')).toHaveCount(0);
  await waitDone();
  expect(await conversation.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(24);
});

// 실제 입력기를 쓸 수 없어 조합은 CDP로 만들고, 조합 중 Enter의 keydown은 입력기가 보내는 값으로 만들어 넣는다.
test('한글 조합 중 Enter는 한 번에 전체를 보내고 찌꺼기를 남기지 않는다', async () => {
  await open(files.basic);
  await input().focus();
  const cdp = await page.context().newCDPSession(page);
  const composingEnter = (shiftKey = false) =>
    input().evaluate((element, shift) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, shiftKey: shift, bubbles: true, cancelable: true }),
      );
    }, shiftKey);
  const compose = async (text: string) => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  };
  const commit = (text: string) => cdp.send('Input.insertText', { text });

  await page.keyboard.insertText('안녕하세');
  await compose('요');
  await composingEnter();
  await commit('요');
  await expect(turns()).toHaveCount(1);
  await expect(turns().first().locator('.turn-question')).toHaveText('안녕하세요');
  await expect(input()).toHaveValue('');
  // 조합을 끝낸 Enter가 뒤따라 와도 다시 보내지 않는다.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await expect(turns()).toHaveCount(1);
  await expect(input()).toHaveValue('');

  // 답변 진행 중: 글자는 확정되어 남고 전송되지 않는다.
  await compose('값');
  await composingEnter();
  await commit('값');
  await page.waitForTimeout(150);
  await expect(input()).toHaveValue('값');
  await expect(turns()).toHaveCount(1);
  await waitDone();

  // 조합 중 Shift+Enter: 확정 뒤 줄바꿈.
  await compose('요');
  await composingEnter(true);
  await commit('요');
  await expect(input()).toHaveValue('값요\n');
  await expect(turns()).toHaveCount(1);
  await input().fill('');

  // 일본어 후보 확정은 전송하지 않고, 한 번 더 눌러야 보낸다.
  await compose('にほん');
  await composingEnter();
  await commit('日本');
  await page.waitForTimeout(150);
  await expect(input()).toHaveValue('日本');
  await expect(turns()).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(turns()).toHaveCount(2);
  await expect(input()).toHaveValue('');
  await cdp.detach();
});

test('복사 금지 문서는 읽을 수 있지만 입력과 선택이 막힌다', async () => {
  await open(files.copyRestricted);
  await expect(page.getByTestId('tutor-blocked')).toHaveText('이 문서는 복사 금지로 설정되어 AI로 보내지 않습니다. 읽기는 계속할 수 있습니다.');
  await expect(page.getByTestId('scope')).toHaveText('이 문서는 AI로 보내지 않습니다');
  await expect(input()).toBeDisabled();
  await expect(page.getByTestId('send')).toBeDisabled();
  await expect(page.getByTestId('area-mode')).toBeDisabled();
  await dragArea();
  await expect(page.getByTestId('selection-chip')).toHaveCount(0);
});

test('다른 문서를 열면 선택과 대화가 지워진다', async () => {
  await open(files.basic);
  await dragArea();
  await input().fill('질문');
  await page.keyboard.press('Enter');
  await expect(turns()).toHaveCount(1);
  await waitDone();
  await open(files.korean);
  await expect(turns()).toHaveCount(0);
  await expect(page.getByTestId('selection-chip')).toHaveCount(0);
  await expect(scopeLine()).toHaveText(/^p\.1/);
  await expect(page.getByTestId('scope-provider')).toHaveText('가짜 응답(전송 없음)');
});

test('선택 표시는 배율이 바뀌어도 쪽의 같은 자리에 있다', async () => {
  await open(files.basic);
  await dragArea();
  const ratio = async () => {
    const page1 = await pageBox(1);
    const area = await page.getByTestId('selection-area').boundingBox();
    return ((area?.x ?? 0) - page1.x) / page1.width;
  };
  const before = await ratio();
  await menu('zoom-in');
  await page.waitForTimeout(300);
  expect(await ratio()).toBeCloseTo(before, 2);
  await page.getByTestId('selection-chip').waitFor();
  await page.screenshot({ path: join(root, 'test-results', 'tutor-selection.png') });
});
