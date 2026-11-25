import type { CraneModel, CranePlacement } from '../types';
import { getState, updateData } from '../state';
import { saveItem } from '../services/repository';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, fmt, num, toast } from '../render/viewport';
import {
  defaultJointState,
  evaluateLoad,
  extArray,
  forwardKinematics,
  luffFromRadius,
  ratedCapacity,
} from '../dynamics/crane';
import { markBearing, outriggerReactions } from '../dynamics/statics';
import { DEG } from '../core/mathutil';

export function mountCranesPage(root: HTMLElement): void {
  const state = getState();
  root.innerHTML = `
    <div class="sidebar wide">
      <div class="panel">
        <h3>起重机型谱</h3>
        <div id="crane-list"></div>
      </div>
      <div class="panel" id="params"></div>
      <div class="panel" id="chart-panel"></div>
    </div>
    <div class="stage"><canvas></canvas>
      <div class="hud" id="hud"></div>
    </div>`;

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  let selectedId = state.selectedCraneId ?? state.data.cranes[0]?.id;
  const joint = defaultJointState();
  let raf = 0;
  const disposers: (() => void)[] = [];

  const current = (): CraneModel | undefined => getState().data.cranes.find((c) => c.id === selectedId);

  const dummyPlacement = (model: CraneModel): CranePlacement => ({
    id: 'demo',
    craneModelId: model.id,
    position: [0, 0, 0],
    headingDeg: 0,
    chartState: model.loadCharts[0].state,
    outriggers: model.outriggerBase.map((p, i) => ({ position: p, woodLayers: i < 2 ? 1 : 2 })),
  });

  const renderList = (): void => {
    const list = root.querySelector('#crane-list') as HTMLElement;
    clear(list);
    for (const c of getState().data.cranes) {
      const item = el('div', `list-item ${c.id === selectedId ? 'selected' : ''}`);
      item.innerHTML = `<div class="title">${c.name}</div><div class="sub">自重 ${c.selfWeightT}t · ${c.boomSections.length} 节臂 · 最大臂长 ${c.boomSections.reduce((s, x) => s + x.maxLen, 0).toFixed(1)}m</div>`;
      item.onclick = () => {
        selectedId = c.id;
        joint.extensions = c.boomSections.map(() => 0);
        renderList();
        renderParams();
        renderChart();
      };
      list.appendChild(item);
    }
  };

  const renderParams = (): void => {
    const panel = root.querySelector('#params') as HTMLElement;
    clear(panel);
    const model = current();
    if (!model) return;
    panel.innerHTML = `<h3>刚体层级与关节</h3>`;
    const tree = el('div', 'muted');
    tree.innerHTML = `
      <div>└─ 底盘 chassis（世界坐标）</div>
      <div style="padding-left:14px">└─ 转台 slew（绕 Y 回转，上限 ${model.speedLimits.slewDegPerSec}°/s）</div>
      <div style="padding-left:28px">└─ 臂根 boomFoot → 主臂 boom（绕 X 变幅 ${model.luffMinDeg}~${model.luffMaxDeg}°，上限 ${model.speedLimits.luffDegPerSec}°/s）</div>
      <div style="padding-left:42px">${model.boomSections.map((s) => `└─ ${s.name}（${s.minLen.toFixed(1)}~${s.maxLen.toFixed(1)}m）`).join('<br>')}</div>
      <div style="padding-left:56px">└─ 钢丝绳 rope → 吊钩 hook（起升上限 ${model.speedLimits.hoistMPerSec}m/s）</div>
      <div>└─ 四条支腿（各自独立垫板位置）</div>`;
    panel.appendChild(tree);

    const sliders: [string, number, number, number, number, () => number, (v: number) => void][] = [
      ['回转角 slew', -180, 180, 1, joint.slewDeg, () => joint.slewDeg, (v) => (joint.slewDeg = v)],
      ['变幅角 luff', model.luffMinDeg, model.luffMaxDeg, 1, joint.luffDeg, () => joint.luffDeg, (v) => (joint.luffDeg = v)],
      ['伸缩比例', 0, 1, 0.01, 0.5, () => 0.5, (v) => (joint.extensions = extArray(model, v))],
      ['吊钩高度', 0.5, 12, 0.1, joint.hookHeight, () => joint.hookHeight, (v) => (joint.hookHeight = v)],
    ];
    for (const [label, min, max, step, _initial, _get, set] of sliders) {
      const wrap = el('label', 'field');
      const val = label === '伸缩比例' ? 0.5 : (label.startsWith('回转') ? joint.slewDeg : label.startsWith('变幅') ? joint.luffDeg : joint.hookHeight);
      wrap.innerHTML = `<span>${label}：<b class="mono" id="sv">${fmt(val as number, 2)}</b></span>`;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(val);
      inp.oninput = () => {
        set(num(inp.value));
        (wrap.querySelector('#sv') as HTMLElement).textContent = fmt(num(inp.value), 2);
      };
      wrap.appendChild(inp);
      panel.appendChild(wrap);
    }

    // 速度上限可编辑
    const speedPanel = el('div');
    speedPanel.innerHTML = '<h4>速度上限（可编辑）</h4>';
    const speedRows: [keyof CraneModel['speedLimits'], string][] = [
      ['slewDegPerSec', '回转 °/s'],
      ['luffDegPerSec', '变幅 °/s'],
      ['hoistMPerSec', '起升 m/s'],
      ['extendMPerSec', '伸缩 m/s'],
    ];
    for (const [key, label] of speedRows) {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>${label}</span>`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.1';
      inp.value = String(model.speedLimits[key]);
      inp.onchange = () => {
        model.speedLimits[key] = num(inp.value, model.speedLimits[key]);
        void saveItem('cranes', model);
        toast('已保存');
      };
      wrap.appendChild(inp);
      speedPanel.appendChild(wrap);
    }
    panel.appendChild(speedPanel);
  };

  const renderChart = (): void => {
    const panel = root.querySelector('#chart-panel') as HTMLElement;
    clear(panel);
    const model = current();
    if (!model) return;
    panel.innerHTML = `<h3>起重性能表（插值查询）</h3>`;
    const stateSel = document.createElement('select');
    model.loadCharts.forEach((ch) => {
      const opt = document.createElement('option');
      opt.value = ch.state;
      opt.textContent = ch.label;
      stateSel.appendChild(opt);
    });
    stateSel.onchange = () => {
      // 演示用 placement 切换图表状态
      const pl = dummyPlacement(model);
      pl.chartState = stateSel.value;
      void pl;
      update();
    };
    panel.appendChild(stateSel);

    const tableWrap = el('div');
    tableWrap.style.overflowX = 'auto';
    panel.appendChild(tableWrap);

    const query = el('div', 'panel');
    query.innerHTML = '<h4>实时查询（跟随左侧关节）</h4><div id="query-body"></div>';
    panel.appendChild(query);

    const update = (): void => {
      const chart = model.loadCharts.find((c) => c.state === stateSel.value) ?? model.loadCharts[0];
      let html = '<table><tr><th>半径\\臂长</th>';
      for (const b of chart.boomLengths) html += `<th>${b}m</th>`;
      html += '</tr>';
      chart.radii.forEach((r, i) => {
        html += `<tr><td>${r}m</td>`;
        for (const c of chart.grid[i]) html += `<td class="num">${c || '—'}</td>`;
        html += '</tr>';
      });
      html += '</table>';
      tableWrap.innerHTML = html;
    };
    update();

    const updateQuery = (): void => {
      const fk = forwardKinematics(model, dummyPlacement(model), joint);
      const chartState = stateSel.value;
      const rated = ratedCapacity(model, chartState, fk.radius, fk.boomLength);
      const gross = 50 + model.hookBlockMassT;
      const ev = evaluateLoad(model, { ...dummyPlacement(model), chartState }, gross, fk.radius, fk.boomLength);
      const body = query.querySelector('#query-body') as HTMLElement;
      const cls = ev.level === 'danger' ? 'danger' : ev.level === 'warn' ? 'warn' : 'ok';
      body.innerHTML = `
        <div class="k muted">当前臂长 <b class="mono">${fmt(fk.boomLength)} m</b></div>
        <div class="k muted">工作半径 <b class="mono">${fmt(fk.radius)} m</b>（反解变幅 ${fmt(luffFromRadius(fk.boomLength, fk.radius))}°）</div>
        <div class="k muted">额定起重量 <b class="mono">${fmt(rated)} t</b></div>
        <div class="k muted">示例吊重 50t 吊载率</div>
        <div class="gauge ${cls}"><div style="width:${Math.min(100, ev.ratioPct)}%"></div></div>
        <div><span class="tag ${cls}">${ev.ratioPct.toFixed(1)}% ${ev.locked ? '· 已锁定' : ''}</span></div>`;
    };
    (panel as unknown as { _updateQuery: () => void })._updateQuery = updateQuery;
    updateQuery();
  };

  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    const model = current();
    if (model) {
      const pl = dummyPlacement(model);
      const fk = forwardKinematics(model, pl, joint);
      const gross = 50 + model.hookBlockMassT;
      const ev = evaluateLoad(model, pl, gross, fk.radius, fk.boomLength);
      const localOff: [number, number, number] = [
        fk.hookWorld[0] - fk.slewCenterWorld[0],
        0,
        fk.hookWorld[2] - fk.slewCenterWorld[2],
      ];
      const reaction = markBearing(outriggerReactions(model, pl, gross, localOff), 150);
      renderer.drawCrane(model, pl, joint, {
        placementId: 'demo',
        slewDeg: joint.slewDeg,
        luffDeg: joint.luffDeg,
        boomLength: fk.boomLength,
        radius: fk.radius,
        hookPosition: fk.hookWorld,
        hookHeight: fk.hookWorld[1],
        liftedMassT: gross,
        ratedCapacityT: ev.ratedT,
        loadRatioPct: ev.ratioPct,
        locked: ev.locked,
        outriggers: reaction.forces.map((f) => ({ ...f })),
        reactionSumKN: reaction.sumKN,
        expectedTotalKN: reaction.expectedKN,
        catenaryClearanceM: Infinity,
      });
      const hud = root.querySelector('#hud') as HTMLElement;
      const cls = ev.level === 'danger' ? 'danger-text' : ev.level === 'warn' ? 'warn-text' : 'ok-text';
      hud.innerHTML = `
        <div class="k"><span>臂长</span><b>${fmt(fk.boomLength)} m</b></div>
        <div class="k"><span>半径</span><b>${fmt(fk.radius)} m</b></div>
        <div class="k"><span>吊钩高</span><b>${fmt(joint.hookHeight)} m</b></div>
        <div class="k"><span>吊载率</span><b class="${cls}">${ev.ratioPct.toFixed(1)}%</b></div>
        <div class="k"><span>反力合计</span><b>${fmt(reaction.sumKN, 1)} kN</b></div>
        <div class="k"><span>应承受</span><b>${fmt(reaction.expectedKN, 1)} kN</b></div>
        <div class="k"><span>平衡偏差</span><b>${fmt(reaction.balanceErrorKN, 4)} kN</b></div>`;
      const q = (root.querySelector('#chart-panel') as unknown as { _updateQuery?: () => void })._updateQuery;
      q?.();
    }
    renderer.end();
  };
  disposers.push(bindViewport(canvas, renderer, {}));

  root.querySelector('#add-car')?.addEventListener('click', () => undefined);
  renderList();
  renderParams();
  renderChart();
  loop();
  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
  void DEG;
  void updateData;
}
