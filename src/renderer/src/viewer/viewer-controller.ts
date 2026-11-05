import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import {
  AnnotationMode,
  EventBus,
  PDFLinkService,
  PDFViewer,
  PermissionFlag,
  type PDFDocumentProxy,
} from './pdf-engine';
import { clampScale, initialFitMode, MAX_SCALE, MIN_SCALE, nextZoomStop, pageAtLine, previousZoomStop, type FitMode } from './view-math';

export interface ViewerState {
  pageCount: number;
  currentPage: number;
  scale: number;
  fitMode: FitMode;
  copyAllowed: boolean;
}

export interface ViewerCallbacks {
  onStateChange(state: ViewerState): void;
  onExternalLink(url: string): void;
  onFirstPageRendered(): void;
  onPageRenderFailed(pageNumber: number): void;
}

const CURRENT_PAGE_SETTLE_MS = 150;
const RESIZE_SETTLE_MS = 100;
const PINCH_REDRAW_DELAY_MS = 300;
const PINCH_SENSITIVITY = 0.01;

// PDF 안의 외부 링크는 열지 않는다. 주소만 보여 준다(계약 2.5절).
class LockedLinkService extends PDFLinkService {
  constructor(
    options: ConstructorParameters<typeof PDFLinkService>[0],
    private readonly onExternalLink: (url: string) => void,
  ) {
    super(options);
  }

  override addLinkAttributes(link: HTMLAnchorElement, url: string): void {
    link.removeAttribute('href');
    link.removeAttribute('target');
    link.title = url;
    link.setAttribute('role', 'link');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      this.onExternalLink(url);
    });
  }
}

// 번역 파일을 fetch하지 않도록 pdf.js의 기본 다국어 처리를 빈 구현으로 바꾼다.
// 쪽 렌더링에는 필요 없고, 기본 구현은 CSP의 connect-src에 막혀 오류만 남긴다.
const silentL10n = {
  getLanguage: () => 'ko',
  getDirection: () => 'ltr',
  get: () => Promise.resolve(''),
  translate: () => Promise.resolve(),
  translateOnce: () => Promise.resolve(),
  pause: () => undefined,
  resume: () => undefined,
  destroy: () => Promise.resolve(),
};

