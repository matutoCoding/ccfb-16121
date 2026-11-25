// 方案单页面: 起重机站位图、分步动作表、支腿反力表、关键帧截图, 可打印带去现场。
import { h, clear, button, label, select, table } from '../dom';
import { state } from '../store';
import { Viewport } from '../viewport';
import { buildSite, buildCar, buildCrane } from '../../render/sceneBuilder';
import { computeOutriggerReactions } from '../../core/crane';
import { simulatePlan, type SimContext } from '../../core/simulator';
import { tankCarMassAndCog } from '../../core/rigging';
import { rad2deg } from '../../core/geometry';
import type { RescuePlan } from '../../core/types';

export async function renderReport(root: HTMLElement): Promise<void> {
  clear(root);
  root.append(h('h2', {}, '方案单 (打印版)'));
  const plan = state.plans[0];
  if (!plan) {
    root.append(h('div', { class: 'panel' }, h('p', {}, '暂无方案, 请先在「吊复方案」页创建并保存。')));
    return;
  }

  const toolbar = h('div', { class: 'toolbar panel' },
    label('选择方案', select(state.plans.map((p) => ({ value: p.id, text: p.name })), plan.id, () => location.reload())),
    button('🖨 打印 / 另存 PDF', () => window.print(), 'primary'),
    button('📷 截取当前站位图', () => {
      const url = (document.getElementById('report-canvas') as HTMLCanvasElement).toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = `${plan.name}-站位图.png`; a.click();
    }),
  );
  root.append(toolbar);

  const scene = state.scenes.find((s) => s.id === plan.sceneId) ?? state.scenes[0];
  const site = state.sites.find((s) => s.id === scene.siteId)!;
  const model = state.cranes[0];
  const carType = state.cars.find((c) => c.id === scene.cars[0].carTypeId)!;
  const pose = scene.cranePoses[0];
  const massInfo = tankCarMassAndCog(carType);

  const sheet = h('div', { id: 'print-sheet', class: 'print-sheet panel' });
  root.append(sheet);

  sheet.append(
    h('h2', {}, `铁路救援吊复方案单 — ${plan.name}`),
    h('p', {}, `现场: ${scene.name} | 车型: ${carType.name} | 总质量 ${massInfo.mass.toFixed(1)} t | 生成时间: ${new Date().toLocaleString('zh-CN')}`),
  );

  // 站位图 (俯视 + 透视 canvas)
  const canvasWrap = h('div', { class: 'report-canvas-wrap' },
    h('h3', {}, '一、起重机站位图'),
    Object.assign(h('canvas', { id: 'report-canvas' }), { width: 900, height: 460 }) as HTMLCanvasElement,
  );
  sheet.append(canvasWrap);

  // 分步动作表
  sheet.append(
    h('h3', {}, '二、分步动作表'),
    table(['步序', '作业内容', '历时(s)', '机构动作目标'],
      plan.steps.map((s, i) => [
        i + 1, s.name, s.durationSec,
        s.actions.map((a) => describeAction(a.target)).join('; '),
      ])),
  );

  // 支腿反力表 (取推演中最大吊载帧)
  const ctx: SimContext = {
    cranes: [model], scene, site, liftedMasses: [massInfo.mass * 0.4],
  };
  const { frames } = simulatePlan(ctx, plan.steps);
  const worst = frames.reduce((a, b) =>
    Math.max(...b.cranes[0].reactions.map((r) => r.reaction)) >
    Math.max(...a.cranes[0].reactions.map((r) => r.reaction)) ? b : a, frames[0]);
  sheet.append(
    h('h3', {}, '三、支腿反力表 (最不利帧)'),
    table(['支腿', '反力 kN', '接地面积 m²', '比压 kPa', '路基容许 kPa', '判定'],
      worst.cranes[0].reactions.map((r) => [
        r.name, r.reaction.toFixed(1), r.area.toFixed(2), r.bearingPressure.toFixed(1),
        site.allowableBearing,
        r.lifted ? '离地' : r.overloaded ? '不满足, 加垫木/移车' : '满足',
      ])),
    h('p', { class: 'hint' }, '注: 反力按等沉降最小范数解, 四条腿反力之和等于起重机自重与吊载总重力。'),
  );

  // 关键帧
  const keyFrames = pickKeyFrames(frames.length);
  sheet.append(
    h('h3', {}, '四、关键帧参数'),
    table(['帧', '时间 s', '臂长 m', '半径 m', '吊载率', '导线净距 m', '状态'],
      keyFrames.map((fi) => {
        const f = frames[fi];
        const c = f.cranes[0];
        return [fi + 1, f.t.toFixed(1), c.boomLength.toFixed(2), c.radius.toFixed(2),
          `${(c.loadRatio * 100).toFixed(0)}%`, c.wireClearance.toFixed(2),
          f.locked ? '锁车' : '正常'];
      })),
  );

  // 站位图渲染 (独立 Viewport, 俯视角度)
  const vp = new Viewport(document.getElementById('report-canvas') as HTMLCanvasElement, () => {});
  vp.renderer.camera.target = [0, 1, 0];
  vp.renderer.camera.elevation = Math.PI * 0.32;
  vp.renderer.camera.azimuth = Math.PI * 0.15;
  vp.renderer.camera.distance = 30;
  const reactions = computeOutriggerReactions(model, pose, massInfo.mass * 0.4, site.allowableBearing);
  vp.renderer.clearNodes();
  buildSite(vp.renderer, site);
  buildCar(vp.renderer, carType, scene.cars[0].position, scene.cars[0].rotation, 1);
  buildCrane(vp.renderer, model, pose, reactions.map((r) => ({ overloaded: r.overloaded, lifted: r.lifted })));

  sheet.append(h('p', { class: 'sign' }, '救援队长签字: ____________　　机务/工务配合: ____________　　日期: ____________'));
}

function describeAction(t: RescuePlan['steps'][0]['actions'][0]['target']): string {
  const parts: string[] = [];
  if (t.slew !== undefined) parts.push(`回转→${rad2deg(t.slew).toFixed(0)}°`);
  if (t.luff !== undefined) parts.push(`变幅→${rad2deg(t.luff).toFixed(0)}°`);
  if (t.hoist !== undefined) parts.push(`绳长→${t.hoist.toFixed(1)}m`);
  if (t.sections) parts.push(`伸缩→${t.sections.map((s) => `${Math.round((s ?? 0) * 100)}%`).join('/')}`);
  return parts.join(', ') || '支腿/准备';
}

function pickKeyFrames(n: number): number[] {
  if (n <= 5) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]);
  return [...out].sort((a, b) => a - b);
}
