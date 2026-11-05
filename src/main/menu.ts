import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../shared/app-config';
import { IPC_EVENTS } from '../shared/ipc/channels';
import type { MenuCommand } from '../shared/ipc/menu-commands';

// 단축키는 docs/design-contract.md 7.1절을 따른다. 뷰어 포커스에서만 동작하는 쪽 이동 키는
// 메뉴 단축키로 등록하지 않는다. 등록하면 쪽 번호 입력란에서도 방향키를 가로채기 때문이다.
export function installApplicationMenu({
  getMainWindow,
  getFocusedSettingsWindow,
  openSettings,
}: {
  getMainWindow: () => BrowserWindow | null;
  getFocusedSettingsWindow: () => BrowserWindow | null;
  openSettings: () => void;
}): void {
  const command = (
    id: MenuCommand,
    label: string,
    accelerator?: string,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => ({
    id,
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    ...extra,
    click: () => {
      // 설정 창의 입력란에서는 전체 선택이 그 입력란에 적용되어야 한다. 나머지 동작은 본 창의 것이다.
      const settings = getFocusedSettingsWindow();
      if (id === 'select-all' && settings !== null) {
        settings.webContents.selectAll();
        return;
      }
      getMainWindow()?.webContents.send(IPC_EVENTS.menuCommand, id);
    },
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `${APP_NAME} 정보` },
        { type: 'separator' },
        { label: '설정…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { type: 'separator' },
        { role: 'hide', label: `${APP_NAME} 가리기` },
        { role: 'hideOthers', label: '기타 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: `${APP_NAME} 종료` },
      ],
    },
    {
      label: '파일',
      submenu: [
        command('open-pdf', 'PDF 열기…', 'CmdOrCtrl+O'),
        { type: 'separator' },
        { role: 'close', label: '창 닫기' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '실행 복귀' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        // 표준 전체 선택은 문서 전체를 고른다. 뷰어에서는 현재 쪽만 선택하도록 렌더러가 처리한다(계약 5.3절).
        command('select-all', '전체 선택', 'CmdOrCtrl+A'),
      ],
    },
    {
      label: '보기',
      submenu: [
        command('zoom-in', '확대', 'CmdOrCtrl+Plus'),
        // 일반 키보드의 ⌘=도 확대로 받는다.
        command('zoom-in', '확대', 'CmdOrCtrl+=', { visible: false, acceleratorWorksWhenHidden: true }),
        command('zoom-out', '축소', 'CmdOrCtrl+-'),
        command('fit-width', '폭 맞춤', 'CmdOrCtrl+0'),
        { type: 'separator' },
        command('toggle-area-mode', '영역 선택', 'CmdOrCtrl+Shift+R'),
        command('toggle-panel', '패널 접기·펴기', 'Ctrl+CmdOrCtrl+S'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        // 배포 빌드에는 개발용 항목(새로고침, 개발자 도구)을 넣지 않는다.
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload', label: '새로고침' },
              { role: 'toggleDevTools', label: '개발자 도구' },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '이동',
      submenu: [
        command('go-to-page', '쪽 번호로 이동', 'Alt+CmdOrCtrl+G'),
        { type: 'separator' },
        command('previous-page', '이전 쪽'),
        command('next-page', '다음 쪽'),
        command('first-page', '첫 쪽'),
        command('last-page', '끝 쪽'),
      ],
    },
    {
      label: '튜터',
      submenu: [
        command('focus-question', '질문 입력으로 이동', 'CmdOrCtrl+L'),
        command('stop-answer', '답변 중지', 'CmdOrCtrl+.'),
      ],
    },
    { role: 'windowMenu', label: '윈도우' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
