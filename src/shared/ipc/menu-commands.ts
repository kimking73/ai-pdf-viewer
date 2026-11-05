// 앱 메뉴가 렌더러에 전달하는 동작의 전체 목록. 메뉴는 동작 이름만 보내고 처리는 렌더러가 한다.
export const MENU_COMMANDS = [
  'open-pdf',
  'zoom-in',
  'zoom-out',
  'fit-width',
  'go-to-page',
  'previous-page',
  'next-page',
  'first-page',
  'last-page',
  'select-all',
  'toggle-area-mode',
  'toggle-panel',
  'focus-question',
  'stop-answer',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];
