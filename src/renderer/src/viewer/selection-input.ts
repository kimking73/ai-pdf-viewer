import {
  CLICK_MAX_MOVE_PX,
  clamp01,
  decideDragKind,
  isLargeEnough,
  nudgeRect,
  rectFromPoints,
  TEXT_NEAR_PX,
  type ActiveSelection,
  type PageRect,
} from './selection-model';

export interface SelectionInputOptions {
  pageElement(page: number): HTMLElement | null;
  currentPage(): number;
  isAreaMode(): boolean;
  /** 복사 금지 문서는 선택을 만들지 않는다. */
  isEnabled(): boolean;
  onSelect(selection: ActiveSelection): void;
  onClear(): void;
  onAreaFinished(): void;
  onAnnounce(message: string): void;
}

const THUMBNAIL_PX = 88;
const FOLLOW_SELECTION_MS = 200;

function pageOf(target: EventTarget | null): { element: HTMLElement; page: number } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('.page[data-page-number]') : null;
  if (element === null) return null;
  return { element, page: Number(element.dataset.pageNumber) };
}

function hasTextNear(pageElement: HTMLElement, x: number, y: number): boolean {
  for (const span of pageElement.querySelectorAll('.textLayer span')) {
    const box = span.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (
      x >= box.left - TEXT_NEAR_PX &&
      x <= box.right + TEXT_NEAR_PX &&
      y >= box.top - TEXT_NEAR_PX &&
      y <= box.bottom + TEXT_NEAR_PX
    ) {
      return true;
    }
  }
  return false;
}

function toPagePoint(pageElement: HTMLElement, x: number, y: number): { x: number; y: number } {
  const box = pageElement.getBoundingClientRect();
  return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
}

// 선택 표시는 앱이 따로 그리므로 썸네일에 들어가지 않는다(계약 5.4절).
export function cropArea(pageElement: HTMLElement, rect: PageRect, maxPx = THUMBNAIL_PX): string {
  const source = pageElement.querySelector('canvas');
  if (source === null) return '';
  const sourceWidth = rect.width * source.width;
  const sourceHeight = rect.height * source.height;
  const scale = Math.min(1, maxPx / Math.max(sourceWidth, sourceHeight));
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(sourceWidth * scale));
  target.height = Math.max(1, Math.round(sourceHeight * scale));
  target
    .getContext('2d')
    ?.drawImage(source, rect.x * source.width, rect.y * source.height, sourceWidth, sourceHeight, 0, 0, target.width, target.height);
  return target.toDataURL('image/png');
}

interface AreaDrag {
  kind: 'area';
  element: HTMLElement;
  page: number;
  startClient: { x: number; y: number };
  startPoint: { x: number; y: number };
  rect: PageRect | null;
  moved: boolean;
}

interface TextDrag {
  kind: 'text';
  element: HTMLElement;
  page: number;
  startClient: { x: number; y: number };
}

