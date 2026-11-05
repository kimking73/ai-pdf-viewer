import { providerName } from './ai-model';
import type { SendScope } from './ipc/contract';

// 범위 문구의 원본. 화면의 모든 범위 표시는 메인이 확정한 SendScope에서 이 함수들로 만든다(계약 3.3, 6절).

export const FAKE_PROVIDER_LABEL = '가짜 응답(전송 없음)';

export function formatPageRange({ firstPage, lastPage }: Pick<SendScope, 'firstPage' | 'lastPage'>): string {
  return firstPage === lastPage ? `p.${String(firstPage)}` : `p.${String(firstPage)}~${String(lastPage)}`;
}

function selectionLabel(scope: SendScope): string {
  return scope.selection?.kind === 'area' ? '선택 영역 1개' : '선택한 글 1개';
}

/** 1줄: 쪽 범위, 선택 종류와 개수, 선택 쪽. */
export function formatScopeLine(scope: SendScope): string {
  const range = formatPageRange(scope);
  if (scope.selection === null) return range;
  return `${range} · ${selectionLabel(scope)}(p.${String(scope.selection.page)})`;
}

/** 2줄: 이전 대화 포함 여부, 제공사. */
export function formatProviderLine(scope: SendScope): string {
  const label = scope.provider === 'fake' ? FAKE_PROVIDER_LABEL : `${providerName(scope.provider)}로 전송`;
  return scope.previousTurns > 0 ? `이전 대화 일부 포함 · ${label}` : label;
}

/** 3줄: 선택 쪽과 현재 쪽이 다를 때만. */
export function formatScopeNotice(scope: SendScope): string | null {
  if (scope.selection === null || scope.selection.page === scope.currentPage) return null;
  const outside = scope.currentPage < scope.firstPage || scope.currentPage > scope.lastPage;
  return outside ? `선택 기준입니다. 지금 보는 p.${String(scope.currentPage)}은 보내지 않습니다.` : '선택 기준입니다.';
}

/** 질문 아래에 고정해 두는 문구. 이 턴에서 실제로 보낸 범위를 그대로 적는다. */
export function formatFrozenScope(scope: SendScope): string {
  const selection = scope.selection === null ? '' : ` · ${selectionLabel(scope)}`;
  const sent = scope.provider === 'fake' ? '전송 안 함(가짜 응답)' : `${providerName(scope.provider)}로 전송`;
  return `확정 범위: ${formatPageRange(scope)}${selection} · ${sent}`;
}
