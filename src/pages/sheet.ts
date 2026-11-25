import { getState } from '../state';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, fmt, toast } from '../render/viewport';
import { FIXED_DT } from '../dynamics/engine';
import type { FrameSnapshot } from '../types';
import { outriggerLabel } from '../dynamics/crane';

export function mountSheetPage(root: HTMLElement): void {
  const state = getState();
  const sim = state.lastSimulation;
  const plan = state.data.plans.find((p) => p.id === sim?.planId) ?? state.data.plans[0];
  const scene = state.data.scenes.find((s) => s.id === plan?.sceneId);

  root.innerHTML = `
    <div class="sidebar">
      <div class="panel">
        <h3>方案单导出</h3>
        <div class="muted" style="margin-bottom:8px">包含：起重机站位图、分步动作表、支腿反力表、关键帧截图，可直接打印带去现场。</div>
        <button class="btn" id="print" style="width:100%;margin-bottom:8px">🖨 打印 / 另存 PDF</button>
        <button class="btn ghost" id="shot" style="width:100%;margin-bottom:8px">📷 截取当前视口为关键帧</button>
        <button class="btn ghost" id="auto-shots" style="width:100%">🎞 自动生成各步骤关键帧</button>
      </div>
      <div class="panel">
        <h3>已选关键帧</h3>
        <div id="shots" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>
    </div>
    <div class="stage">
      <canvas id="sheet-canvas"></canvas>
      <div class="print-sheet" id="print-sheet"></div>
    </div>`;

  const canvas = root.querySelector('#sheet-canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const frames: FrameSnapshot[] = sim?.frames ?? [];
  const shots: { title: string; dataUrl: string }[] = [];
  let raf = 0;
  const disposers: (() => void)[] = [];
  let previewFrame = Math.min(5, Math.max(0, frames.length - 1));

  const renderShots = (): void => {
    const box = root.querySelector('#shots') as HTMLElement;
    clear(box);
    if (!shots.length) {
      box.innerHTML = '<div class="muted">暂无截图</div>';
      return;
    }
    shots.forEach((s, i) => {
      const wrap = el('div');
      wrap.innerHTML = `<div class="muted" style="margin-bottom:3px">${i + 1}. ${s.title}</div>`;
      const img = document.createElement('img');
      img.src = s.dataUrl;
      img.style.width = '100%';
      img.style.borderRadius = '4px';
      img.style.border = '1px solid var(--border)';
      wrap.appendChild(img);
      const del = el('button', 'btn danger small', '移除');
      del.style.marginTop = '4px';
      del.onclick = () => {
        shots.splice(i, 1);
        renderShots();
      };
      wrap.appendChild(del);
      box.appendChild(wrap);
    });
  };

  const capture = (title: string): void => {
    const url = (renderer.gl.canvas as HTMLCanvasElement).toDataURL('image/png');
    shots.push({ title, dataUrl: url });
    renderShots();
  };

  const drawPreview = (): void => {
    raf = requestAnimationFrame(drawPreview);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    if (scene) renderer.drawScene(scene);
    if (!plan) return renderer.end();
    const f = frames[previewFrame];
    if (f) {
      for (const csnap of f.cranes) {
        const pl = plan.cranePlacements.find((p) => p.id === csnap.placementId);
        const m = state.data.cranes.find((c) => c.id === pl?.craneModelId);
        if (!pl || !m) continue;
        const ratio = (csnap.boomLength - m.boomSections[0].minLen) /
          Math.max(0.1, m.boomSections.reduce((s, x) => s + (x.maxLen - x.minLen), 0));
        renderer.drawCrane(
          m,
          pl,
          {
            slewDeg: csnap.slewDeg,
            luffDeg: csnap.luffDeg,
            extensions: m.boomSections.map((s, i) => (i === 0 ? 0 : (s.maxLen - s.minLen) * Math.max(0, Math.min(1, ratio)))),
            hookHeight: csnap.hookHeight,
          },
          csnap,
        );
      }
      for (const car of f.cars) {
        const dc = plan.derailedCars.find((d) => d.id === car.carId);
        const model = state.data.carModels.find((c) => c.id === dc?.carModelId);
        if (dc && model) renderer.drawCar(model, { ...dc, position: car.position, rotationDeg: car.rotationDeg }, true);
      }
    } else {
      // 无仿真结果时画站位布置
      for (const pl of plan.cranePlacements) {
        const m = state.data.cranes.find((c) => c.id === pl.craneModelId);
        if (m) {
          const j = { slewDeg: 0, luffDeg: 60, extensions: m.boomSections.map(() => 0), hookHeight: 2 };
          renderer.drawCrane(m, pl, j);
        }
      }
      for (const dc of plan.derailedCars) {
        const model = state.data.carModels.find((c) => c.id === dc.carModelId);
        if (model) renderer.drawCar(model, dc, true);
      }
    }
    renderer.end();
  };

  const buildPrintSheet = (): string => {
    if (!plan || !scene) return '<p>无方案数据</p>';
    const now = new Date();
    let html = `
      <style>
        body { color:#000; font-family:'Microsoft YaHei',sans-serif; }
        h1 { font-size:20px; text-align:center; margin:0 0 4px; }
        h2 { font-size:15px; border-left:4px solid #f29e1f; padding-left:8px; margin:18px 0 8px; }
        table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px; }
        th,td { border:1px solid #555; padding:5px 7px; text-align:left; }
        th { background:#eee; }
        .meta { color:#444; font-size:12px; text-align:center; margin-bottom:12px; }
        .shot img { max-width:100%; border:1px solid #888; margin:6px 0; }
        .warn-note { background:#fff7e0; border:1px solid #d9a400; padding:8px; font-size:12px; }
        .danger-note { background:#fde7e7; border:1px solid #c0392b; padding:8px; font-size:12px; }
      </style>
      <h1>铁路救援吊复方案单</h1>
      <div class="meta">方案：${plan.name} ｜ 现场：${scene.name} ｜ 编制：${'救援列车车间'} ｜ 时间：${now.toLocaleString('zh-CN')}</div>`;

    // 1. 站位图（首张截图或占位）
    html += '<h2>一、起重机站位图</h2>';
    if (shots[0]) html += `<div class="shot"><img src="${shots[0].dataUrl}"></div>`;
    html += '<table><tr><th>起重机</th><th>站位(x,y,z) m</th><th>航向°</th><th>支腿状态</th></tr>';
    for (const pl of plan.cranePlacements) {
      const m = state.data.cranes.find((c) => c.id === pl.craneModelId);
      html += `<tr><td>${m?.name ?? pl.id}</td><td>${pl.position.map((v) => v.toFixed(2)).join(', ')}</td><td>${pl.headingDeg}</td><td>${m?.loadCharts.find((c) => c.state === pl.chartState)?.label ?? pl.chartState}</td></tr>`;
    }
    html += '</table>';

    // 2. 分步动作表
    html += '<h2>二、分步动作表</h2><table><tr><th>步骤</th><th>名称</th><th>起重机</th><th>动作序列</th><th>挂钩</th></tr>';
    plan.steps.forEach((step, i) => {
      for (const pl of plan.cranePlacements) {
        const acts = step.actions[pl.id] ?? [];
        const actText = acts.map((a) => {
          const t = a.target;
          return `${a.type}→${Array.isArray(t) ? '[' + t.map((x) => x.toFixed(1)).join(',') + ']' : fmt(t, 1)}`;
        }).join('；') || '—';
        const rig = step.rigging?.filter((r) => r.placementId === pl.id).map((r) => r.liftPointId).join(',') ?? '';
        html += `<tr><td>${i + 1}</td><td>${step.name}</td><td>${pl.id}</td><td>${actText}</td><td>${rig}${step.unrigAfter ? '（末摘钩）' : ''}</td></tr>`;
      }
    });
    html += '</table>';

    // 3. 支腿反力表（取仿真中最大吊载率帧）
    html += '<h2>三、支腿反力与地面比压（最不利帧）</h2>';
    if (frames.length) {
      let worst = frames[0];
      for (const f of frames) for (const c of f.cranes) {
        const w = worst.cranes.find((x) => x.placementId === c.placementId);
        if (!w || c.loadRatioPct > w.loadRatioPct) worst = f;
      }
      html += `<div class="meta">最不利时刻 t=${worst.t.toFixed(1)}s（路基容许承载力 ${scene.allowableBearingKPa} kPa）</div>`;
      html += '<table><tr><th>起重机</th><th>支腿</th><th>位置(m)</th><th>垫木</th><th>反力(kN)</th><th>比压(kPa)</th><th>判定</th></tr>';
      for (const c of worst.cranes) {
        c.outriggers.forEach((o, i) => {
          html += `<tr><td>${c.placementId}</td><td>${outriggerLabel(i)}</td><td>${o.position[0].toFixed(1)}, ${o.position[2].toFixed(1)}</td>
            <td>${o.woodLayers} 层</td><td>${fmt(o.reactionKN, 1)}</td><td>${fmt(o.bearingKPa, 1)}</td>
            <td>${o.overloaded ? '<b style="color:#c0392b">超载</b>' : '正常'}</td></tr>`;
        });
        html += `<tr><td colspan="4"><b>反力合计 / 应承受</b></td><td><b>${fmt(c.reactionSumKN, 1)}</b></td><td colspan="2">${fmt(c.expectedTotalKN, 1)} kN</td></tr>`;
      }
      html += '</table>';
    } else {
      html += '<div class="warn-note">未运行推演，暂无反力数据。请先在方案页执行推演。</div>';
    }

    // 4. 危险提示
    if (sim?.dangers.length) {
      html += '<h2>四、危险帧提示</h2>';
      for (const d of sim.dangers.slice(0, 12)) {
        html += `<div class="${d.severity === 'danger' ? 'danger-note' : 'warn-note'}" style="margin-bottom:4px">t=${d.t.toFixed(1)}s（帧${d.frameIndex}）：${d.reason}</div>`;
      }
    }

    // 5. 关键帧截图
    if (shots.length) {
      html += '<h2>五、关键帧截图</h2>';
      shots.forEach((s, i) => {
        html += `<div class="shot"><div>图 ${i + 1}：${s.title}</div><img src="${s.dataUrl}"></div>`;
      });
    }
    html += `<div class="meta" style="margin-top:20px">本方案单由救援吊复方案推演系统生成，固定步长 ${FIXED_DT}s，运动学与受力计算经单元测试校核。</div>`;
    return html;
  };

  root.querySelector('#print')!.addEventListener('click', () => {
    const sheet = root.querySelector('#print-sheet') as HTMLElement;
    sheet.innerHTML = buildPrintSheet();
    // 等待图片解码
    setTimeout(() => window.print(), 300);
  });
  root.querySelector('#shot')!.addEventListener('click', () => {
    const f = frames[previewFrame];
    capture(`关键帧 t=${f ? f.t.toFixed(1) : '0.0'}s`);
  });
  root.querySelector('#auto-shots')!.addEventListener('click', async () => {
    if (!plan) return;
    if (!frames.length) return toast('请先运行推演');
    // 每个步骤取中间帧；每次切换后等两个 rAF，确保 WebGL 已把新画面上屏再抓图
    const waitTwoFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    for (let i = 0; i < plan.steps.length; i++) {
      previewFrame = Math.round(((i + 0.5) / plan.steps.length) * (frames.length - 1));
      await waitTwoFrames();
      capture(`步骤${i + 1}：${plan.steps[i].name}`);
    }
    toast(`已生成 ${plan.steps.length} 张关键帧`);
  });

  disposers.push(
    bindViewport(canvas, renderer, {
      onClickGround: () => undefined,
    }),
  );
  renderShots();
  drawPreview();
  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
}