// 뷰어의 포인터 입력을 선택으로 바꾼다. 어느 쪽 선택이 될지는 드래그를 시작한 지점이 정한다(계약 5.1절).
export class SelectionInput {
  private readonly abort = new AbortController();
  private drag: AreaDrag | TextDrag | null = null;
  private keyboardArea: { page: number; rect: PageRect } | null = null;
  private readonly draft: HTMLDivElement;
  private hoverFrame = 0;
  private stopFollowing: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: SelectionInputOptions,
  ) {
    this.draft = document.createElement('div');
    this.draft.className = 'area-draft';
    this.draft.hidden = true;
    container.append(this.draft);

    const { signal } = this.abort;
    container.addEventListener('pointerdown', this.handlePointerDown, { capture: true, signal });
    container.addEventListener('mousedown', this.handleMouseDown, { capture: true, signal });
    container.addEventListener('pointermove', this.handleHover, { passive: true, signal });
    window.addEventListener('pointermove', this.handlePointerMove, { signal });
    window.addEventListener('pointerup', this.handlePointerUp, { signal });
    window.addEventListener('pointercancel', this.cancelDrag, { signal });
    window.addEventListener('keydown', this.trackAlt, { capture: true, signal });
    window.addEventListener('keyup', this.trackAlt, { capture: true, signal });
    window.addEventListener('blur', this.releaseAlt, { signal });
  }

  destroy(): void {
    this.abort.abort();
    this.stopFollowing?.();
    cancelAnimationFrame(this.hoverFrame);
    this.draft.remove();
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  get isKeyboardAreaActive(): boolean {
    return this.keyboardArea !== null;
  }

  /** Esc 순서의 '드래그 중인 선택 취소'. 처리했으면 true. */
  cancelActive(): boolean {
    if (this.drag?.kind === 'area') {
      this.cancelDrag();
      return true;
    }
    if (this.keyboardArea !== null) {
      this.keyboardArea = null;
      this.draft.hidden = true;
      return true;
    }
    return false;
  }

  /** 영역 모드에서 Enter: 현재 쪽 가운데에 사각형을 놓는다. */
  startKeyboardArea(): void {
    const page = this.options.currentPage();
    if (this.options.pageElement(page) === null) return;
    this.keyboardArea = { page, rect: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 } };
    this.renderKeyboardArea();
    this.options.onAnnounce(`p.${String(page)} 가운데에 사각형을 놓았습니다. 방향키로 옮기고 Shift와 방향키로 크기를 바꾼 뒤 Enter로 확정합니다.`);
  }

  /** 키보드 영역 선택 중의 키를 처리한다. 처리했으면 true. */
  handleKeyboardAreaKey(event: KeyboardEvent): boolean {
    const active = this.keyboardArea;
    if (active === null) return false;
    const element = this.options.pageElement(active.page);
    if (element === null) return false;
    if (event.code === 'Enter') {
      this.commitArea(element, active.page, active.rect);
      this.keyboardArea = null;
      return true;
    }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      const box = element.getBoundingClientRect();
      active.rect = nudgeRect(active.rect, box, event.code, event.shiftKey);
      this.renderKeyboardArea();
      return true;
    }
    return false;
  }

  /** 현재 쪽의 글만 선택한다(계약 5.3절). */
  selectCurrentPageText(): void {
    const page = this.options.currentPage();
    const element = this.options.pageElement(page);
    const textLayer = element?.querySelector('.textLayer');
    if (!this.options.isEnabled() || textLayer === undefined || textLayer === null || element === null) return;
    const selection = window.getSelection();
    selection?.selectAllChildren(textLayer);
    this.commitText(element, page);
  }

  private renderKeyboardArea(): void {
    if (this.keyboardArea === null) return;
    const element = this.options.pageElement(this.keyboardArea.page);
    if (element !== null) this.positionDraft(element, this.keyboardArea.rect);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.stopFollowing?.();
    // 앱이 그린 [질문하기]는 선택 동작이 아니다.
    if (event.target instanceof Element && event.target.closest('.selection-ask') !== null) return;
    this.keyboardArea = null;
    this.draft.hidden = true;
    const found = pageOf(event.target);
    if (found === null || !this.options.isEnabled()) {
      this.drag = null;
      return;
    }
    const kind = decideDragKind({
      altKey: event.altKey,
      areaMode: this.options.isAreaMode(),
      textNearby: hasTextNear(found.element, event.clientX, event.clientY),
    });
    const startClient = { x: event.clientX, y: event.clientY };
    // 끄는 동안에만 브라우저 선택 색을 보이고, 끝나면 앱이 그린 표시가 대신한다.
    if (kind === 'text') this.container.dataset.selecting = '';
    this.drag =
      kind === 'text'
        ? { kind, ...found, startClient }
        : {
            kind,
            ...found,
            startClient,
            startPoint: toPagePoint(found.element, event.clientX, event.clientY),
            rect: null,
            moved: false,
          };
  };

  // 영역 드래그에서는 브라우저의 글자 선택이 시작되지 않게 한다.
  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (this.drag?.kind !== 'area') return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const { drag } = this;
    if (drag?.kind !== 'area') return;
    const distance = Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y);
    if (!drag.moved && distance < CLICK_MAX_MOVE_PX) return;
    drag.moved = true;
    drag.rect = rectFromPoints(drag.startPoint, toPagePoint(drag.element, event.clientX, event.clientY));
    this.positionDraft(drag.element, drag.rect);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const { drag } = this;
    if (drag === null) return;
    this.drag = null;
    this.draft.hidden = true;
    delete this.container.dataset.selecting;

    if (drag.kind === 'area') {
      if (drag.moved) {
        this.swallowNextClick();
        if (drag.rect !== null && isLargeEnough(drag.rect, drag.element.getBoundingClientRect())) {
          this.commitArea(drag.element, drag.page, drag.rect);
        }
        return;
      }
      // 이동 없는 단일 클릭. 링크는 그대로 두고, 빈 곳이면 선택을 해제한다.
      this.container.focus({ preventScroll: true });
      const onLink = event.target instanceof Element && event.target.closest('a') !== null;
      if (!onLink && !this.options.isAreaMode()) this.options.onClear();
      return;
    }

    // 더블클릭, 트리플클릭도 이 경로로 들어온다. 마지막 포인터 이동의 선택 반영은 pointerup보다 늦을 수 있어,
    // 잠시 선택 변경을 따라가며 앱 상태를 맞춘다.
    const commit = (): void => {
      this.commitText(drag.element, drag.page);
    };
    setTimeout(commit, 0);
    document.addEventListener('selectionchange', commit);
    this.stopFollowing = (): void => {
      document.removeEventListener('selectionchange', commit);
      clearTimeout(timer);
      this.stopFollowing = null;
    };
    const timer = setTimeout(() => {
      this.stopFollowing?.();
    }, FOLLOW_SELECTION_MS);
  };

  private readonly cancelDrag = (): void => {
    if (this.drag?.kind === 'area' && this.drag.moved) this.swallowNextClick();
    delete this.container.dataset.selecting;
    this.drag = null;
    this.draft.hidden = true;
  };

  private swallowNextClick(): void {
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    // 클릭이 오지 않는 경우(포인터가 다른 요소에서 끝남)에 다음 클릭을 잘못 삼키지 않게 한다.
    setTimeout(() => {
      window.removeEventListener('click', swallow, { capture: true });
    }, 0);
  }

  private commitArea(element: HTMLElement, page: number, rect: PageRect): void {
    this.draft.hidden = true;
    window.getSelection()?.removeAllRanges();
    this.options.onSelect({ kind: 'area', page, rect, thumbnail: cropArea(element, rect) });
    this.options.onAreaFinished();
    this.options.onAnnounce(`p.${String(page)}에서 영역을 선택했습니다.`);
  }

  private commitText(element: HTMLElement, page: number): void {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
    const textLayer = element.querySelector('.textLayer');
    if (textLayer === null) return;

    // 선택은 시작한 쪽 안에서만 유효하다(계약 5.3절).
    const range = selection.getRangeAt(0).cloneRange();
    let clamped = false;
    if (!element.contains(range.startContainer)) {
      range.setStart(textLayer, 0);
      clamped = true;
    }
    if (!element.contains(range.endContainer)) {
      range.setEnd(textLayer, textLayer.childNodes.length);
      clamped = true;
    }
    if (clamped) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const text = selection.toString().trim();
    if (text === '') return;
    const box = element.getBoundingClientRect();
    const rects: PageRect[] = [];
    // 범위의 사각형에는 글자 노드와 감싼 요소가 겹쳐 나오고, 쪽 전체를 덮는 pdf.js 보조 요소도 섞인다.
    const seen = new Set<string>();
    for (const client of range.getClientRects()) {
      if (client.width < 1 || client.height < 1 || client.height > box.height / 2) continue;
      const key = [client.left, client.top, client.width, client.height].map(Math.round).join();
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push({
        x: clamp01((client.left - box.left) / box.width),
        y: clamp01((client.top - box.top) / box.height),
        width: client.width / box.width,
        height: client.height / box.height,
      });
    }
    this.options.onSelect({ kind: 'text', page, text, rects });
  }

  private positionDraft(pageElement: HTMLElement, rect: PageRect): void {
    const page = pageElement.getBoundingClientRect();
    const origin = this.container.getBoundingClientRect();
    const { style } = this.draft;
    style.left = `${String(page.left - origin.left + this.container.scrollLeft + rect.x * page.width)}px`;
    style.top = `${String(page.top - origin.top + this.container.scrollTop + rect.y * page.height)}px`;
    style.width = `${String(Math.max(rect.width * page.width, 1))}px`;
    style.height = `${String(Math.max(rect.height * page.height, 1))}px`;
    this.draft.hidden = false;
  }

  // 드래그 전에 무엇이 일어날지 포인터 모양으로 알린다.
  private readonly handleHover = (event: PointerEvent): void => {
    if (this.drag !== null || this.hoverFrame !== 0) return;
    const { clientX, clientY, target, altKey } = event;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const found = pageOf(target);
      const area =
        found !== null &&
        this.options.isEnabled() &&
        decideDragKind({
          altKey,
          areaMode: this.options.isAreaMode(),
          textNearby: hasTextNear(found.element, clientX, clientY),
        }) === 'area';
      this.container.dataset.pointer = area ? 'area' : 'text';
    });
  };

  private readonly trackAlt = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt') return;
    if (event.type === 'keydown') this.container.dataset.alt = '';
    else delete this.container.dataset.alt;
  };

  private readonly releaseAlt = (): void => {
    delete this.container.dataset.alt;
  };
}
