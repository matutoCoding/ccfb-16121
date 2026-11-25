import type { FrameSnapshot } from '../types';
import { getState } from '../state';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, fmt } from '../render/viewport';
import { FIXED_DT } from '../dynamics/engine';
import { mat4Translation } from '../core/mat4';

export function mountPlaybackPage(root: HTMLElement): void {
  const state = getState();
  root.innerHTML = `
    <div class="sidebar wide">
      <div class="panel">
        <h3>危险帧清单 <span class="muted" id="danger-count"></span></h3>
        <div class="hazard-list" id="danger-list"></div>
      </div>
      <div class="panel">
        <h3>本帧数据</h3>
        <div id="frame-data" style="max-height:42vh;overflow-y:auto"></div>
      </div>
    </div>
    <div class="stage"><canvas></canvas>
      <div class="hud right" id="hud"></div>
      <div class="timeline">
        <div class="steps" id="step-chips"></div>
        <input type="range" id="scrub" min="0" max="0" value="0" step="1">
        <div class="controls">
          <button class="btn small" id="play">▶ 播放</button>
          <button class="btn ghost small" id="first">⏮ 首帧</button>
          <button class="btn ghost small" id="prev">◀ 上一危险帧</button>
          <button class="btn ghost small" id="next">下一危险帧 ▶</button>
          <span class="muted mono" id="time-label">0.0s</span>
          <label class="field" style="margin:0;flex:0 0 200px"><span>落轨对轨细看（放大轮对区域）</span>
            <input type="range" id="zoom-rail" min="0" max="1" step="0.01" value="0">
          </label>
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const sim = state.lastSimulation;
  const plan = state.data.plans.find((p) => p.id === sim?.planId) ?? state.data.plans[0];
  const scene = state.data.scenes.find((s) => s.id === plan?.sceneId);
  const frames: FrameSnapshot[] = sim?.frames ?? [];
  let frameIdx = 0;
  let playing = false;
  let raf = 0;
  let lastTs = 0;
  let railZoom = 0;
  const disposers: (() => void)[] = [];

  if (!sim || !frames.length) {
    (root.querySelector('#danger-list') as HTMLElement).innerHTML =
      '<div class="muted">尚无推演结果。请先到「吊复方案」页运行推演。</div>';
  }

  const scrub = root.querySelector('#scrub') as HTMLInputElement;
  scrub.max = String(Math.max(0, frames.length - 1));

  const dangers = sim?.dangers ?? [];
  const dangerFrames = [...new Set(dangers.map((d) => d.frameIndex))].sort((a, b) => a - b);

  const renderDangerList = (): void => {
    const list = root.querySelector('#danger-list') as HTMLElement;
    clear(list);
    (root.querySelector('#danger-count') as HTMLElement).textContent = `（${dangers.length} 条）`;
    for (const d of dangers) {
      const item = el('div', `item ${d.severity}`);
      item.innerHTML = `<span class="tag ${d.severity === 'danger' ? 'danger' : 'warn'}">${d.severity === 'danger' ? '危险' : '警告'}</span>
        <span>t=${d.t.toFixed(1)}s（帧${d.frameIndex}）：${d.reason}</span>`;
      item.onclick = () => {
        frameIdx = d.frameIndex;
        scrub.value = String(frameIdx);
        renderFrameData();
      };
      list.appendChild(item);
    }
  };

  const renderFrameData = (): void => {
    const box = root.querySelector('#frame-data') as HTMLElement;
    const f = frames[frameIdx];
    if (!f) {
      box.innerHTML = '<div class="muted">无数据</div>';
      return;
    }
    let html = `<div class="muted" style="margin-bottom:6px">帧 ${frameIdx} / ${frames.length - 1} · 仿真时刻 ${f.t.toFixed(1)}s</div>`;
    for (const c of f.cranes) {
      const cls = c.loadRatioPct > 100 ? 'danger' : c.loadRatioPct > 90 ? 'warn' : 'ok';
      html += `<h4>${c.placementId}</h4>
        <table>
          <tr><th>指标</th><th>数值</th></tr>
          <tr><td>回转角</td><td class="num">${fmt(c.slewDeg, 1)}°</td></tr>
          <tr><td>变幅角</td><td class="num">${fmt(c.luffDeg, 1)}°</td></tr>
          <tr><td>臂长</td><td class="num">${fmt(c.boomLength, 2)} m</td></tr>
          <tr><td>工作半径</td><td class="num">${fmt(c.radius, 2)} m</td></tr>
          <tr><td>吊钩高度</td><td class="num">${fmt(c.hookHeight, 2)} m</td></tr>
          <tr><td>实际吊重</td><td class="num">${fmt(c.liftedMassT, 2)} t</td></tr>
          <tr><td>额定起重量</td><td class="num">${fmt(c.ratedCapacityT, 2)} t</td></tr>
          <tr><td>吊载率</td><td class="num ${cls}-text">${fmt(c.loadRatioPct, 1)}%${c.locked ? ' 锁定' : ''}</td></tr>
          <tr><td>接触网净空</td><td class="num">${Number.isFinite(c.catenaryClearanceM) ? fmt(c.catenaryClearanceM, 2) + ' m' : '—'}</td></tr>
        </table>
        <h4>四条支腿反力/比压</h4>
        <table><tr><th>支腿</th><th>反力(kN)</th><th>比压(kPa)</th><th>垫木</th><th>状态</th></tr>`;
      c.outriggers.forEach((o, i) => {
        html += `<tr><td>${['左前', '右前', '左后', '右后'][i]}</td>
          <td class="num">${fmt(o.reactionKN, 1)}</td>
          <td class="num">${fmt(o.bearingKPa, 1)}</td>
          <td class="num">${o.woodLayers}</td>
          <td>${o.overloaded ? '<span class="tag danger">超载</span>' : '<span class="tag ok">正常</span>'}</td></tr>`;
      });
      html += `<tr><td><b>合计</b></td><td class="num"><b>${fmt(c.reactionSumKN, 1)}</b></td>
        <td colspan="3" class="muted">应承受 ${fmt(c.expectedTotalKN, 1)} kN · 偏差 ${fmt(c.reactionSumKN - c.expectedTotalKN, 4)}</td></tr></table>`;
    }
    if (f.slings.length) {
      html += '<h4>吊索</h4><table><tr><th>起重机</th><th>夹角°</th><th>绳张力 kN</th><th>干涉</th></tr>';
      for (const s of f.slings) {
        html += `<tr><td>${s.placementId}</td><td class="num ${s.angleWarning ? 'warn-text' : ''}">${fmt(s.includedAngleDeg, 1)}</td>
          <td class="num">${fmt(s.ropeTensionKN, 1)}</td><td>${s.bodyInterference ? '<span class="tag danger">是</span>' : '否'}</td></tr>`;
      }
      html += '</table>';
    }
    if (f.hazards.length) {
      html += '<h4>本帧告警</h4>' + f.hazards.map((h) => `<div class="tag ${h.startsWith('【危险】') ? 'danger' : 'warn'}" style="margin:2px 0;display:block">${h}</div>`).join('');
    }
    box.innerHTML = html;
    (root.querySelector('#time-label') as HTMLElement).textContent = `${f.t.toFixed(1)}s`;
  };

  const renderStepChips = (): void => {
    const chips = root.querySelector('#step-chips') as HTMLElement;
    clear(chips);
    if (!plan) return;
    // 每步大致起始帧 = 累计动作帧数估算（按 sim 帧时间均分）
    const total = frames.length ? frames[frames.length - 1].t : 0;
    let acc = 0;
    plan.steps.forEach((step, i) => {
      const chip = el('span', 'step-chip', `${i + 1}. ${step.name}`);
      const ratio = total ? acc / total : 0;
      chip.onclick = () => {
        frameIdx = Math.round(ratio * (frames.length - 1));
        scrub.value = String(frameIdx);
        renderFrameData();
      };
      chips.appendChild(chip);
      acc += total / plan.steps.length;
    });
  };

  const drawFrame = (): void => {
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    if (scene) renderer.drawScene(scene);
    const f = frames[frameIdx];
    if (!f || !plan) {
      renderer.end();
      return;
    }
    // 车辆
    for (const csnap of f.cars) {
      const dc = plan.derailedCars.find((d) => d.id === csnap.carId);
      const model = state.data.carModels.find((c) => c.id === dc?.carModelId);
      if (dc && model) {
        const moved = { ...dc, position: csnap.position, rotationDeg: csnap.rotationDeg };
        renderer.drawCar(model, moved, true);
      }
    }
    // 起重机（用快照反推关节直接重画 FK，保证与动画一致）
    for (const csnap of f.cranes) {
      const pl = plan.cranePlacements.find((p) => p.id === csnap.placementId);
      const m = state.data.cranes.find((c) => c.id === pl?.craneModelId);
      if (!pl || !m) continue;
      // 从快照重建关节（extensions 由当前臂长与节长反推比例）
      const ratio = (csnap.boomLength - m.boomSections[0].minLen) /
        Math.max(0.1, m.boomSections.reduce((s, x) => s + (x.maxLen - x.minLen), 0));
      const joint = {
        slewDeg: csnap.slewDeg,
        luffDeg: csnap.luffDeg,
        extensions: m.boomSections.map((s, i) => (i === 0 ? 0 : (s.maxLen - s.minLen) * Math.max(0, Math.min(1, ratio)))),
        hookHeight: csnap.hookHeight,
      };
      renderer.drawCrane(m, pl, joint, csnap);
      // 吊索
      const slings = f.slings.filter((s) => s.placementId === pl.id);
      for (const s of slings) {
        const dc = plan.derailedCars.find((d) => d.id === s.carId);
        const carModel = state.data.carModels.find((c) => c.id === dc?.carModelId);
        const lp = carModel?.liftPoints.find((x) => x.id === s.liftPointId);
        if (dc && carModel && lp) {
          const moved = f.cars.find((x) => x.carId === dc.id)!;
          const wp = (() => {
            // 用当前车体位置近似吊点世界坐标
            const m4 = (window as unknown as { __noop?: unknown });
            void m4;
            return [moved.position[0] + lp.position[0], moved.position[1] + lp.position[1], moved.position[2] + lp.position[2]] as [number, number, number];
          })();
          renderer.drawSlings(csnap.hookPosition, [wp], s.bodyInterference);
        }
      }
    }
    // 落轨对轨细看
    if (railZoom > 0 && f.cars[0]) {
      const car = f.cars[0];
      renderer.drawRailAlignment(
        { id: '', carModelId: '', position: car.position, rotationDeg: car.rotationDeg, bogiesDetached: false },
        1.435,
        Math.max(0, scene?.embankmentHeight ?? 0),
      );
      const target: [number, number, number] = [car.position[0], car.position[1] + 0.5, car.position[2]];
      renderer.camera.target = target;
      renderer.camera.distance = 22 - railZoom * 17;
      renderer.camera.pitchDeg = 45;
    }
    renderer.end();
    // HUD
    (root.querySelector('#hud') as HTMLElement).innerHTML = f.hazards.length
      ? f.hazards.map((h) => `<div class="${h.startsWith('【危险】') ? 'danger-text' : 'warn-text'}">● ${h}</div>`).join('')
      : '<div class="ok-text">本帧无告警</div>';
  };

  // 交互
  scrub.oninput = () => {
    frameIdx = num(scrub.value);
    renderFrameData();
  };
  const playBtn = root.querySelector('#play') as HTMLButtonElement;
  playBtn.onclick = () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  };
  root.querySelector('#first')!.addEventListener('click', () => {
    frameIdx = 0;
    scrub.value = '0';
    renderFrameData();
  });
  root.querySelector('#prev')!.addEventListener('click', () => {
    const prev = dangerFrames.filter((x) => x < frameIdx).pop();
    if (prev !== undefined) {
      frameIdx = prev;
      scrub.value = String(prev);
      renderFrameData();
    }
  });
  root.querySelector('#next')!.addEventListener('click', () => {
    const next = dangerFrames.find((x) => x > frameIdx);
    if (next !== undefined) {
      frameIdx = next;
      scrub.value = String(next);
      renderFrameData();
    }
  });
  (root.querySelector('#zoom-rail') as HTMLInputElement).oninput = (e) => {
    railZoom = num((e.target as HTMLInputElement).value);
  };

  const tick = (ts: number): void => {
    raf = requestAnimationFrame(tick);
    if (playing && ts - lastTs > FIXED_DT * 1000) {
      lastTs = ts;
      frameIdx = Math.min(frames.length - 1, frameIdx + 1);
      scrub.value = String(frameIdx);
      renderFrameData();
      if (frameIdx >= frames.length - 1) {
        playing = false;
        playBtn.textContent = '▶ 播放';
      }
    }
    drawFrame();
  };

  disposers.push(bindViewport(canvas, renderer, {}));
  renderDangerList();
  renderFrameData();
  renderStepChips();
  tick(0);
  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
  void mat4Translation;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
