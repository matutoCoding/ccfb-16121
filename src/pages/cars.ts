import type { CarModel, RigidPart, TankLoad } from '../types';
import { getState, updateData } from '../state';
import { saveItem } from '../services/repository';
import { Renderer } from '../render/renderer';
import { onUnmount, bindViewport, clear, el, fmt, num, toast } from '../render/viewport';
import { carCogLocal, carTotalMass } from '../dynamics/statics';
import { mat4Compose, mat4TransformPoint, mat4Translation } from '../core/mat4';
import { Renderer as _R } from '../render/renderer';
import type { DerailedCar } from '../types';

const KIND_LABEL: Record<CarModel['kind'], string> = {
  open: '敞车',
  covered: '棚车',
  tank: '罐车',
  locomotive: '机车',
};

export function mountCarsPage(root: HTMLElement): void {
  const state = getState();
  root.innerHTML = `
    <div class="sidebar">
      <div class="panel">
        <h3>车型列表 <button class="btn small" id="add-car">新建车型</button></h3>
        <div id="car-list"></div>
      </div>
      <div class="panel" id="editor"></div>
    </div>
    <div class="stage"><canvas></canvas></div>`;

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  let selectedId = state.selectedCarId ?? state.data.carModels[0]?.id;
  let raf = 0;
  const disposers: (() => void)[] = [];

  const previewCar = (): DerailedCar => {
    const car = current();
    return car
      ? { id: 'preview', carModelId: car.id, position: [0, 0.5, 0], rotationDeg: [0, 0, 0], bogiesDetached: false }
      : { id: 'preview', carModelId: '', position: [0, 0.5, 0], rotationDeg: [0, 0, 0], bogiesDetached: false };
  };

  const current = (): CarModel | undefined => getState().data.carModels.find((c) => c.id === selectedId);

  const renderList = (): void => {
    const list = root.querySelector('#car-list') as HTMLElement;
    clear(list);
    for (const car of getState().data.carModels) {
      const item = el('div', `list-item ${car.id === selectedId ? 'selected' : ''}`);
      item.innerHTML = `<div class="title">${car.name}</div><div class="sub">${KIND_LABEL[car.kind]} · 总重 ${carTotalMass(car).toFixed(1)}t · ${car.liftPoints.length} 个吊点</div>`;
      item.onclick = () => {
        selectedId = car.id;
        renderList();
        renderEditor();
      };
      list.appendChild(item);
    }
  };

  const partEditor = (part: RigidPart, onChange: () => void): HTMLElement => {
    const box = el('div');
    box.innerHTML = `<h4>${part.name}（质量 ${part.massT.toFixed(1)}t）</h4>`;
    const fields: [keyof RigidPart, string][] = [
      ['massT', '质量(t)'],
    ];
    for (const [key, label] of fields) {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>${label}</span>`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.1';
      inp.value = String(part[key] as number);
      inp.onchange = () => {
        (part[key] as number) = num(inp.value, part[key] as number);
        persist();
        onChange();
      };
      wrap.appendChild(inp);
      box.appendChild(wrap);
    }
    // 重心三坐标
    const cog = el('div', 'row');
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      const wrap = el('label', 'field');
      wrap.innerHTML = `<span>重心${axis.toUpperCase()}(m)</span>`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.05';
      inp.value = part.cogLocal[i].toFixed(2);
      inp.onchange = () => {
        part.cogLocal[i] = num(inp.value, part.cogLocal[i]);
        persist();
        onChange();
      };
      wrap.appendChild(inp);
      cog.appendChild(wrap);
    });
    box.appendChild(cog);
    return box;
  };

  const renderEditor = (): void => {
    const ed = root.querySelector('#editor') as HTMLElement;
    clear(ed);
    const car = current();
    if (!car) return;
    const head = el('h3');
    head.textContent = `${car.name} · 部件参数`;
    ed.appendChild(head);

    // 总质量与重心速览
    const summary = el('div', 'panel');
    const cog = carCogLocal(car);
    summary.innerHTML = `
      <h4>整车核算</h4>
      <div class="muted">总质量：<b class="mono">${carTotalMass(car).toFixed(2)} t</b></div>
      <div class="muted">重心（局部）：<b class="mono">(${cog.map((v) => v.toFixed(2)).join(', ')}) m</b></div>
      <div class="muted">定距 ${car.bogieSpacing}m · 轨距 ${car.gauge}m · 轮径 ${car.wheelDiameter}m</div>`;
    ed.appendChild(summary);

    ed.appendChild(partEditor(car.body, () => {
      renderEditor();
      renderList();
    }));
    for (const b of car.bogies) ed.appendChild(partEditor(b, renderEditor));
    for (const c of car.couplers) ed.appendChild(partEditor(c, renderEditor));

    // 吊点编辑
    const lpPanel = el('div');
    lpPanel.innerHTML = '<h4>吊点位置（局部坐标 m）</h4>';
    for (const lp of car.liftPoints) {
      const row = el('div', 'row');
      row.title = lp.name;
      (['x', 'y', 'z'] as const).forEach((axis, i) => {
        const wrap = el('label', 'field');
        wrap.innerHTML = `<span>${lp.name} ${axis.toUpperCase()}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.05';
        inp.value = lp.position[i].toFixed(2);
        inp.onchange = () => {
          lp.position[i] = num(inp.value, lp.position[i]);
          persist();
        };
        wrap.appendChild(inp);
        row.appendChild(wrap);
      });
      lpPanel.appendChild(row);
    }
    ed.appendChild(lpPanel);

    // 罐车装载档
    if (car.kind === 'tank' && car.tankLoads) {
      const tank = el('div');
      tank.innerHTML = '<h4>装载状态（重心随液面移动）</h4>';
      const sel = document.createElement('select');
      (['empty', 'half', 'full'] as TankLoad[]).forEach((ld) => {
        const opt = document.createElement('option');
        opt.value = ld;
        opt.textContent = ld === 'empty' ? '空车' : ld === 'half' ? '半载' : '满载';
        opt.selected = car.tankLoad === ld;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        car.tankLoad = sel.value as TankLoad;
        persist();
        renderEditor();
        renderList();
      };
      tank.appendChild(sel);
      const info = car.tankLoads[car.tankLoad ?? 'full'];
      const note = el('div', 'muted');
      note.style.marginTop = '6px';
      note.innerHTML = `该档位总重 <b>${info.totalMassT.toFixed(1)}t</b>，重心高度偏移 <b>${info.cogShiftY.toFixed(2)}m</b>`;
      tank.appendChild(note);
      ed.appendChild(tank);
    }

    const del = el('button', 'btn danger');
    del.textContent = '删除该车型';
    del.style.marginTop = '10px';
    del.onclick = async () => {
      const data = getState().data;
      updateData({ carModels: data.carModels.filter((c) => c.id !== car.id) });
      selectedId = getState().data.carModels[0]?.id ?? null;
      renderList();
      renderEditor();
      toast('车型已删除');
    };
    ed.appendChild(del);
  };

  const persist = (): void => {
    const car = current();
    if (!car) return;
    void saveItem('carModels', car);
  };

  root.querySelector('#add-car')!.addEventListener('click', async () => {
    const base = getState().data.carModels[0];
    if (!base) return;
    const copy: CarModel = structuredClone(base);
    copy.id = `car-${Date.now().toString(36)}`;
    copy.name = `自定义车型 ${getState().data.carModels.length + 1}`;
    updateData({ carModels: [...getState().data.carModels, copy] });
    await saveItem('carModels', copy);
    selectedId = copy.id;
    renderList();
    renderEditor();
  });

  // 渲染循环
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    renderer.begin();
    const car = current();
    if (car) {
      renderer.drawCar(car, previewCar(), true);
      // 重心标记
      const dc = previewCar();
      const cogWorld = mat4TransformPoint(
        mat4Compose(dc.position, [0, 0, 0]),
        carCogLocal(car),
      );
      renderer.drawSphere(mat4Translation(cogWorld[0], cogWorld[1], cogWorld[2]), 0.25, [0.95, 0.3, 0.9]);
    }
    renderer.end();
  };
  disposers.push(bindViewport(canvas, renderer, {}));
  renderList();
  renderEditor();
  loop();

  onUnmount(root, () => {
    cancelAnimationFrame(raf);
    disposers.forEach((d) => d());
  });
  void _R;
  void fmt;
}
