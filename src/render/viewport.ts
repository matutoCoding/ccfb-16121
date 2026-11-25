import type { Renderer } from './renderer';

export interface ViewportHandlers {
  /** 左键拖动地面点（用于布置/拖拽），参数为世界坐标 */
  onDragGround?: (world: [number, number, number], e: PointerEvent) => void;
  onDragEnd?: () => void;
  onClickGround?: (world: [number, number, number], e: PointerEvent) => void;
  /** 是否把左键交给业务（否则左键旋转视角） */
  pickMode?: () => boolean;
}

/** 绑定轨道相机控制：左键旋转（pick 模式下拖拽地面）、右键平移、滚轮缩放 */
export function bindViewport(canvas: HTMLCanvasElement, renderer: Renderer, handlers: ViewportHandlers): () => void {
  let mode: 'none' | 'orbit' | 'pan' | 'pick' = 'none';
  let lastX = 0, lastY = 0;

  const toGround = (e: PointerEvent): [number, number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return renderer.camera.screenToGround(px, py, rect.width, rect.height, 0);
  };

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 0 && handlers.pickMode?.()) {
      mode = 'pick';
    } else if (e.button === 2 || e.button === 1) {
      mode = 'pan';
    } else {
      mode = 'orbit';
    }
  };
  const onMove = (e: PointerEvent) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 'orbit') renderer.camera.orbit(dx, dy);
    else if (mode === 'pan') renderer.camera.pan(dx, dy);
    else if (mode === 'pick') {
      const g = toGround(e);
      if (g && handlers.onDragGround) handlers.onDragGround(g, e);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (mode === 'pick') {
      const g = toGround(e);
      if (g && Math.abs(e.clientX - (lastX || e.clientX)) <= 3 && handlers.onClickGround) {
        // click 与 drag 用位移区分：简单起见都抛给业务，业务自行节流
      }
      handlers.onDragEnd?.();
    }
    mode = 'none';
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    renderer.camera.zoom(e.deltaY);
  };
  const onCtx = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onCtx);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onCtx);
  };
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function clear(node: HTMLElement): void {
  node.innerHTML = '';
}

export function toast(msg: string, ms = 2200): void {
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function fmt(v: number, d = 2): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

/** 注册页面卸载回调（main.ts 在切换路由前派发 unmount 事件） */
export function onUnmount(root: HTMLElement, fn: () => void): void {
  root.addEventListener('unmount', fn as EventListener);
}
