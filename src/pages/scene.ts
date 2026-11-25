import type { AccidentScene, DerailedCar } from '../types';
import { getState, updateData } from '../state';
import { saveItem } from '../services/repository';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, num, toast } from '../render/viewport';
import { uid } from '../services/repository';
import { DEG } from '../core/mathutil';
import { mat4Translation } from '../core/mat4';

export function mountScenePage(root: HTMLElement): void {
  const state = getState();
  root.innerHTML = `
    <div class="sidebar wide">
      <div class="panel">
        <h3>现场列表 <button class="btn small" id="add-scene">新建现场</button></h3>
        <div id="scene-list"></div>
      </div>
      <div class="panel" id="scene-params"></div>
      <div class="panel" id="car-params"></div>
    </div>
    <div class="stage"><canvas></canvas>
      <div class="hud right" id="hint">
        <b>操作说明</b>
        <div class="muted" style="margin-top:6px">左键拖动：旋转视角<br>右键拖动：平移视角<br>滚轮：缩放<br>勾选「布置模式」后左键拖动：移动脱轨车</div>
      </div>
    </div>`;

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  let selectedSceneId = state.selectedSceneId ?? state.data.scenes[0]?.id;
  let cars: DerailedCar[] = [];
  let pickMode = false;
  let raf = 0;
  const disposers: (() => void)[] = [];

  const currentScene = (): AccidentScene | undefined => getState().data.scenes.find((s) => s.id === selectedSceneId);

  const ensureCars = (): void => {
    if (!cars.length && getState().data.carModels.length) {
      cars = [
        {
          id: uid('dc'),
          carModelId: getState().data.carModels[0].id,
          position: [0.8, 0.6, 0],
          rotationDeg: [0, 8, 12],
          bogiesDetached: false,
        },
      ];
    }
  };

  const renderList = (): void => {
    const list = root.querySelector('#scene-list') as HTMLElement;
    clear(list);
    for (const sc of getState().data.scenes) {
      const item = el('div', `list-item ${sc.id === selectedSceneId ? 'selected' : ''}`);
      item.innerHTML = `<div class="title">${sc.name}</div><div class="sub">路堤 ${sc.embankmentHeight}m · 路肩 ${sc.shoulderWidth}m · 承载力 ${sc.allowableBearingKPa}kPa</div>`;
      item.onclick = () => {
        selectedSceneId = sc.id;
        cars = [];
        ensureCars();
        renderList();
        renderSceneParams();
        renderCarParams();
      };
      list.appendChild(item);
    }
  };

  const renderSceneParams = (): void => {
    const panel = root.querySelector('#scene-params') as HTMLElement;
    clear(panel);
    const sc = currentScene();
    if (!sc) return;
    panel.innerHTML = '<h3>线路与路基参数</h3>';
    const fields: [keyof AccidentScene, string, number][] = [
      ['lineHeadingDeg', '线路走向(°)', 1],
      ['curveRadius', '曲线半径(m，0=直线)', 10],
      ['embankmentHeight', '路堤高度(m，负值为路堑)', 0.5],
      ['shoulderWidth', '路肩宽度(m)', 0.1],
      ['trackSpacing', '线间距(m)', 0.1],
      ['allowableBearingKPa', '路基容许承载力(kPa)', 5],
      ['poleSpacing', '接触网立柱间距(m)', 1],
    ];
    for (const [key, label, step] of fields) {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>${label}</span>`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.value = String(sc[key] as number);
      inp.onchange = () => {
        (sc[key] as number) = num(inp.value, sc[key] as number);
        void saveItem('scenes', sc);
      };
      wrap.appendChild(inp);
      panel.appendChild(wrap);
    }
    const del = el('button', 'btn danger small');
    del.textContent = '删除现场';
    del.onclick = () => {
      updateData({ scenes: getState().data.scenes.filter((x) => x.id !== sc.id) });
      selectedSceneId = getState().data.scenes[0]?.id ?? null;
      cars = [];
      ensureCars();
      renderList();
      renderSceneParams();
      renderCarParams();
    };
    panel.appendChild(del);
  };

  const renderCarParams = (): void => {
    const panel = root.querySelector('#car-params') as HTMLElement;
    clear(panel);
    ensureCars();
    const car = cars[0];
    if (!car) return;
    const carModel = getState().data.carModels.find((c) => c.id === car.carModelId);
    panel.innerHTML = '<h3>脱轨车辆布置</h3>';
    const sel = document.createElement('select');
    getState().data.carModels.forEach((cm) => {
      const opt = document.createElement('option');
      opt.value = cm.id;
      opt.textContent = cm.name;
      opt.selected = cm.id === car.carModelId;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      car.carModelId = sel.value;
    };
    panel.appendChild(sel);

    const posRows: [string, number][] = [
      ['X 横向(m)', car.position[0]],
      ['Y 高度(m)', car.position[1]],
      ['Z 纵向(m)', car.position[2]],
    ];
    posRows.forEach(([label, val], i) => {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>${label}</span>`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.1';
      inp.value = val.toFixed(2);
      inp.oninput = () => {
        car.position[i] = num(inp.value, car.position[i]);
      };
      wrap.appendChild(inp);
      panel.appendChild(wrap);
    });
    const rotRows: [string, number][] = [
      ['侧滚 roll(°) — 侧翻角度', car.rotationDeg[0]],
      ['航向 yaw(°)', car.rotationDeg[1]],
      ['俯仰 pitch(°)', car.rotationDeg[2]],
    ];
    rotRows.forEach(([label, val], i) => {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>${label}</span>`;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = i === 0 ? '-90' : '-45';
      inp.max = i === 0 ? '90' : '45';
      inp.step = '1';
      inp.value = String(val);
      const val2 = el('b', 'mono', val.toFixed(0) + '°');
      wrap.appendChild(val2);
      inp.oninput = () => {
        car.rotationDeg[i] = num(inp.value, car.rotationDeg[i]);
        val2.textContent = inp.value + '°';
      };
      wrap.appendChild(inp);
      panel.appendChild(wrap);
    });

    const check = el('label', 'field');
    check.innerHTML = `<span><input type="checkbox" ${pickMode ? 'checked' : ''}> 布置模式（视口中左键拖动车辆）</span>`;
    (check.querySelector('input') as HTMLInputElement).onchange = (e) => {
      pickMode = (e.target as HTMLInputElement).checked;
    };
    panel.appendChild(check);

    const detach = el('label', 'field');
    detach.innerHTML = `<span><input type="checkbox" ${car.bogiesDetached ? 'checked' : ''}> 转向架与车体分离（分体吊复）</span>`;
    (detach.querySelector('input') as HTMLInputElement).onchange = (e) => {
      car.bogiesDetached = (e.target as HTMLInputElement).checked;
      if (car.bogiesDetached && !car.bogiePositions?.length) {
        car.bogiePositions = [
          [car.position[0] + 1.5, 0.5, car.position[2] + 2],
          [car.position[0] - 1.5, 0.5, car.position[2] - 2],
        ];
      }
    };
    panel.appendChild(detach);
    void carModel;
  };

  root.querySelector('#add-scene')!.addEventListener('click', async () => {
    const base = getState().data.scenes[0];
    const copy: AccidentScene = structuredClone(base);
    copy.id = uid('scene');
    copy.name = `自定义现场 ${getState().data.scenes.length + 1}`;
    updateData({ scenes: [...getState().data.scenes, copy] });
    await saveItem('scenes', copy);
    selectedSceneId = copy.id;
    cars = [];
    ensureCars();
    renderList();
    renderSceneParams();
    renderCarParams();
    toast('已新建现场');
  });

  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    const sc = currentScene();
    if (sc) {
      renderer.drawScene(sc);
      ensureCars();
      for (const dc of cars) {
        const model = getState().data.carModels.find((c) => c.id === dc.carModelId);
        if (model) {
          renderer.drawCar(model, dc, true);
          if (dc.bogiesDetached && dc.bogiePositions) {
            for (const bp of dc.bogiePositions) {
              renderer.drawBox(mat4Translation(bp[0], bp[1], bp[2]), [2.4, 1.1, 2.2], [0.18, 0.18, 0.2]);
            }
          }
        }
      }
    }
    renderer.end();
  };

  disposers.push(
    bindViewport(canvas, renderer, {
      pickMode: () => pickMode,
      onDragGround: (world) => {
        if (!cars[0]) return;
        cars[0].position = [world[0], cars[0].position[1], world[2]];
      },
    }),
  );

  renderList();
  ensureCars();
  renderSceneParams();
  renderCarParams();
  void DEG;
  // 动态 import 不能在普通函数里 await，改为静态引用重写分离转向架绘制
  loop();
  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
}
