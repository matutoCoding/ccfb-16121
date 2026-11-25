import type {
  CraneAction,
  CraneActionType,
  CranePlacement,
  RescuePlan,
} from '../types';
import { getState, setState, updateData } from '../state';
import { saveItem, uid } from '../services/repository';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, fmt, num, toast } from '../render/viewport';
import {
  approachJoint,
  defaultJointState,
  evaluateLoad,
  extArray,
  forwardKinematics,
  jointTargetFromAction,
  outriggerLabel,
  type CraneJointState,
} from '../dynamics/crane';
import { carTotalMass, dualCraneShare, liftPointWorld, markBearing, outriggerReactions, slingGeometry, slingHitsCarBody } from '../dynamics/statics';
import { boomCatenaryClearance } from '../dynamics/scene';
import { DEG } from '../core/mathutil';
import { mat4Translation } from '../core/mat4';
import { simulate, FIXED_DT } from '../dynamics/engine';

const ACTION_LABEL: Record<CraneActionType, string> = {
  slew: '回转(°)',
  luff: '变幅(°)',
  hoist: '吊钩高度(m)',
  extend: '臂节伸出(m数组)',
};

/** 截至预览步骤末，某台起重机通过挂钩承担的车辆质量（吨，双机按杠杆法则分担） */
function previewLiftedMass(p: RescuePlan, placementId: string, stepIndex: number): number {
  // 找出该起重机当前仍有效的挂钩（最后一次 unrigAfter 之后的 rigging）
  const activeRigs: { carId: string; liftPointId: string; placementId: string }[] = [];
  for (const step of p.steps.slice(0, stepIndex + 1)) {
    if (step.unrigAfter) activeRigs.length = 0;
    for (const r of step.rigging ?? []) {
      if (!activeRigs.some((x) => x.placementId === r.placementId && x.carId === r.carId)) activeRigs.push(r);
    }
  }
  let sum = 0;
  const carsById = new Map(p.derailedCars.map((d) => [d.id, d]));
  for (const rig of activeRigs.filter((r) => r.placementId === placementId)) {
    const dc = carsById.get(rig.carId);
    const carModel = getState().data.carModels.find((c) => c.id === dc?.carModelId);
    if (!dc || !carModel) continue;
    const sameCarRigs = activeRigs.filter((r) => r.carId === rig.carId);
    if (sameCarRigs.length <= 1) {
      sum += carTotalMass(carModel);
    } else {
      // 双机：按吊点与重心的杠杆法则（与引擎 currentLiftedMass 同一函数）
      const pts = sameCarRigs.map((r) => {
        const lp = carModel.liftPoints.find((x) => x.id === r.liftPointId)!;
        return liftPointWorld(carModel, dc, lp);
      });
      const share = dualCraneShare(carModel, dc, pts[0], pts[1]);
      sum += sameCarRigs[0].placementId === placementId ? share.massA : share.massB;
    }
  }
  return sum;
}

