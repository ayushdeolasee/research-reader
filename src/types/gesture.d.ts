// WebKit GestureEvent — fired by Safari/WKWebView on macOS for trackpad pinch gestures.
// Not part of the standard DOM API, so we declare it here.
interface GestureEvent extends UIEvent {
  readonly rotation: number;
  readonly scale: number;
  initGestureEvent?(
    type: string,
    canBubble: boolean,
    cancelable: boolean,
    view: Window,
    detail: number,
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
    ctrlKey: boolean,
    altKey: boolean,
    shiftKey: boolean,
    metaKey: boolean,
    target: EventTarget,
    scale: number,
    rotation: number,
  ): void;
}
