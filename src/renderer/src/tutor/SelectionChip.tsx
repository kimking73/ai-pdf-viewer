import type { ActiveSelection } from '../viewer/selection-model';

// 입력창 바로 위의 선택 칩(계약 5.6절). 선택 내용을 글자로만 표시한다.
export function SelectionChip({ selection, onClear }: { selection: ActiveSelection; onClear: () => void }) {
  const page = `p.${String(selection.page)}`;
  return (
    <div className="selection-chip" data-testid="selection-chip" data-kind={selection.kind}>
      {selection.kind === 'area' ? (
        <>
          {selection.thumbnail !== '' && <img className="selection-chip-thumb" src={selection.thumbnail} alt="" />}
          <span className="selection-chip-body">선택 영역 · {page}</span>
        </>
      ) : (
        <span className="selection-chip-body">
          <span className="selection-chip-preview">{selection.text}</span>
          <span className="selection-chip-meta">
            {selection.text.length.toLocaleString()}자 · {page}
          </span>
        </span>
      )}
      <button type="button" className="selection-chip-clear" aria-label="선택 해제" onClick={onClear}>
        ×
      </button>
    </div>
  );
}
