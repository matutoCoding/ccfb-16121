// 吊复方案页面: 时间轴步骤、每步机构动作、吊索挂载校验、双机抬吊分担、落轨对轨检查。
import { h, clear, button, label, numInput, select, slider, table } from '../dom';
import { state, savePlan, deletePlan, uid } from '../store';
import { computeKinematics, loadRatio } from '../../core/crane';
import { evaluateSling, slingAlerts, dualCraneShare, tankCarMassAndCog } from '../../core/rigging';
import { rad2deg, deg2rad } from '../../core/geometry';
import { mat4, fromTRS, transformPoint } from '../../core/mat4';
import type { CranePose, PlanStep, RescuePlan, CraneAction, Vec3M } from '../../core/types';

export async function renderPlanList(root: HTMLElement): Promise<void> {
  clear(root);
  root.append(h('h2', {}, '吊复方案'));
  const list = h('div', { class: 'panel' });
  root.append(list);

  function renderList(): void {
    clear(list);
    list.append(
      button('+ 新建方案', () => {
        const scene = state.scenes[0];
        const plan: RescuePlan = {
          id: uid('plan'), name: '新吊复方案', sceneId: scene.id,
          steps: defaultSteps(), createdAt: Date.now(), updatedAt: Date.now(),
        };
        state.plans.push(plan);
        void savePlan(plan).then(() => renderEditor(plan));
      }, 'primary'),
      h('div', { class: 'plan-grid' },
        ...state.plans.map((p) => h('div', { class: 'plan-card' },
          h('strong', {}, p.name),
          h('small', {}, `${state.scenes.find((s) => s.id === p.sceneId)?.name ?? '现场已删'} · ${p.steps.length} 步`),
          h('div', { class: 'card-actions' },
            button('编辑', () => renderEditor(p), 'primary'),
            button('删除', () => { void deletePlan(p.id).then(renderList); }, 'danger'),
          ),
        ))),
    );
  }

  function defaultSteps(): PlanStep[] {
    const pose = state.scenes[0].cranePoses[0];
    const target = (over: Partial<CranePose>): CraneAction => ({ type: 'combined', craneIndex: 0, target: over });
    return [
      { id: uid('step'), name: '支腿落地、垫木夯实', durationSec: 30, actions: [{ type: 'hoist', craneIndex: 0, target: { outriggers: pose.outriggers.map((o) => ({ ...o })) } }] },
      { id: uid('step'), name: '回转对位、落钩挂索', durationSec: 60, actions: [target({ slew: deg2rad(20), hoist: 4 })] },
      { id: uid('step'), name: '试吊 (离地 200mm 停 5 分钟检查)', durationSec: 40, actions: [target({ hoist: 3 })] },
      { id: uid('step'), name: '起升到安全高度', durationSec: 50, actions: [target({ hoist: 6, luff: deg2rad(60) })] },
      { id: uid('step'), name: '回转至线路上方', durationSec: 70, actions: [target({ slew: 0 })] },
      { id: uid('step'), name: '落车对轨', durationSec: 60, actions: [target({ hoist: 2.5, luff: deg2rad(50) })] },
      { id: uid('step'), name: '脱钩收臂', durationSec: 40, actions: [target({ hoist: 8 })] },
    ];
  }

  function renderEditor(plan: RescuePlan): void {
    clear(root);
    root.append(h('h2', {}, '方案编辑'));
    const scene = state.scenes.find((s) => s.id === plan.sceneId) ?? state.scenes[0];
    const model = state.cranes[0];
    const carType = state.cars.find((c) => c.id === scene.cars[0].carTypeId)!;
    const pose: CranePose = JSON.parse(JSON.stringify(scene.cranePoses[0]));

    const layout = h('div', { class: 'page-layout' });
    const left = h('div', { class: 'panel wide' });
    const right = h('div', { class: 'panel' });
    layout.append(left, right);
    root.append(h('div', { class: 'toolbar' },
      button('← 返回列表', renderList),
      label('方案名称', h('input', { value: plan.name, oninput: (e) => { plan.name = (e.target as HTMLInputElement).value; void savePlan(plan); } })),
      button('保存方案', () => { void savePlan(plan); alert('已保存到 IndexedDB'); }, 'primary'),
    ), layout);

    // 吊索与双机
    function renderRigging(): void {
      clear(right);
      const k = computeKinematics(model, pose);
      const carRoot = fromTRS(mat4(), scene.cars[0].position,
        { x: scene.cars[0].rotation[0], y: scene.cars[0].rotation[1], z: scene.cars[0].rotation[2] }, [1, 1, 1]);
      const pointIds = carType.liftPoints.slice(0, 2).map((p) => p.id);
      const worlds = carType.liftPoints.slice(0, 2).map((p) => transformPoint(carRoot, p.offset) as Vec3M);
      const sling = evaluateSling({
        hook: k.hook, carPointIds: pointIds, pointWorlds: worlds,
        carHalfSize: carType.parts[0].halfSize, carCenter: scene.cars[0].position,
      });
      const alerts = slingAlerts(sling);
      const massInfo = tankCarMassAndCog(carType);
      right.append(
        h('h3', {}, '吊索与吊装'),
        table(['项目', '数值'], [
          ['车辆总质量', `${massInfo.mass.toFixed(1)} t`],
          ['吊索夹角', `${sling.includedAngleDeg.toFixed(1)}° (限值 90° 警告 / 120° 禁吊)`],
          ['吊索-车体净距', `${sling.clearance.toFixed(3)} m (<0.05m 判蹭车体)`],
          ...sling.lengths.map((l, i) => [`索 ${i + 1} 长度`, `${l.toFixed(2)} m`] as [string, string]),
        ]),
        ...(alerts.length ? alerts.map((a) => h('div', { class: a.level === 'danger' ? 'check-fail' : 'check-warn' }, a.text))
          : [h('div', { class: 'check-pass' }, '✓ 吊索夹角与净距满足要求')]),
      );

      if (scene.cranePoses.length >= 2) {
        const k2 = computeKinematics(model, scene.cranePoses[1]);
        const share = dualCraneShare(massInfo.mass, k.hook, k2.hook, scene.cars[0].position);
        right.append(h('h4', {}, '双机抬吊分担 (按吊点-重心力矩分配)'),
          table(['起重机', '分担比例', '分担质量'], [
            ['1 号机', `${(share.ratio1 * 100).toFixed(1)}%`, `${share.share1.toFixed(1)} t`],
            ['2 号机', `${(share.ratio2 * 100).toFixed(1)}%`, `${share.share2.toFixed(1)} t`],
          ]));
      }
      const lr = loadRatio(model, pose, massInfo.mass);
      right.append(h('h4', {}, '当前姿态吊载率'),
        h('div', { class: lr.ratio > 1 ? 'ratio-badge danger' : lr.ratio > 0.9 ? 'ratio-badge warn' : 'ratio-badge ok' },
          `${(lr.ratio * 100).toFixed(1)}% (额定 ${lr.rated.toFixed(1)} t)`));
    }

    function renderSteps(): void {
      const existing = left.querySelector('.steps-wrap') as HTMLElement | null;
      const wrap = existing ?? h('div', { class: 'steps-wrap' });
      clear(wrap);
      wrap.append(h('h3', {}, `时间轴 (${plan.steps.length} 步)`));
      plan.steps.forEach((step, si) => {
        const card = h('div', { class: 'step-card' },
          h('div', { class: 'step-head' },
            h('input', { value: step.name, oninput: (e) => { step.name = (e.target as HTMLInputElement).value; void savePlan(plan); } }),
            h('small', {}, `#${si + 1}`),
            button('✕', () => { plan.steps.splice(si, 1); void savePlan(plan); renderSteps(); }, 'danger'),
          ),
          label('历时 s', numInput(step.durationSec, 5, (v) => { step.durationSec = v; void savePlan(plan); }, 5, 600)),
        );
        step.actions.forEach((action, ai) => {
          const t = action.target;
          const row = h('div', { class: 'sub-form' }, h('strong', {}, `动作 ${ai + 1}`));
          if (t.slew !== undefined) row.append(label(`回转目标 ${rad2deg(t.slew).toFixed(0)}°`,
            slider(rad2deg(t.slew), -180, 180, 1, (v) => { t.slew = deg2rad(v); void savePlan(plan); })));
          if (t.luff !== undefined) row.append(label(`变幅目标 ${rad2deg(t.luff).toFixed(0)}°`,
            slider(rad2deg(t.luff), model.luffMinDeg, model.luffMaxDeg, 1, (v) => { t.luff = deg2rad(v); void savePlan(plan); })));
          if (t.hoist !== undefined) row.append(label(`绳长目标 ${t.hoist.toFixed(1)}m`,
            slider(t.hoist, 1, model.maxHoist, 0.1, (v) => { t.hoist = v; void savePlan(plan); })));
          if (t.sections) row.append(h('small', { class: 'hint' }, `伸缩节目标: ${t.sections.map((s) => `${Math.round((s ?? 0) * 100)}%`).join(' / ')}`));
          card.append(row);
        });
        card.append(button('+ 添加动作', () => {
          step.actions.push({ type: 'combined', craneIndex: 0, target: { slew: pose.slew, luff: pose.luff, hoist: pose.hoist } });
          void savePlan(plan); renderSteps();
        }));
        wrap.append(card);
      });
      wrap.append(
        button('+ 新增步骤', () => {
          plan.steps.push({ id: uid('step'), name: '新步骤', durationSec: 30, actions: [{ type: 'combined', craneIndex: 0, target: { ...pose } }] });
          void savePlan(plan); renderSteps();
        }, 'primary'),
      );
      if (!existing) left.append(wrap);
    }

    renderSteps();
    renderRigging();
  }

  renderList();
}
