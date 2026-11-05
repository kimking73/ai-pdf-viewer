// 채널 이름만 둔다. preload가 zod를 번들하지 않도록 contract.ts와 분리했다.
export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  pdfShowOpenDialog: 'pdf:show-open-dialog',
  pdfOpenDropped: 'pdf:open-dropped',
  pdfReadDocument: 'pdf:read-document',
  pdfListRecent: 'pdf:list-recent',
  pdfOpenRecent: 'pdf:open-recent',
  tutorResolveScope: 'tutor:resolve-scope',
  tutorAsk: 'tutor:ask',
  tutorStop: 'tutor:stop',
  keyGetStatus: 'key:get-status',
  keySave: 'key:save',
  keyDelete: 'key:delete',
  providerSet: 'provider:set',
  settingsOpen: 'settings:open',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// 메인에서 렌더러로만 가는 알림. 렌더러가 보내는 요청이 아니므로 계약에 넣지 않는다.
export const IPC_EVENTS = {
  menuCommand: 'menu:command',
  tutorEvent: 'tutor:event',
  keyChanged: 'key:changed',
} as const;
