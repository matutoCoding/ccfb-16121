// 起重机页面: 刚体层级展示、姿态操控、性能表插值、吊载率联锁、支腿反力/比压、1cm 自检。
import { h, clear, button, label, numInput, slider, table } from '../dom';
import { state } from '../store';
import { Viewport } from '../viewport';
import { buildCrane } from '../../render/sceneBuilder';
import { defaultCranePose } from '../../core/seed';
import {
  computeKinematics, computeOutriggerReactions, loadRatio, reactionBalanceError,
  selfCheckKinematics, currentBoomLength,
} from '../../core/crane';
import { rad2deg, deg2rad } from '../../core/geometry';
import type { CraneModel, CranePose } from '../../core/types';

export async function renderCrane(root: HTMLElement): Promise<void> {
  clear(root);
  const model: CraneModel = state.cranes[0];
  // 独立演示姿态 (不污染现场数据), 用安全的高变幅、短半径默认值
  const pose: CranePose = defaultCranePose([0, 0, 0], 0);
  let liftedMass = 12;
  let viewport: Viewport | null = null;
  let locked = false;

  const layout = h('div', { class: 'page-layout' });
  const left = h('div', { class: 'panel' });
  const center = h('div', { class: 'panel canvas-panel' });
  const right = h('div', { class: 'panel wide' });
  layout.append(left, center, right);
  root.append(h('h2', {}, `起重机 — ${model.name}`), layout);

  const canvas = h('canvas', { id: 'crane-canvas' }) as HTMLCanvasElement;
  center.append(canvas);

  function rebuild3D(): void {
    if (!viewport) return;
    viewport.renderer.clearNodes();
    const reactions = computeOutriggerReactions(model, pose, liftedMass, 180);
    buildCrane(viewport.renderer, model, pose, reactions.map((r) => ({ overloaded: r.overloaded, lifted: r.lifted })));
  }

  function renderTelemetry(): void {
    const k = computeKinematics(model, pose);
    const lr = loadRatio(model, pose, liftedMass);
    const reactions = computeOutriggerReactions(model, pose, liftedMass, 180);
    const balanceErr = reactionBalanceError(model, pose, liftedMass, reactions);
    const check = selfCheckKinematics(model, pose);

    clear(right);
    const ratioPct = lr.ratio * 100;
    const cls = lr.ratio > 1 ? 'ratio-badge danger' : lr.ratio > 0.9 ? 'ratio-badge warn' : 'ratio-badge ok';
    right.append(
      h('h3', {}, '实时作业参数'),
      h('div', { class: cls },
        h('span', {}, '吊载率'),
        h('strong', {}, `${ratioPct.toFixed(1)}%`),
        h('small', {}, `实际 ${lr.actual.toFixed(1)}t / 额定 ${lr.rated.toFixed(1)}t`),
      ),
      table(['指标', '数值'], [
        ['臂长', `${k.boomLength.toFixed(3)} m`],
        ['工作半径', `${k.radius.toFixed(3)} m`],
        ['变幅角', `${rad2deg(pose.luff).toFixed(2)}°`],
        ['回转角', `${rad2deg(pose.slew).toFixed(2)}°`],
        ['吊钩高度', `${k.hookPlumb[1].toFixed(3)} m`],
        ['绳长', `${pose.hoist.toFixed(2)} m`],
      ]),
    );

    // 1cm 红线自检
    const pass = check.maxError <= 0.01;
    right.append(
      h('h4', {}, '层级变换 1cm 红线自检 (矩阵链 vs 臂长/半径手算)'),
      h('div', { class: pass ? 'check-pass' : 'check-fail' },
        pass ? '✓ 通过' : '✗ 超差',
        h('small', {}, `最大偏差 ${(check.maxError * 1000).toFixed(4)} mm (限值 10 mm)`),
      ),
      table(['校验点', '矩阵链 (x,y,z)', '手算 (x,y,z)'], [
        ['臂尖', fmt(check.matrixTip), fmt(check.analyticTip)],
        ['吊钩', fmt(check.matrixHook), fmt(check.analyticHook)],
      ]),
    );

    // 支腿
    const anyLifted = reactions.some((r) => r.lifted && r.reaction === 0);
    right.append(
      h('h4', {}, anyLifted
        ? `支腿支反力 (⚠ 有腿离地, 合力 ${sumReactions(reactions).toFixed(1)} kN < 总重力, 属倾覆临界)`
        : `支腿支反力 (合力偏差 ${balanceErr.toFixed(6)} kN ≈ 0)`),
      table(['支腿', '反力 kN', '接地面积 m²', '比压 kPa', '状态'],
        reactions.map((r) => [
          r.name, r.reaction.toFixed(1), r.area.toFixed(2), r.bearingPressure.toFixed(1),
          r.lifted ? (r.reaction === 0 ? '离地/未伸' : '临界') : r.overloaded ? '⚠ 超路基承载' : '正常',
        ])),
      h('p', { class: 'hint' },
        anyLifted
          ? '合力小于总重力是因为合力落点已超出支承四边形, 必须调整幅度/站位, 不能强行作业'
          : `反力合计 ${(reactions.reduce((s, r) => s + r.reaction, 0)).toFixed(2)} kN = 自重+吊载总重力`),
    );

    if (locked) {
      right.append(h('div', { class: 'check-fail' }, '⛔ 吊载率超过 100%, 机构已锁定, 请减小幅度或收臂'));
    }
  }

  function guard(): boolean {
    const lr = loadRatio(model, pose, liftedMass);
    if (lr.ratio > 1.0) {
      locked = true;
      renderTelemetry();
      return false;
    }
    locked = false;
    return true;
  }

  function renderControls(): void {
    clear(left);
    left.append(h('h3', {}, '机构操控 (受速度上限约束)'));
    const mutate = (fn: () => void) => { fn(); if (guard()) { rebuild3D(); renderTelemetry(); } };

    left.append(
      label(`回转 ${rad2deg(pose.slew).toFixed(1)}°`, slider(rad2deg(pose.slew), -180, 180, 0.5,
        (v) => mutate(() => { pose.slew = deg2rad(v); }))),
      label(`变幅 ${rad2deg(pose.luff).toFixed(1)}° (限位 ${model.luffMinDeg}~${model.luffMaxDeg}°)`,
        slider(rad2deg(pose.luff), model.luffMinDeg, model.luffMaxDeg, 0.5,
          (v) => mutate(() => { pose.luff = deg2rad(v); }))),
      label(`绳长 ${pose.hoist.toFixed(2)} m`, slider(pose.hoist, 1, model.maxHoist, 0.1,
        (v) => mutate(() => { pose.hoist = v; }))),
      label('吊载质量 t', numInput(liftedMass, 1, (v) => { liftedMass = Math.max(0, v); guard(); rebuild3D(); renderTelemetry(); }, 0, 160)),
      h('p', { class: 'hint' }, `当前臂长 ${currentBoomLength(model, pose).toFixed(2)} m, 速度上限: 回转 ${rad2deg(model.speedLimits.slew).toFixed(1)}°/s, 变幅 ${rad2deg(model.speedLimits.luff).toFixed(1)}°/s`),
    );

    pose.sections.forEach((s, i) => {
      left.append(label(`第 ${i + 1} 节伸缩 ${(s * 100).toFixed(0)}%`, slider(s, 0, 1, 0.02,
        (v) => mutate(() => { pose.sections[i] = v; }))));
    });

    // 支腿逐条配置
    left.append(h('h4', {}, '支腿配置'));
    model.outriggers.forEach((spec, i) => {
      const st = pose.outriggers[i];
      const row = h('div', { class: 'sub-form' }, h('strong', {}, spec.name));
      row.append(h('label', { class: 'field' }, h('span', {}, '伸出'),
        h('input', {
          type: 'checkbox', ...(st.deployed ? { checked: true } : {}),
          onchange: (e) => mutate(() => { st.deployed = (e.target as HTMLInputElement).checked; }),
        })));
      row.append(label('垫木层数', slider(st.blocks, 0, 3, 1,
        (v) => mutate(() => { st.blocks = v; }))));
      left.append(row);
    });

    left.append(
      h('h4', {}, '性能表 (全伸支腿, 额定起重量 t)'),
      h('div', { class: 'chart-scroll' }, table(
        ['臂长\\半径', ...model.loadCharts[0].radii.map((r) => `${r}m`)],
        model.loadCharts[0].boomLengths.map((L, li) => [`${L}m`, ...model.loadCharts[0].capacities[li].map((v) => v.toFixed(1))]),
      )),
      button('复位姿态', () => {
        pose.slew = 0; pose.luff = deg2rad(70); pose.hoist = 8;
        pose.sections = pose.sections.map(() => 0.2);
        locked = false; rebuild3D(); renderTelemetry(); renderControls();
      }),
    );
  }

  viewport = new Viewport(canvas, () => { rebuild3D(); });
  viewport.renderer.camera.target = [0, 6, 0];
  viewport.renderer.camera.distance = 36;
  rebuild3D();
  renderControls();
  renderTelemetry();
}

function fmt(v: number[]): string {
  return v.map((x) => x.toFixed(4)).join(', ');
}

function sumReactions(rs: { reaction: number }[]): number {
  return rs.reduce((s, r) => s + r.reaction, 0);
}