// PDFViewer를 앱의 동작 단위로 감싼다. React와 분리해 두어 이후 튜터 패널과 영역 선택이 같은 API를 쓴다.
export class ViewerController {
  private readonly viewer: PDFViewer;
  private readonly linkService: LockedLinkService;
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private task: PDFDocumentLoadingTask | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private fitMode: FitMode = 'fit-width';
  private currentPage = 1;
  private copyAllowed = true;
  private firstPageReported = false;
  // 명령으로 이동한 쪽. 짧은 쪽에서는 중앙선이 다음 쪽에 걸릴 수 있어, 사용자가 스크롤할 때까지 이 값을 유지한다.
  private pinnedScrollTop: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingPinch = 1;
  private pinchOrigin: [number, number] = [0, 0];
  private pinchFrame = 0;
  // 구분선을 끄는 동안의 기준. 있으면 다시 그리지 않고 CSS 배율로만 맞춘다(계약 2.3절).
  private liveResize: { startWidth: number; page: number; offset: number } | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly viewerElement: HTMLDivElement,
    private readonly callbacks: ViewerCallbacks,
  ) {
    const eventBus = new EventBus();
    this.linkService = new LockedLinkService({ eventBus }, (url) => {
      callbacks.onExternalLink(url);
    });
    this.viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService: this.linkService,
      l10n: silentL10n as never,
      // 폼은 그림으로만 표시하고, 스크립팅 관리자를 넘기지 않아 PDF 안의 JavaScript는 실행되지 않는다.
      annotationMode: AnnotationMode.ENABLE,
      enablePermissions: true,
      // 캔버스에 시스템 강조색으로 선택을 그리는 기능을 끄고, 선택 색을 디자인 토큰이 정하게 한다.
      enableSelectionRendering: false,
    });
    this.linkService.setViewer(this.viewer);

    eventBus.on('pagesinit', () => {
      this.applyFitMode();
      // 배율을 정하며 pdf.js가 첫 쪽 위 여백만큼 내려가므로 문서 맨 위로 되돌린다.
      this.container.scrollTop = 0;
    });
    eventBus.on('pagerendered', (event: { pageNumber: number; error: unknown }) => {
      if (event.error !== null && event.error !== undefined) callbacks.onPageRenderFailed(event.pageNumber);
      if (!this.firstPageReported) {
        this.firstPageReported = true;
        callbacks.onFirstPageRendered();
      }
    });

    const { signal } = this.abort;
    container.addEventListener('scroll', this.handleScroll, { passive: true, signal });
    // 트랙패드 핀치는 ctrlKey가 붙은 wheel로 들어온다. 기본 동작을 막아야 하므로 passive가 아니다.
    container.addEventListener('wheel', this.handleWheel, { passive: false, signal });
    // 복사 금지 문서는 어떤 경로로도 클립보드나 끌어 놓기로 본문이 나가지 않게 한다.
    for (const type of ['copy', 'cut', 'dragstart'] as const) {
      container.addEventListener(type, this.guardCopy, { capture: true, signal });
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.liveResize !== null) {
        this.previewLiveResize();
        return;
      }
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(this.handleResize, RESIZE_SETTLE_MS);
    });
    this.resizeObserver.observe(container);
  }

  // 새 문서가 준비된 뒤에 호출한다. 이전 문서는 교체가 끝난 다음 정리한다.
  // beforeSwap은 교체 직전에 동기로 불린다. false를 돌려주면 교체하지 않고, 이 경우 task는 호출자가 정리한다.
  async show(task: PDFDocumentLoadingTask, pdf: PDFDocumentProxy, beforeSwap: () => boolean): Promise<boolean> {
    const permissions = await pdf.getPermissions();
    const firstPage = await pdf.getPage(1);
    const { width, height } = firstPage.getViewport({ scale: 1 });
    if (!beforeSwap()) return false;

    const previousTask = this.task;
    this.task = task;
    this.pdf = pdf;
    this.currentPage = 1;
    this.pinnedScrollTop = null;
    this.firstPageReported = false;
    this.copyAllowed = permissions === null || permissions.has(PermissionFlag.COPY);
    this.container.classList.toggle('copy-restricted', !this.copyAllowed);
    this.fitMode = initialFitMode(
      { width, height },
      { width: this.container.clientWidth, height: this.container.clientHeight },
    );

    this.linkService.setDocument(pdf);
    this.viewer.setDocument(pdf);
    this.container.scrollTop = 0;
    this.notify();
    // 교체는 이미 끝났다. 이전 문서 정리 실패로 새 문서를 실패 처리하지 않는다.
    await previousTask?.destroy().catch(() => undefined);
    return true;
  }

  get hasDocument(): boolean {
    return this.pdf !== null;
  }

  /** 지연 없이 지금 순간의 현재 쪽을 계산한다. 이후 전송 범위가 이 값을 쓴다(계약 3.1절). */
  computeCurrentPage(): number {
    const pageCount = this.viewer.pagesCount;
    if (pageCount === 0) return 1;
    if (this.pinnedScrollTop !== null) return this.currentPage;
    const line = this.container.getBoundingClientRect().top + this.container.clientHeight / 2;
    return pageAtLine(
      pageCount,
      (page) => ({ top: (this.viewer.getPageView(page - 1) as { div: HTMLElement }).div.getBoundingClientRect().top }),
      line,
    );
  }

  getCurrentPage(): number {
    return this.currentPage;
  }

  /** 문서가 전송을 허용하는지. 복사 금지 문서는 메인도 전송을 거부한다. */
  isCopyAllowed(): boolean {
    return this.copyAllowed;
  }

  /** AI로 보낼 쪽의 글. 줄바꿈은 pdf.js가 표시한 위치를 따른다. */
  async readPageText(pageNumber: number): Promise<string> {
    if (this.pdf === null) return '';
    const page = await this.pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
      .join('')
      .trim();
  }

  /** 문서가 있고 복사 금지가 아니어야 선택을 만들 수 있다. */
  canSelect(): boolean {
    return this.hasDocument && this.copyAllowed;
  }

  beginLiveResize(): void {
    if (!this.hasDocument || this.liveResize !== null) return;
    clearTimeout(this.resizeTimer);
    const element = this.pageElement(this.currentPage);
    const height = element?.offsetHeight ?? 0;
    this.liveResize = {
      startWidth: this.container.clientWidth,
      page: this.currentPage,
      offset: element === null || height === 0 ? 0 : (this.container.scrollTop - element.offsetTop) / height,
    };
    this.container.dataset.liveResize = '';
  }

  endLiveResize(): void {
    const live = this.liveResize;
    if (live === null) return;
    this.liveResize = null;
    delete this.container.dataset.liveResize;
    this.viewerElement.style.transform = '';
    this.viewerElement.style.transformOrigin = '';
    this.viewer.update();
    this.applyFitMode();
    // 끌기 전에 보던 쪽과 위치로 되돌리고, 사용자가 스크롤할 때까지 그 쪽을 현재 쪽으로 둔다.
    const element = this.pageElement(live.page);
    if (element !== null) {
      this.container.scrollTop = element.offsetTop + live.offset * element.offsetHeight;
      this.pinnedScrollTop = this.container.scrollTop;
    }
  }

  private previewLiveResize(): void {
    if (this.liveResize === null || this.fitMode === 'manual') return;
    const ratio = this.container.clientWidth / this.liveResize.startWidth;
    this.viewerElement.style.transformOrigin = 'top center';
    this.viewerElement.style.transform = `scale(${String(ratio)})`;
  }

  pageElement(pageNumber: number): HTMLElement | null {
    if (pageNumber < 1 || pageNumber > this.viewer.pagesCount) return null;
    return (this.viewer.getPageView(pageNumber - 1) as { div: HTMLElement }).div;
  }

  /** 스크롤 영역 좌표의 쪽 위치. 뷰어 위에 표시를 그릴 때 쓴다. */
  pageBox(pageNumber: number): { left: number; top: number; width: number; height: number } | null {
    const box = this.pageElement(pageNumber)?.getBoundingClientRect();
    if (box === undefined) return null;
    const origin = this.container.getBoundingClientRect();
    return {
      left: box.left - origin.left + this.container.scrollLeft,
      top: box.top - origin.top + this.container.scrollTop,
      width: box.width,
      height: box.height,
    };
  }

  goToPage(pageNumber: number): void {
    const pageCount = this.viewer.pagesCount;
    if (pageCount === 0) return;
    const target = Math.min(pageCount, Math.max(1, pageNumber));
    this.viewer.scrollPageIntoView({ pageNumber: target });
    this.currentPage = target;
    this.pinnedScrollTop = this.container.scrollTop;
    this.notify();
  }

  goToRelativePage(delta: number): void {
    this.goToPage(this.computeCurrentPage() + delta);
  }

  goToLastPage(): void {
    this.goToPage(this.viewer.pagesCount);
  }

  zoomIn(): void {
    this.setManualScale(nextZoomStop(this.viewer.currentScale));
  }

  zoomOut(): void {
    this.setManualScale(previousZoomStop(this.viewer.currentScale));
  }

  fitWidth(): void {
    if (!this.hasDocument) return;
    this.fitMode = 'fit-width';
    this.applyFitMode();
    this.afterScaleChange();
  }

  destroy(): void {
    this.abort.abort();
    this.resizeObserver.disconnect();
    clearTimeout(this.settleTimer);
    clearTimeout(this.resizeTimer);
    cancelAnimationFrame(this.pinchFrame);
    void this.task?.destroy();
  }

  private setManualScale(scale: number): void {
    if (!this.hasDocument) return;
    this.fitMode = 'manual';
    this.viewer.currentScale = clampScale(scale);
    this.afterScaleChange();
  }

  private applyFitMode(): void {
    if (this.fitMode === 'manual') return;
    this.viewer.currentScaleValue = this.fitMode === 'fit-page' ? 'page-fit' : 'page-width';
    // 맞춤 배율도 계약의 범위 안에 둔다. 작은 쪽이 400%를 넘거나 큰 쪽이 50% 밑으로 내려가는 경우다.
    const scale = this.viewer.currentScale;
    if (scale < MIN_SCALE || scale > MAX_SCALE) this.viewer.currentScale = clampScale(scale);
    this.notify();
  }

  private afterScaleChange(): void {
    if (this.pinnedScrollTop !== null) this.pinnedScrollTop = this.container.scrollTop;
    this.notify();
  }

  private notify(): void {
    this.callbacks.onStateChange({
      pageCount: this.pdf?.numPages ?? 0,
      currentPage: this.currentPage,
      scale: this.viewer.currentScale || 1,
      fitMode: this.fitMode,
      copyAllowed: this.copyAllowed,
    });
  }

  private readonly handleScroll = (): void => {
    if (this.pinnedScrollTop !== null) {
      if (Math.abs(this.container.scrollTop - this.pinnedScrollTop) <= 2) return;
      this.pinnedScrollTop = null;
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      const page = this.computeCurrentPage();
      if (page !== this.currentPage) {
        this.currentPage = page;
        this.notify();
      }
    }, CURRENT_PAGE_SETTLE_MS);
  };

  private readonly handleResize = (): void => {
    if (!this.hasDocument) return;
    this.viewer.update();
    this.applyFitMode();
    if (this.pinnedScrollTop !== null) this.pinnedScrollTop = this.container.scrollTop;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey || !this.hasDocument) return;
    event.preventDefault();
    this.pendingPinch *= Math.exp(-event.deltaY * PINCH_SENSITIVITY);
    this.pinchOrigin = [event.clientX, event.clientY];
    if (this.pinchFrame !== 0) return;
    this.pinchFrame = requestAnimationFrame(() => {
      this.pinchFrame = 0;
      const current = this.viewer.currentScale;
      const target = clampScale(current * this.pendingPinch);
      this.pendingPinch = 1;
      if (target === current) return;
      this.fitMode = 'manual';
      this.viewer.updateScale({
        scaleFactor: target / current,
        origin: this.pinchOrigin,
        drawingDelay: PINCH_REDRAW_DELAY_MS,
      });
      this.afterScaleChange();
    });
  };

  private readonly guardCopy = (event: Event): void => {
    if (this.copyAllowed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
