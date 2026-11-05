import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..');
const { productName } = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8')) as { productName: string };
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

test('앱이 잠긴 보안 설정으로 뜨고 IPC 왕복이 동작한다', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ai-pdf-viewer-e2e-'));
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root, env: { ...process.env, AI_PDF_VIEWER_FAKE_PROVIDER: '1' } });

  try {
    const page = await app.firstWindow();

    // 앱 이름과 IPC로 받은 버전이 화면에 나온다.
    await expect(page.getByRole('heading', { name: productName })).toBeVisible();
    await expect(page).toHaveTitle(productName);
    await expect(page.getByTestId('app-version')).toHaveText(`버전 ${version}`);
    expect(page.url()).toBe('app://bundle/index.html');

    // 창의 보안 설정이 실제로 적용되어 있다.
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('창이 없다');
      // getLastWebPreferences는 공개 타입에 없는 내부 메서드다. 설정값을 코드가 아니라 실행 중인 창에서 읽기 위해 쓴다.
      const contents = window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
      const { contextIsolation, nodeIntegration, sandbox } = contents.getLastWebPreferences();
      return { contextIsolation, nodeIntegration, sandbox };
    });
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });

    // 렌더러에는 Node 전역이 없고, 노출된 API는 계약에 있는 것뿐이다.
    const surface = await page.evaluate(() => {
      const scope = window as unknown as Record<string, unknown>;
      return {
        require: typeof scope.require,
        process: typeof scope.process,
        apiKeys: Object.keys(window.api).sort(),
      };
    });
    expect(surface).toEqual({ require: 'undefined', process: 'undefined', apiKeys: ['askTutor', 'deleteKey', 'getKeyStatus', 'getVersion', 'listRecentDocuments', 'onKeyChanged', 'onMenuCommand', 'onTutorEvent', 'openDroppedFile', 'openPdfDialog', 'openRecentDocument', 'openSettings', 'readDocument', 'resolveSendScope', 'saveKey', 'setProvider', 'stopTutor'] });

    // 메인 프로세스가 잘못된 입력을 거부한다.
    const rejected = await page.evaluate(() =>
      window.api.getVersion(JSON.parse('{"component":"../../etc/passwd"}') as never),
    );
    expect(rejected).toEqual({ ok: false, error: { code: 'INVALID_INPUT' } });

    // CSP가 인라인 스크립트와 렌더러의 직접 네트워크 요청을 막는다.
    const csp = await page.evaluate(async () => {
      const scope = window as unknown as Record<string, unknown>;
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(event.effectiveDirective);
      });

      const script = document.createElement('script');
      script.textContent = 'window.__inlineRan = true';
      document.head.append(script);
      const network = await fetch('https://example.com/').then(
        () => 'allowed',
        () => 'blocked',
      );
      // 위반 이벤트는 비동기로 전달된다.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { inlineRan: scope.__inlineRan === true, network, violations: violations.sort() };
    });
    expect(csp).toEqual({
      inlineRan: false,
      network: 'blocked',
      violations: ['connect-src', 'script-src-elem'],
    });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
