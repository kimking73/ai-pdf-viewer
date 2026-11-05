import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { APP_NAME } from '../../shared/app-config';
import type { IpcResponse, IpcResult, PdfOpenResponse, SendScope, TutorContext } from '../../shared/ipc/contract';
import type { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { MenuCommand } from '../../shared/ipc/menu-commands';
import { Toolbar, type ToolbarActions } from './Toolbar';
import type { EscapeLayer, RegisterEscape } from './tutor/escape-layers';
import { PANEL_KEY_STEP, PANEL_MIN_W, panelMaxWidth, panelWidth } from './tutor/panel-size';
import { TutorPanel } from './tutor/TutorPanel';
import { useTutor } from './tutor/use-tutor';
import { classifyDocumentText, qualityMessage, samplePageNumbers, type DocumentQuality } from './viewer/document-quality';
import { classifyPdfError, OPEN_FAILURE_MESSAGES, type OpenFailure } from './viewer/messages';
import { cropArea, SelectionInput } from './viewer/selection-input';
import type { ActiveSelection } from './viewer/selection-model';
import { SelectionOverlay } from './viewer/SelectionOverlay';
import type { ViewerController, ViewerState } from './viewer/viewer-controller';

const SHOW_PROGRESS_AFTER_MS = 1000;
// 계약의 요청 상한에 맞춘 쪽 글자 수와, 판독에 충분한 영역 이미지의 긴 변.
const PAGE_TEXT_LIMIT = 20_000;
const SELECTION_TEXT_LIMIT = 20_000;
const AREA_IMAGE_MAX_PX = 1568;

// 첫 쪽 표시 시간을 재는 표식. 화면에는 쓰지 않고 성능 측정에서 읽는다.
const OPEN_START_MARK = 'pdf-open-start';
const FIRST_PAGE_MEASURE = 'pdf-first-page';

type RecentDocument = IpcResponse<typeof IPC_CHANNELS.pdfListRecent>['documents'][number];

type Notice = { kind: 'error'; text: string } | { kind: 'info'; text: string };

const loadViewerModule = () => import('./viewer/viewer-controller');
const loadEngine = () => import('./viewer/pdf-engine');

export function App() {
  const [versionText, setVersionText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const [opening, setOpening] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState<'pdf' | 'other' | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelUserWidth, setPanelUserWidth] = useState<number | null>(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [areaMode, setAreaMode] = useState(false);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [showAsk, setShowAsk] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [pagesElement, setPagesElement] = useState<HTMLDivElement | null>(null);
  const [documentQuality, setDocumentQuality] = useState<DocumentQuality>('normal');
  const [bannerClosed, setBannerClosed] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);
  // 더 나중에 시작한 열기가 이긴다. 끝나는 순서가 바뀌어도 오래된 결과를 화면에 올리지 않는다.
  const openRequestRef = useRef(0);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const panelButtonRef = useRef<HTMLButtonElement>(null);
  const selectionInputRef = useRef<SelectionInput | null>(null);
  const escapeLayersRef = useRef<Record<EscapeLayer, (() => void) | null>>({ popover: null, correction: null });
  const registerEscape = useCallback<RegisterEscape>((layer, close) => {
    escapeLayersRef.current[layer] = close;
  }, []);
  // 이벤트 처리기가 읽는 최신 값. 값을 바꾸는 함수에서 함께 갱신한다.
  const panelOpenRef = useRef(true);
  const areaModeRef = useRef(false);
  const selectionRef = useRef<ActiveSelection | null>(null);
  // 전송에 쓴 선택. 이후 현재 쪽이 벗어나면 자동 해제한다(계약 5.4절).
  const sentSelectionRef = useRef<ActiveSelection | null>(null);
  const lastPageRef = useRef(0);
  const dividerDragRef = useRef<AbortController | null>(null);

  const pageBox = useCallback((page: number) => controllerRef.current?.pageBox(page) ?? null, []);
  const isPanelOpen = useCallback(() => panelOpenRef.current, []);
  const readCurrentPage = useCallback(() => controllerRef.current?.computeCurrentPage() ?? null, []);
  const isCopyAllowed = useCallback(() => controllerRef.current?.isCopyAllowed() ?? false, []);
  const readContext = useCallback(async (scope: SendScope): Promise<TutorContext> => {
    const controller = controllerRef.current;
    if (controller === null) return { pages: [], selectionText: null, areaImage: null };
    const numbers = Array.from({ length: scope.lastPage - scope.firstPage + 1 }, (_unused, index) => scope.firstPage + index);
    const pages = await Promise.all(
      numbers.map(async (page) => ({ page, text: (await controller.readPageText(page)).slice(0, PAGE_TEXT_LIMIT) })),
    );
    const current = selectionRef.current;
    let areaImage: string | null = null;
    if (current?.kind === 'area') {
      const element = controller.pageElement(current.page);
      const crop = element === null ? '' : cropArea(element, current.rect, AREA_IMAGE_MAX_PX);
      // 쪽이 아직 그려지지 않았으면 선택할 때 만든 썸네일을 쓴다.
      areaImage = crop === '' ? current.thumbnail : crop;
    }
    return {
      pages,
      selectionText: current?.kind === 'text' ? current.text.slice(0, SELECTION_TEXT_LIMIT) : null,
      areaImage: areaImage === '' ? null : areaImage,
    };
  }, []);
  const tutor = useTutor({
    documentId,
    currentPage: viewerState?.currentPage ?? 0,
    pageCount: viewerState?.pageCount ?? 0,
    selection,
    readCurrentPage,
    readContext,
    isCopyAllowed,
    isPanelOpen,
  });
  const { reset: resetTutor, markSeen } = tutor;

  const applySelection = useCallback((next: ActiveSelection | null) => {
    selectionRef.current = next;
    sentSelectionRef.current = null;
    setSelection(next);
    setShowAsk(next?.kind === 'text');
  }, []);

  const clearSelection = useCallback(() => {
    if (selectionRef.current?.kind === 'text') window.getSelection()?.removeAllRanges();
    applySelection(null);
  }, [applySelection]);

  const applyAreaMode = useCallback((next: boolean) => {
    areaModeRef.current = next;
    setAreaMode(next);
    const container = containerRef.current;
    if (container === null) return;
    if (next) container.dataset.areaMode = '';
    else delete container.dataset.areaMode;
  }, []);

  const applyPanelOpen = useCallback(
    (next: boolean) => {
      panelOpenRef.current = next;
      if (next) markSeen();
      flushSync(() => {
        setPanelOpen(next);
      });
    },
    [markSeen],
  );

  /** 입력창으로 간다. 접혀 있으면 펴고 이동한다. */
  const focusQuestion = useCallback(() => {
    if (!panelOpenRef.current) applyPanelOpen(true);
    questionRef.current?.focus();
  }, [applyPanelOpen]);

  const togglePanel = useCallback(() => {
    const next = !panelOpenRef.current;
    applyPanelOpen(next);
    if (!next) panelButtonRef.current?.focus();
  }, [applyPanelOpen]);

  const toggleAreaMode = useCallback(() => {
    if (controllerRef.current?.canSelect() !== true) return;
    selectionInputRef.current?.cancelActive();
    applyAreaMode(!areaModeRef.current);
  }, [applyAreaMode]);

  // 문서를 연 뒤 키보드 조작이 바로 되도록 포커스를 옮긴다. 사용자가 Tab으로 들어온 것이 아니므로
  // 뷰어 전체를 두르는 포커스 링은 그리지 않는다.
  const focusViewerQuietly = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    container.dataset.quietFocus = '';
    container.addEventListener(
      'blur',
      () => {
        delete container.dataset.quietFocus;
      },
      { once: true },
    );
    container.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.api.getVersion({ component: 'app' }).then((result) => {
      if (cancelled) return;
      setVersionText(result.ok ? `버전 ${result.data.version}` : '버전을 불러오지 못했습니다');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRecentDocuments = useCallback(async (): Promise<void> => {
    const result = await window.api.listRecentDocuments();
    if (result.ok) setRecentDocuments(result.data.documents);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.api.listRecentDocuments().then((result) => {
      if (!cancelled && result.ok) setRecentDocuments(result.data.documents);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => {
      setShowProgress(true);
    }, SHOW_PROGRESS_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setShowProgress(false);
    };
  }, [opening]);

  useEffect(() => {
    document.title = fileName === null ? APP_NAME : `${fileName} - ${APP_NAME}`;
  }, [fileName]);

  const ensureController = useCallback(async (): Promise<ViewerController> => {
    if (controllerRef.current !== null) return controllerRef.current;
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (container === null || pages === null) throw new Error('뷰어 영역이 없다');
    const { ViewerController: Controller } = await loadViewerModule();
    // 동시에 두 번 열면 먼저 끝난 쪽이 만든 것을 함께 쓴다.
    controllerRef.current ??= new Controller(container, pages, {
      onStateChange: (state) => {
        setViewerState(state);
        const pageChanged = state.currentPage !== lastPageRef.current;
        lastPageRef.current = state.currentPage;
        const sent = sentSelectionRef.current;
        if (pageChanged && sent !== null && sent === selectionRef.current && state.currentPage !== sent.page) {
          if (sent.kind === 'text') window.getSelection()?.removeAllRanges();
          applySelection(null);
        }
      },
      onExternalLink: (url) => {
        setNotice({ kind: 'info', text: `외부 링크는 열지 않습니다: ${url}` });
      },
      onFirstPageRendered: () => {
        if (performance.getEntriesByName(OPEN_START_MARK).length > 0) {
          performance.clearMeasures(FIRST_PAGE_MEASURE);
          performance.measure(FIRST_PAGE_MEASURE, OPEN_START_MARK);
        }
      },
      onPageRenderFailed: (pageNumber) => {
        setNotice({ kind: 'error', text: `p.${String(pageNumber)}을 표시하지 못했습니다.` });
      },
    });
    return controllerRef.current;
  }, [applySelection]);

  // 선택 입력은 뷰어 영역에 한 번만 붙인다. 문서는 컨트롤러를 통해 그때그때 읽는다.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const input = new SelectionInput(container, {
      pageElement: (page) => controllerRef.current?.pageElement(page) ?? null,
      currentPage: () => controllerRef.current?.computeCurrentPage() ?? 1,
      isAreaMode: () => areaModeRef.current,
      isEnabled: () => controllerRef.current?.canSelect() === true,
      onSelect: applySelection,
      onClear: () => {
        if (selectionRef.current?.kind === 'text') window.getSelection()?.removeAllRanges();
        applySelection(null);
      },
      onAreaFinished: () => {
        applyAreaMode(false);
        if (!panelOpenRef.current) applyPanelOpen(true);
        questionRef.current?.focus();
      },
      onAnnounce: setAnnouncement,
    });
    selectionInputRef.current = input;
    return () => {
      input.destroy();
      selectionInputRef.current = null;
    };
  }, [applySelection, applyAreaMode, applyPanelOpen]);

  useEffect(() => {
    const resize = (): void => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  // [질문하기]는 스크롤하거나 다른 곳을 누르면 사라진다. 선택과 칩은 남는다(계약 5.5절).
  useEffect(() => {
    if (!showAsk) return;
    const hide = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('.selection-ask') !== null) return;
      setShowAsk(false);
    };
    const container = containerRef.current;
    window.addEventListener('pointerdown', hide, { capture: true });
    container?.addEventListener('scroll', hide, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', hide, { capture: true });
      container?.removeEventListener('scroll', hide);
    };
  }, [showAsk]);

  // Esc는 위에서부터 먼저 해당되는 하나만 처리한다(계약 7.2절). 입력창의 글은 지우지 않는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const layers = escapeLayersRef.current;
      if (selectionInputRef.current?.cancelActive() === true) return;
      if (layers.popover !== null) {
        layers.popover();
        return;
      }
      if (layers.correction !== null) {
        layers.correction();
        return;
      }
      if (areaModeRef.current) {
        applyAreaMode(false);
        return;
      }
      const container = containerRef.current;
      if (container !== null && container.contains(document.activeElement)) clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [applyAreaMode, clearSelection]);

  useEffect(
    () => () => {
      dividerDragRef.current?.abort();
      controllerRef.current?.destroy();
      controllerRef.current = null;
    },
    [],
  );

  // 파일 선택 또는 끌어 놓기의 결과를 받아 문서를 연다. 실패해도 이전 화면은 그대로 둔다.
  const openFrom = useCallback(
    async (request: () => Promise<IpcResult<PdfOpenResponse>>) => {
      const fail = (reason: OpenFailure): void => {
        setNotice({ kind: 'error', text: OPEN_FAILURE_MESSAGES[reason] });
      };

      let response: IpcResult<PdfOpenResponse>;
      try {
        response = await request();
      } catch {
        // 끌어 놓은 항목에서 파일 경로를 얻지 못한 경우다.
        fail('unreadable');
        return;
      }
      if (!response.ok) {
        fail('unreadable');
        return;
      }
      const opened = response.data;
      if (opened.status === 'cancelled') return;
      if (opened.status === 'rejected') {
        fail(opened.reason);
        return;
      }

      // 파일이 실제로 골라진 뒤에 번호를 올린다. 대화상자를 취소해도 진행 중인 열기는 그대로 이어진다.
      const requestId = ++openRequestRef.current;
      const isStale = (): boolean => requestId !== openRequestRef.current;

      performance.clearMarks(OPEN_START_MARK);
      performance.mark(OPEN_START_MARK);
      setNotice(null);
      setOpening(true);
      try {
        const read = await window.api.readDocument({ id: opened.document.id });
        if (isStale()) return;
        if (!read.ok) {
          fail('unreadable');
          return;
        }
        if (read.data.status === 'rejected') {
          fail(read.data.reason);
          return;
        }

        const { loadPdf } = await loadEngine();
        const task = loadPdf(read.data.bytes);
        try {
          const pdf = await task.promise;
          if (isStale()) {
            await task.destroy();
            return;
          }
          const controller = await ensureController();
          // 선택과 대화는 이전 문서의 것이므로 지운다(계약 5.4절). 첫 쪽이 뜬 뒤에 지우면 그 사이에 사용자가
          // 새 문서에서 만든 선택까지 지우게 되므로 교체 직전에 처리한다. 파일명과 문서 ID도 함께 바꿔
          // 화면의 문서와 어긋나지 않게 하고, 교체가 일어나지 않으면 이전 상태를 그대로 둔다.
          const shown = await controller.show(task, pdf, () => {
            if (isStale()) return false;
            resetTutor();
            clearSelection();
            applyAreaMode(false);
            setFileName(opened.document.name);
            setDocumentId(opened.document.id);
            setDocumentQuality('normal');
            setBannerClosed(false);
            return true;
          });
          if (!shown) {
            await task.destroy();
            return;
          }
          if (isStale()) return;
          focusViewerQuietly();
          // 진단은 뒤에서 돌리고 끝나면 표시한다. 실패하면 경고 없이 둔다(계약 4.4절).
          void Promise.all(samplePageNumbers(pdf.numPages).map((page) => controller.readPageText(page)))
            .then((texts) => {
              if (!isStale()) setDocumentQuality(classifyDocumentText(texts));
            })
            .catch(() => undefined);
        } catch (error) {
          await task.destroy();
          if (!isStale()) fail(classifyPdfError(error));
        }
      } catch (error) {
        if (!isStale()) fail(classifyPdfError(error));
      } finally {
        if (!isStale()) setOpening(false);
      }
    },
    [ensureController, focusViewerQuietly, resetTutor, clearSelection, applyAreaMode],
  );

  const openWithDialog = useCallback(() => {
    void openFrom(() => window.api.openPdfDialog());
  }, [openFrom]);

  const actions = useMemo<ToolbarActions>(
    () => ({
      goToPage: (page) => controllerRef.current?.goToPage(page),
      previousPage: () => controllerRef.current?.goToRelativePage(-1),
      nextPage: () => controllerRef.current?.goToRelativePage(1),
      zoomIn: () => controllerRef.current?.zoomIn(),
      zoomOut: () => controllerRef.current?.zoomOut(),
      fitWidth: () => controllerRef.current?.fitWidth(),
      focusViewer: focusViewerQuietly,
      toggleAreaMode,
      togglePanel,
    }),
    [focusViewerQuietly, toggleAreaMode, togglePanel],
  );

  const { stop: stopAnswer } = tutor;

  useEffect(() => {
    const handlers: Record<MenuCommand, () => void> = {
      'open-pdf': openWithDialog,
      'zoom-in': actions.zoomIn,
      'zoom-out': actions.zoomOut,
      'fit-width': actions.fitWidth,
      'go-to-page': () => pageInputRef.current?.focus(),
      'previous-page': actions.previousPage,
      'next-page': actions.nextPage,
      'first-page': () => {
        actions.goToPage(1);
      },
      'last-page': () => controllerRef.current?.goToLastPage(),
      // 입력란에서는 그 입력란만, 뷰어에서는 현재 쪽의 글만 선택한다(계약 5.3절).
      'select-all': () => {
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) active.select();
        else selectionInputRef.current?.selectCurrentPageText();
      },
      'toggle-area-mode': toggleAreaMode,
      'toggle-panel': togglePanel,
      'focus-question': focusQuestion,
      'stop-answer': stopAnswer,
    };
    return window.api.onMenuCommand((command) => {
      handlers[command]();
    });
  }, [actions, openWithDialog, toggleAreaMode, togglePanel, focusQuestion, stopAnswer]);

  // 창 전체가 끌어 놓기 대상이다. 어디에 놓아도 브라우저 기본 동작(파일로 이동)이 일어나지 않게 막는다.
  useEffect(() => {
    const kindOf = (event: DragEvent): 'pdf' | 'other' | null => {
      const items = event.dataTransfer?.items;
      if (items === undefined || !event.dataTransfer?.types.includes('Files')) return null;
      const types = Array.from(items).map((item) => item.type);
      // 종류를 알 수 없으면 놓은 뒤 메인이 판단한다.
      return types.some((type) => type === 'application/pdf' || type === '') ? 'pdf' : 'other';
    };
    const over = (event: DragEvent): void => {
      event.preventDefault();
      setDragging(kindOf(event));
    };
    const leave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(null);
    };
    const drop = (event: DragEvent): void => {
      event.preventDefault();
      setDragging(null);
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) void openFrom(() => window.api.openDroppedFile(file));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFrom]);

  // 단일 키 판별은 한글 입력 상태에서도 같도록 event.code를 쓴다(계약 7.1절).
  const handleViewerKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const controller = controllerRef.current;
    if (controller === null) return;
    const selectionInput = selectionInputRef.current;
    if (selectionInput?.handleKeyboardAreaKey(event.nativeEvent) === true) {
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyR' && !event.shiftKey) {
      event.preventDefault();
      toggleAreaMode();
      return;
    }
    if (event.code === 'Enter' && areaModeRef.current) {
      event.preventDefault();
      selectionInput?.startKeyboardArea();
      return;
    }
    const moves: Record<string, () => void> = {
      ArrowLeft: () => {
        controller.goToRelativePage(-1);
      },
      PageUp: () => {
        controller.goToRelativePage(-1);
      },
      ArrowRight: () => {
        controller.goToRelativePage(1);
      },
      PageDown: () => {
        controller.goToRelativePage(1);
      },
      Home: () => {
        controller.goToPage(1);
      },
      End: () => {
        controller.goToLastPage();
      },
    };
    const move = moves[event.code];
    if (move === undefined) return;
    event.preventDefault();
    move();
  };

  const width = panelWidth(panelUserWidth, windowWidth);
  const panelStatus = panelOpen ? null : tutor.running ? '답변 받는 중' : tutor.unseenAnswer ? '새 답변 있음' : null;
  const copyAllowed = viewerState?.copyAllowed ?? true;
  const bannerText = bannerClosed
    ? null
    : !copyAllowed
      ? '이 문서는 복사 금지로 설정되어 AI로 보내지 않습니다. 읽기는 계속할 수 있습니다.'
      : qualityMessage(documentQuality);

  // 패널은 오른쪽에 붙어 있으므로 포인터에서 창 오른쪽 끝까지가 패널 폭이다.
  // 포인터 캡처가 끊겨도 끌기가 멈추지 않도록 창에서 받는다. 놓은 위치로 폭을 확정한다.
  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    controllerRef.current?.beginLiveResize();
    dividerDragRef.current?.abort();
    const drag = new AbortController();
    dividerDragRef.current = drag;
    const { signal } = drag;
    const resize = (moved: PointerEvent): void => {
      setPanelUserWidth(panelWidth(window.innerWidth - moved.clientX, window.innerWidth));
    };
    const finish = (): void => {
      drag.abort();
      // 새 폭이 화면에 반영된 뒤 다시 그린다.
      requestAnimationFrame(() => {
        controllerRef.current?.endLiveResize();
      });
    };
    window.addEventListener('pointermove', resize, { signal });
    window.addEventListener(
      'pointerup',
      (released) => {
        resize(released);
        finish();
      },
      { signal },
    );
    window.addEventListener('pointercancel', finish, { signal });
  };
  const handleDividerKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelUserWidth(panelWidth(width + direction * PANEL_KEY_STEP, window.innerWidth));
  };

  return (
    <div className="app">
      <Toolbar
        fileName={fileName}
        state={viewerState}
        actions={actions}
        pageInputRef={pageInputRef}
        panelButtonRef={panelButtonRef}
        panelOpen={panelOpen}
        panelStatus={panelStatus}
        areaMode={areaMode}
      />
      <main className="workspace">
        <section className="viewer" aria-label="PDF 뷰어" data-dragging={dragging ?? undefined}>
          {bannerText !== null && (
            <div className="viewer-banner" role="status" data-testid="viewer-banner">
              <span>{bannerText}</span>
              <button
                type="button"
                aria-label="경고 닫기"
                onClick={() => {
                  setBannerClosed(true);
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className="viewer-stage">
          <div
            ref={containerRef}
            className="viewer-scroll"
            data-testid="viewer-scroll"
            tabIndex={0}
            role="document"
            aria-label={fileName ?? undefined}
            onKeyDown={handleViewerKey}
          >
            {/* 이 안의 DOM은 pdf.js가 관리한다. React가 자식을 그리지 않는다. */}
            <div
              ref={(element) => {
                pagesRef.current = element;
                setPagesElement(element);
              }}
              className="pdfViewer"
            />
            {selection !== null && (
              <SelectionOverlay
                selection={selection}
                pagesElement={pagesElement}
                pageBox={pageBox}
                showAsk={showAsk}
                onAsk={() => {
                  setShowAsk(false);
                  focusQuestion();
                }}
              />
            )}
          </div>
          </div>
          <div className="visually-hidden" role="status">
            {announcement}
          </div>

          {fileName === null && (
            <div className="empty-state">
              <h1>{APP_NAME}</h1>
              <p>PDF를 여기에 끌어다 놓거나 열어 주세요</p>
              <button type="button" className="primary" onClick={openWithDialog}>
                PDF 열기
              </button>
              {recentDocuments.length > 0 && (
                <section className="recent-documents" aria-label="최근 문서" data-testid="recent-documents">
                  <h2>최근 문서</h2>
                  <ul>
                    {recentDocuments.map(({ id, name, openedAt }) => (
                      <li key={id}>
                        <button
                          type="button"
                          title={name}
                          data-testid="recent-document"
                          onClick={() => {
                            // 열 수 없었던 파일은 메인이 목록에서 뺐으므로 다시 읽는다.
                            void openFrom(() => window.api.openRecentDocument({ id })).then(refreshRecentDocuments);
                          }}
                        >
                          <span className="recent-name">{name}</span>
                          <span className="recent-date">{new Date(openedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="empty-version" data-testid="app-version">
                {versionText}
              </p>
            </div>
          )}

          {showProgress && (
            <div className="viewer-progress" role="status" data-testid="opening">
              문서를 여는 중…
            </div>
          )}

          {dragging === 'other' && (
            <div className="viewer-notice" role="status">
              PDF 파일만 열 수 있습니다
            </div>
          )}

          {notice !== null && dragging === null && (
            <div
              className="viewer-notice"
              data-kind={notice.kind}
              data-testid="viewer-notice"
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              <span>{notice.text}</span>
              <button
                type="button"
                aria-label="안내 닫기"
                onClick={() => {
                  setNotice(null);
                }}
              >
                ×
              </button>
            </div>
          )}
        </section>
        {panelOpen && (
          <div
            className="panel-divider"
            data-testid="panel-divider"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="패널 폭"
            aria-valuenow={width}
            aria-valuemin={PANEL_MIN_W}
            aria-valuemax={panelMaxWidth(windowWidth)}
            onPointerDown={handleDividerPointerDown}
            onDoubleClick={() => {
              setPanelUserWidth(null);
            }}
            onKeyDown={handleDividerKey}
          />
        )}
        <TutorPanel
          open={panelOpen}
          width={width}
          documentOpen={documentId !== null}
          copyAllowed={copyAllowed}
          tutor={tutor}
          selection={selection}
          inputRef={questionRef}
          registerEscape={registerEscape}
          onClearSelection={clearSelection}
          onGoToPage={(page) => controllerRef.current?.goToPage(page)}
          onSent={() => {
            sentSelectionRef.current = selectionRef.current;
          }}
        />
      </main>
    </div>
  );
}
