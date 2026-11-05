// Esc 순서(docs/design-contract.md 7.2절)는 앱 한 곳에서 처리한다. 열린 층은 닫는 함수를 등록하고, 닫히면 null로 지운다.
export type EscapeLayer = 'popover' | 'correction';
export type RegisterEscape = (layer: EscapeLayer, close: (() => void) | null) => void;
