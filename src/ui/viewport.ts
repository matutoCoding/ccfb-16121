// 通用 3D 视口: 封装 Renderer、轨道相机 (左键旋转/右键平移/滚轮缩放)、渲染循环。
import { Renderer } from '../render/renderer';

export class Viewport {
  renderer: Renderer;
  private raf = 0;
  private rebuild: () => void;

  constructor(canvas: HTMLCanvasElement, rebuild: () => void) {
    this.renderer = new Renderer(canvas);
    this.rebuild = rebuild;
    this.bindControls(canvas);
    const loop = () => {
      this.renderer.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private bindControls(canvas: HTMLCanvasElement): void {
    let dragging: 'orbit' | 'pan' | null = null;
    let lastX = 0, lastY = 0;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragging = e.button === 2 ? 'pan' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const cam = this.renderer.camera;
      if (dragging === 'orbit') {
        cam.azimuth -= dx * 0.008;
        cam.elevation = Math.max(0.08, Math.min(Math.PI / 2 - 0.05, cam.elevation + dy * 0.008));
      } else {
        const scale = cam.distance * 0.0015;
        const az = cam.azimuth;
        cam.target[0] += (-dx * Math.cos(az) + 0) * scale;
        cam.target[2] += (-dx * Math.sin(az)) * scale;
        cam.target[0] += -dy * Math.sin(az) * scale * 0.6;
        cam.target[2] += dy * Math.cos(az) * scale * 0.6;
        cam.target[1] = Math.max(0, cam.target[1] - dy * scale);
      }
    });
    const end = () => { dragging = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = this.renderer.camera;
      cam.distance = Math.max(4, Math.min(120, cam.distance * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  /** 由页面调用: 重建节点后下一帧自动渲染 */
  requestRebuild(): void {
    this.rebuild();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
