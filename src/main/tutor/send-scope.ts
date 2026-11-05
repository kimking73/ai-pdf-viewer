import type { ScopeSelection, SendScope, TutorContext } from '../../shared/ipc/contract';

// 앞뒤 쪽 수와 포함할 이전 대화 수는 4단계 품질 확인에서 정한다.
export const NEIGHBOR_PAGES = 1;
export const MAX_PREVIOUS_TURNS = 4;

export interface ScopeMaterial {
  currentPage: number;
  pageCount: number;
  selection: ScopeSelection | null;
  pageImage?: boolean | undefined;
}

export function resolveSendScope(
  material: ScopeMaterial,
  turns: number,
  corrections: number,
  provider: SendScope['provider'] = 'openai',
): SendScope {
  const { currentPage, pageCount, selection } = material;
  const basePage = selection?.page ?? currentPage;
  return {
    basePage,
    firstPage: Math.max(1, basePage - NEIGHBOR_PAGES),
    lastPage: Math.min(pageCount, basePage + NEIGHBOR_PAGES),
    currentPage,
    selection,
    previousTurns: Math.min(turns, MAX_PREVIOUS_TURNS),
    corrections,
    // 영역을 골랐으면 그 영역만 보낸다. 쪽 이미지는 고른 것이 없을 때만 쓴다.
    ...(material.pageImage === true && selection === null ? { pageImage: true } : {}),
    provider,
  };
}

// 렌더러가 보낸 내용 중 확정된 범위에 맞는 것만 남긴다. 범위 표시와 실제 전송이 어긋나지 않게 한다.
export function fitContextToScope(context: TutorContext, scope: SendScope): TutorContext {
  const pageImage = scope.pageImage === true ? (context.pageImage ?? null) : null;
  return {
    pages: context.pages.filter(({ page }) => page >= scope.firstPage && page <= scope.lastPage),
    selectionText: scope.selection?.kind === 'text' ? context.selectionText : null,
    areaImage: scope.selection?.kind === 'area' ? context.areaImage : null,
    ...(pageImage === null ? {} : { pageImage }),
  };
}