export function mountPlanPage(root: HTMLElement): void {
  const state = getState();
  root.innerHTML = `
    <div class="sidebar wide">
      <div class="panel">
        <h3>方案列表 <button class="btn small" id="new-plan">新建</button></h3>
        <div id="plan-list"></div>
      </div>
      <div class="panel" id="place-panel"></div>
      <div class="panel" id="step-panel"></div>
    </div>
    <div class="stage"><canvas></canvas>
      <div class="hud" id="hud"></div>
      <div class="hud right" id="rig-panel"></div>
    </div>`;

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  let planId = state.selectedPlanId ?? state.data.plans[0]?.id;
  let previewStep = 0; // 预览到第几步结束
  let raf = 0;
  const disposers: (() => void)[] = [];

  const plan = (): RescuePlan | undefined => getState().data.plans.find((p) => p.id === planId);
  const scene = () => getState().data.scenes.find((s) => s.id === plan()?.sceneId);
  const craneModel = (pl: CranePlacement) => getState().data.cranes.find((c) => c.id === pl.craneModelId);

  const persist = async (): Promise<void> => {
    const p = plan();
    if (!p) return;
    p.updatedAt = Date.now();
    await saveItem('plans', p);
    updateData({ plans: [...getState().data.plans] });
  };

  // 按方案步骤把关节推进到指定步骤末态（用于编辑时的静态预览）
  const jointsAtPreview = (): Map<string, CraneJointState> => {
    const p = plan();
    const joints = new Map<string, CraneJointState>();
    if (!p) return joints;
    for (const pl of p.cranePlacements) {
      const m = craneModel(pl);
      const j = defaultJointState();
      if (m) j.extensions = m.boomSections.map(() => 0);
      joints.set(pl.id, j);
    }
    const steps = p.steps.slice(0, previewStep + 1);
    for (const step of steps) {
      for (const pl of p.cranePlacements) {
        const m = craneModel(pl);
        const acts = step.actions[pl.id];
        if (!m || !acts) continue;
        let j = joints.get(pl.id)!;
        for (const a of acts) {
          const target = jointTargetFromAction(m, a.type, a.target);
          // 直接跳到目标（预览不关心过程时间）
          j = { ...j, ...target, extensions: target.extensions ?? j.extensions };
        }
        joints.set(pl.id, j);
      }
    }
    return joints;
  };

  const renderList = (): void => {
    const list = root.querySelector('#plan-list') as HTMLElement;
    clear(list);
    for (const p of getState().data.plans) {
      const item = el('div', `list-item ${p.id === planId ? 'selected' : ''}`);
      item.innerHTML = `<div class="title">${p.name}</div><div class="sub">${p.steps.length} 步 · ${p.cranePlacements.length} 台起重机 · ${p.derailedCars.length} 辆脱轨车</div>`;
      item.onclick = () => {
        planId = p.id;
        previewStep = Math.min(previewStep, p.steps.length - 1);
        renderList();
        renderPlace();
        renderSteps();
      };
      list.appendChild(item);
    }
  };

  const renderPlace = (): void => {
    const panel = root.querySelector('#place-panel') as HTMLElement;
    clear(panel);
    const p = plan();
    if (!p) return;
    panel.innerHTML = '<h3>起重机站位与支腿</h3>';
    // 现场选择
    const scSel = document.createElement('select');
    getState().data.scenes.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      opt.selected = s.id === p.sceneId;
      scSel.appendChild(opt);
    });
    scSel.onchange = () => {
      p.sceneId = scSel.value;
      void persist();
    };
    panel.appendChild(scSel);

    p.cranePlacements.forEach((pl, idx) => {
      const m = craneModel(pl);
      if (!m) return;
      const box = el('div', 'panel');
      box.innerHTML = `<h4>${m.name} #${idx + 1}</h4>`;
      const pos = el('div', 'row');
      (['x', 'y', 'z'] as const).forEach((axis, i) => {
        const wrap = el('label', 'field');
        wrap.innerHTML = `<span>站位${axis.toUpperCase()}(m)</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.1';
        inp.value = pl.position[i].toFixed(2);
        inp.onchange = () => {
          pl.position[i] = num(inp.value, pl.position[i]);
          void persist();
        };
        wrap.appendChild(inp);
        pos.appendChild(wrap);
      });
      box.appendChild(pos);

      const head = el('label', 'field');
      head.innerHTML = '<span>底盘航向(°)</span>';
      const hInp = document.createElement('input');
      hInp.type = 'number';
      hInp.value = String(pl.headingDeg);
      hInp.onchange = () => {
        pl.headingDeg = num(hInp.value, pl.headingDeg);
        void persist();
      };
      head.appendChild(hInp);
      box.appendChild(head);

      const chartSel = document.createElement('select');
      m.loadCharts.forEach((ch) => {
        const opt = document.createElement('option');
        opt.value = ch.state;
        opt.textContent = ch.label;
        opt.selected = ch.state === pl.chartState;
        chartSel.appendChild(opt);
      });
      chartSel.onchange = () => {
        pl.chartState = chartSel.value;
        void persist();
      };
      box.appendChild(chartSel);

      // 每条支腿独立位置 + 垫木块数
      pl.outriggers.forEach((leg, li) => {
        const legBox = el('div');
        legBox.innerHTML = `<h4>${outriggerLabel(li)}支腿</h4>`;
        const r = el('div', 'row');
        (['x', 'z'] as const).forEach((axis, ai) => {
          const wrap = el('label', 'field');
          wrap.innerHTML = `<span>${axis.toUpperCase()}(m)</span>`;
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = '0.1';
          inp.value = leg.position[ai === 0 ? 0 : 2].toFixed(2);
          inp.onchange = () => {
            leg.position[ai === 0 ? 0 : 2] = num(inp.value, 0);
            void persist();
          };
          wrap.appendChild(inp);
          r.appendChild(wrap);
        });
        const wood = el('label', 'field');
        wood.innerHTML = '<span>垫木块数</span>';
        const wInp = document.createElement('input');
        wInp.type = 'number';
        wInp.min = '0';
        wInp.max = '6';
        wInp.value = String(leg.woodLayers);
        wInp.onchange = () => {
          leg.woodLayers = Math.max(0, Math.min(6, num(wInp.value, leg.woodLayers)));
          void persist();
        };
        wood.appendChild(wInp);
        r.appendChild(wood);
        legBox.appendChild(r);
        box.appendChild(legBox);
      });
      panel.appendChild(box);
    });

    const addCrane = el('button', 'btn ghost small');
    addCrane.textContent = '增加一台起重机（双机抬吊）';
    addCrane.onclick = () => {
      const m = getState().data.cranes[0];
      if (!m || p.cranePlacements.length >= 2) return toast('最多支持双机抬吊');
      const pl: CranePlacement = {
        id: uid('crane'),
        craneModelId: m.id,
        position: [-5.5, 0, -2],
        headingDeg: 180,
        chartState: m.loadCharts[0].state,
        outriggers: m.outriggerBase.map((o) => ({ position: [o[0] - 5.5, 0, o[2] - 2], woodLayers: 2 })),
      };
      p.cranePlacements.push(pl);
      void persist().then(() => {
        renderPlace();
        renderSteps();
      });
    };
    panel.appendChild(addCrane);
  };

  const renderSteps = (): void => {
    const panel = root.querySelector('#step-panel') as HTMLElement;
    clear(panel);
    const p = plan();
    if (!p) return;
    panel.innerHTML = '<h3>时间轴步骤</h3>';
    p.steps.forEach((step, si) => {
      const chip = el('div', `list-item ${si === previewStep ? 'selected' : ''}`);
      chip.innerHTML = `<div class="title">${si + 1}. ${step.name}</div>`;
      chip.onclick = () => {
        previewStep = si;
        renderSteps();
      };
      // 动作编辑
      for (const pl of p.cranePlacements) {
        const acts = step.actions[pl.id] ?? [];
        const sub = el('div', 'muted');
        sub.style.marginTop = '4px';
        sub.innerHTML = `起重机 ${pl.id}：`;
        acts.forEach((a, ai) => {
          const row = el('div', 'row');
          row.style.marginTop = '3px';
          const typeSel = document.createElement('select');
          (Object.keys(ACTION_LABEL) as CraneActionType[]).forEach((t) => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = ACTION_LABEL[t];
            opt.selected = t === a.type;
            typeSel.appendChild(opt);
          });
          typeSel.onchange = () => {
            a.type = typeSel.value as CraneActionType;
            a.target = a.type === 'extend' ? [0, 0, 0, 0] : 0;
            void persist().then(renderSteps);
          };
          row.appendChild(typeSel);
          const valInp = document.createElement('input');
          valInp.placeholder = '目标值';
          valInp.value = Array.isArray(a.target) ? a.target.join(',') : String(a.target);
          valInp.onchange = () => {
            if (a.type === 'extend') {
              a.target = valInp.value.split(',').map((x) => num(x.trim(), 0));
            } else {
              a.target = num(valInp.value, 0);
            }
            void persist();
          };
          row.appendChild(valInp);
          const del = el('button', 'btn danger small', '×');
          del.onclick = () => {
            acts.splice(ai, 1);
            void persist().then(renderSteps);
          };
          row.appendChild(del);
          sub.appendChild(row);
        });
        const addAct = el('button', 'btn ghost small', '+ 动作');
        addAct.style.marginTop = '4px';
        addAct.onclick = () => {
          const m = craneModel(pl);
          const newAct: CraneAction = { type: 'slew', target: 0, durationSec: 0 };
          void m;
          (step.actions[pl.id] ??= []).push(newAct);
          void persist().then(renderSteps);
        };
        sub.appendChild(addAct);
        chip.appendChild(sub);
      }
      // 挂钩
      if (step.rigging?.length) {
        const rg = el('div', 'muted');
        rg.style.marginTop = '4px';
        rg.textContent = '挂钩：' + step.rigging.map((r) => `${r.placementId}→${r.liftPointId}`).join('；');
        chip.appendChild(rg);
      }
      if (step.unrigAfter) chip.appendChild(el('div', 'warn-text', '步骤末摘钩'));
      const rm = el('button', 'btn danger small', '删除步骤');
      rm.style.marginTop = '6px';
      rm.onclick = () => {
        p.steps.splice(si, 1);
        previewStep = Math.max(0, previewStep - 1);
        void persist().then(() => {
          renderSteps();
          renderList();
        });
      };
      chip.appendChild(rm);
      panel.appendChild(chip);
    });

    const addStep = el('button', 'btn', '+ 新增步骤');
    addStep.onclick = () => {
      const actions: RescuePlan['steps'][number]['actions'] = {};
      for (const pl of p.cranePlacements) actions[pl.id] = [];
      p.steps.push({ id: uid('step'), name: `步骤 ${p.steps.length + 1}`, actions });
      void persist().then(() => {
        renderSteps();
        renderList();
      });
    };
    panel.appendChild(addStep);

    const run = el('button', 'btn');
    run.textContent = '▶ 运行完整推演（结果送入回放页）';
    run.style.width = '100%';
    run.style.marginTop = '10px';
    run.onclick = () => {
      const sc = scene();
      if (!sc) return;
      const ctx = {
        craneModels: new Map(getState().data.cranes.map((c) => [c.id, c])),
        carModels: new Map(getState().data.carModels.map((c) => [c.id, c])),
        scene: sc,
      };
      const result = simulate(p, ctx);
      setState({
        lastSimulation: { planId: p.id, frames: result.frames, dangers: result.dangers, durationSec: result.durationSec },
      });
      toast(`推演完成：${result.frames.length} 帧，${result.dangers.length} 个危险帧`);
    };
    panel.appendChild(run);
  };

  root.querySelector('#new-plan')!.addEventListener('click', async () => {
    const base = plan();
    const copy: RescuePlan = structuredClone(base ?? getState().data.plans[0]);
    copy.id = uid('plan');
    copy.name = `新方案 ${getState().data.plans.length + 1}`;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    updateData({ plans: [...getState().data.plans, copy] });
    await saveItem('plans', copy);
    planId = copy.id;
    previewStep = 0;
    renderList();
    renderPlace();
    renderSteps();
  });

  // 视口渲染：静态预览当前步骤末态 + 实时受力/净空
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    const p = plan();
    const sc = scene();
    if (!p || !sc) {
      renderer.end();
      return;
    }
    renderer.drawScene(sc);
    const joints = jointsAtPreview();
    const hudLines: string[] = [];
    const rigLines: string[] = [];

    for (const dc of p.derailedCars) {
      const model = getState().data.carModels.find((c) => c.id === dc.carModelId);
      if (model) renderer.drawCar(model, dc, true);
    }

    for (const pl of p.cranePlacements) {
      const m = craneModel(pl);
      const j = joints.get(pl.id);
      if (!m || !j) continue;
      const fk = forwardKinematics(m, pl, j);
      // 预览吊重：按截至当前步骤的挂钩关系求真实分担质量
      const liftedT = previewLiftedMass(p, pl.id, previewStep);
      const grossT = m.hookBlockMassT + liftedT;
      const ev = evaluateLoad(m, pl, grossT, fk.radius, fk.boomLength);
      const yaw = pl.headingDeg * DEG;
      const dx = fk.hookWorld[0] - fk.slewCenterWorld[0];
      const dz = fk.hookWorld[2] - fk.slewCenterWorld[2];
      const localOff: [number, number, number] = [dx * Math.cos(-yaw) - dz * Math.sin(-yaw), 0, dx * Math.sin(-yaw) + dz * Math.cos(-yaw)];
      const reaction = markBearing(outriggerReactions(m, pl, grossT, localOff), sc.allowableBearingKPa);
      const clearance = boomCatenaryClearance(sc, fk.boomFootWorld, fk.boomTipWorld);

      renderer.drawCrane(m, pl, j, {
        placementId: pl.id,
        slewDeg: j.slewDeg,
        luffDeg: j.luffDeg,
        boomLength: fk.boomLength,
        radius: fk.radius,
        hookPosition: fk.hookWorld,
        hookHeight: fk.hookWorld[1],
        liftedMassT: grossT,
        ratedCapacityT: ev.ratedT,
        loadRatioPct: ev.ratioPct,
        locked: ev.locked,
        outriggers: reaction.forces,
        reactionSumKN: reaction.sumKN,
        expectedTotalKN: reaction.expectedKN,
        catenaryClearanceM: clearance.minDistance,
      });

      // 当前步骤若含挂钩，画吊索并检查
      const step = p.steps[previewStep];
      const rig = step?.rigging?.find((r) => r.placementId === pl.id);
      if (rig) {
        const dc = p.derailedCars.find((x) => x.id === rig.carId);
        const carModel = dc && getState().data.carModels.find((c) => c.id === dc.carModelId);
        const lp = carModel?.liftPoints.find((x) => x.id === rig.liftPointId);
        if (dc && carModel && lp) {
          const wp = liftPointWorld(carModel, dc, lp);
          renderer.drawSlings(fk.hookWorld, [wp], false);
          const geo = slingGeometry(fk.hookWorld, [wp]);
          const hit = slingHitsCarBody(fk.hookWorld, wp, carModel, dc);
          rigLines.push(`<div class="k"><span>吊索夹角</span><b class="${geo.includedAngleDeg > 90 ? 'warn-text' : ''}">${fmt(geo.includedAngleDeg)}°</b></div>`);
          if (hit) rigLines.push('<div class="danger-text">吊索蹭车体！</div>');
        }
      }

      const cls = ev.level === 'danger' ? 'danger-text' : ev.level === 'warn' ? 'warn-text' : 'ok-text';
      hudLines.push(`
        <div class="k"><span>${pl.id} 吊载率</span><b class="${cls}">${ev.ratioPct.toFixed(1)}%${ev.locked ? ' 锁定' : ''}</b></div>
        <div class="k"><span>臂长/半径</span><b>${fmt(fk.boomLength)}/${fmt(fk.radius)}m</b></div>
        <div class="k"><span>反力和/应承受</span><b>${fmt(reaction.sumKN, 1)}/${fmt(reaction.expectedKN, 1)}kN</b></div>
        <div class="k"><span>接触网净空</span><b class="${clearance.violation ? 'danger-text' : ''}">${Number.isFinite(clearance.minDistance) ? fmt(clearance.minDistance) + 'm' : '—'}</b></div>`);
      reaction.forces.forEach((f, i) => {
        hudLines.push(`<div class="k" style="padding-left:10px"><span>${outriggerLabel(i)}</span><b class="${f.overloaded ? 'danger-text' : ''}">${fmt(f.reactionKN, 0)}kN / ${fmt(f.bearingKPa, 0)}kPa</b></div>`);
      });
    }
    (root.querySelector('#hud') as HTMLElement).innerHTML = hudLines.join('');
    (root.querySelector('#rig-panel') as HTMLElement).innerHTML = `<b>吊索与挂钩</b>${rigLines.join('') || '<div class="muted" style="margin-top:6px">当前步骤无挂钩动作</div>'}`;
    renderer.end();
  };

  disposers.push(bindViewport(canvas, renderer, {}));
  renderList();
  renderPlace();
  renderSteps();
  loop();
  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
  void approachJoint;
  void extArray;
  void mat4Translation;
  void FIXED_DT;
}
