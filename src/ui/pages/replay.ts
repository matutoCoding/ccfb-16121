// 推演回放页面: 执行 simulatePlan, 逐帧渲染起重机/吊索/车体, 进度拖拽,
// 任意帧查看支腿反力/吊载率/臂长/半径, 危险帧清单点击跳转, 落轨对轨细看。
import { h, clear, button, label, slider, select, table } from '../dom';
import { state } from '../store';
import { Viewport } from '../viewport';
import { buildSite, buildCar, buildCrane, buildSlings } from '../../render/sceneBuilder';
import { simulatePlan, railAlignmentError, catenaryGeometry, type SimContext } from '../../core/simulator';
import { tankCarMassAndCog } from '../../core/rigging';
import { mat4, fromTRS, transformPoint } from '../../core/mat4';
import type { DangerFrame, FrameSnapshot } from '../../core/types';

export async function renderReplay(root: HTMLElement): Promise<void> {
  clear(root);
  let plan = state.plans[0];
  let frames: FrameSnapshot[] = [];
  let dangers: DangerFrame[] = [];
  let index = 0;
  let playing = false;
  let timer = 0;
  let viewport: Viewport | null = null;

  root.append(h('h2', {}, '推演回放'));
  const toolbar = h('div', { class: 'toolbar panel' },
    label('方案', select(state.plans.map((p) => ({ value: p.id, text: p.name })), plan?.id ?? '', (v) => {
      plan = state.plans.find((p) => p.id === v)!;
      runSim();
    })),
  );
  root.append(toolbar);

  const layout = h('div', { class: 'page-layout' });
  const center = h('div', { class: 'panel canvas-panel large' });
  const right = h('div', { class: 'panel wide' });
  const left = h('div', { class: 'panel' });
  layout.append(left, center, right);
  root.append(layout);

  const canvas = h('canvas', { id: 'replay-canvas' }) as HTMLCanvasElement;
  center.append(canvas);
  const progressWrap = h('div', { class: 'progress-wrap' });
  center.append(progressWrap);

  function runSim(): void {
    if (!plan) return;
    const scene = state.scenes.find((s) => s.id === plan.sceneId) ?? state.scenes[0];
    const site = state.sites.find((s) => s.id === scene.siteId)!;
    const model = state.cranes[0];
    const carType = state.cars.find((c) => c.id === scene.cars[0].carTypeId)!;
    const lifted = tankCarMassAndCog(carType).mass * 0.4; // 单机按 40% 车重试吊
    const ctx: SimContext = {
      cranes: [model], scene, site, liftedMasses: [lifted],
    };
    const result = simulatePlan(ctx, plan.steps);
    frames = result.frames;
    dangers = result.dangers;
    index = 0;
    renderDangerList();
    renderFrame();
  }

  function renderFrame(): void {
    if (!viewport || frames.length === 0) return;
    const f = frames[index];
    const scene = state.scenes.find((s) => s.id === plan.sceneId) ?? state.scenes[0];
    const site = state.sites.find((s) => s.id === scene.siteId)!;
    const carType = state.cars.find((c) => c.id === scene.cars[0].carTypeId)!;
    const model = state.cranes[0];
    viewport.renderer.clearNodes();
    buildSite(viewport.renderer, site);
    const carPos = f.carPositions[0]?.position ?? scene.cars[0].position;
    const carRot = f.carPositions[0]?.rotation ?? scene.cars[0].rotation;
    buildCar(viewport.renderer, carType, carPos, carRot, 1);
    const cf = f.cranes[0];
    buildCrane(viewport.renderer, model, cf.pose,
      cf.reactions.map((r) => ({ overloaded: r.overloaded, lifted: r.lifted })));

    // 吊索: 吊钩到前两个吊点
    const carRoot = fromTRS(mat4(), carPos, { x: carRot[0], y: carRot[1], z: carRot[2] }, [1, 1, 1]);
    const points = carType.liftPoints.slice(0, 2).map((p) => transformPoint(carRoot, p.offset) as [number, number, number]);
    buildSlings(viewport.renderer, cf.hook, points);

    renderTelemetry(f);
    renderProgress();
  }

  function renderTelemetry(f: FrameSnapshot): void {
    clear(right);
    const c = f.cranes[0];
    const cls = c.loadRatio > 1 ? 'ratio-badge danger' : c.loadRatio > 0.9 ? 'ratio-badge warn' : 'ratio-badge ok';
    right.append(
      h('h3', {}, `帧 ${index + 1}/${frames.length} · t=${f.t.toFixed(1)}s`),
      f.locked ? h('div', { class: 'check-fail' }, '⛔ 本帧处于锁车状态') : h('div', { class: 'check-pass' }, '机构正常'),
      h('div', { class: cls }, `吊载率 ${(c.loadRatio * 100).toFixed(1)}%`),
      table(['参数', '数值'], [
        ['臂长', `${c.boomLength.toFixed(2)} m`],
        ['工作半径', `${c.radius.toFixed(2)} m`],
        ['吊载', `${c.liftedLoad.toFixed(1)} t`],
        ['臂-导线净距', `${c.wireClearance.toFixed(2)} m`],
        ['臂-立柱净距', `${c.mastClearance.toFixed(2)} m`],
      ]),
      h('h4', {}, '支腿反力 (本帧)'),
      table(['支腿', '反力 kN', '比压 kPa', '状态'],
        c.reactions.map((r) => [r.name, r.reaction.toFixed(1), r.bearingPressure.toFixed(1),
          r.lifted ? '离地' : r.overloaded ? '⚠超载' : '正常'])),
    );

    // 落轨对轨
    const scene = state.scenes.find((s) => s.id === plan.sceneId) ?? state.scenes[0];
    const site = state.sites.find((s) => s.id === scene.siteId)!;
    const err = railAlignmentError(f.carPositions[0]?.position ?? [0, 0, 0], site.gauge);
    right.append(
      h('h4', {}, '落轨对轨检测'),
      h('div', { class: err <= 0.05 ? 'check-pass' : 'check-warn' },
        `轮对横向偏差 ${(err * 1000).toFixed(0)} mm ${err <= 0.05 ? '✓ 已对上钢轨' : '⚠ 偏差超 50mm, 需拉近细看调整'}`),
      );
  }

  function renderProgress(): void {
    clear(progressWrap);
    progressWrap.append(
      button(playing ? '⏸ 暂停' : '▶ 播放', () => {
        playing = !playing;
        if (playing) {
          timer = window.setInterval(() => {
            index = Math.min(frames.length - 1, index + 1);
            if (index >= frames.length - 1) { playing = false; clearInterval(timer); }
            renderFrame();
          }, 100);
        } else {
          clearInterval(timer);
        }
        renderProgress();
      }, 'primary'),
      label(`进度 ${index + 1}/${frames.length}`, slider(index, 0, Math.max(0, frames.length - 1), 1, (v) => {
        index = v; renderFrame();
      })),
    );
  }

  function renderDangerList(): void {
    clear(left);
    left.append(
      h('h3', {}, `危险帧清单 (${dangers.length})`),
      ...(dangers.length === 0 ? [h('p', { class: 'hint' }, '✓ 全程无超限项')] : dangers.map((d) => h('div', {
        class: 'danger-item ' + d.severity,
        onclick: () => { index = d.frameIndex; renderFrame(); },
      }, h('strong', {}, `帧 ${d.frameIndex + 1} · ${d.t.toFixed(1)}s`), h('span', {}, d.reason)))),
      h('h4', {}, '接触网参考'),
      h('p', { class: 'hint' }, (() => {
        const scene = state.scenes.find((s) => s.id === plan?.sceneId) ?? state.scenes[0];
        const site = state.sites.find((s) => s.id === scene.siteId)!;
        const cat = catenaryGeometry(site);
        return `立柱 ${cat.masts.length} 根, 导线高 ${site.wireHeight}m, 距本线中心 ${site.mastOffset}m`;
      })()),
    );
  }

  viewport = new Viewport(canvas, renderFrame);
  viewport.renderer.camera.target = [0, 3, 0];
  viewport.renderer.camera.distance = 32;
  if (plan) runSim();
  else right.append(h('p', {}, '请先在「吊复方案」页创建方案'));
}
