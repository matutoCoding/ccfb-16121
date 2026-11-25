// 车型库页面: 敞/棚/罐/机车; 车体、转向架、车钩部件独立, 自重/重心/吊点可改; 罐车装载联动重心。
import { h, clear, button, label, numInput, select, table } from '../dom';
import { state, saveCar, deleteCar, uid } from '../store';
import { Viewport } from '../viewport';
import { buildCar } from '../../render/sceneBuilder';
import { tankCarMassAndCog } from '../../core/rigging';
import { deg2rad } from '../../core/geometry';
import type { CarType, TankLoad } from '../../core/types';

export async function renderCarLibrary(root: HTMLElement): Promise<void> {
  clear(root);
  let selectedId = state.cars[0]?.id ?? '';
  let viewport: Viewport | null = null;

  const layout = h('div', { class: 'page-layout' });
  const left = h('div', { class: 'panel' });
  const center = h('div', { class: 'panel canvas-panel' });
  const right = h('div', { class: 'panel wide' });
  layout.append(left, center, right);
  root.append(h('h2', {}, '车型库'), layout);

  const canvas = h('canvas', { id: 'car-canvas' }) as HTMLCanvasElement;
  center.append(canvas);

  function current(): CarType | undefined {
    return state.cars.find((c) => c.id === selectedId);
  }

  function rebuild3D(): void {
    if (!viewport) return;
    const car = current();
    if (!car) return;
    viewport.renderer.clearNodes();
    buildCar(viewport.renderer, car, [0, 1.2, 0], [0, 0, 0], 1);
  }

  function renderLeft(): void {
    clear(left);
    left.append(
      h('h3', {}, '车型列表'),
      ...state.cars.map((c) => h('div', {
        class: 'list-item' + (c.id === selectedId ? ' active' : ''),
        onclick: () => { selectedId = c.id; renderAll(); },
      }, h('span', {}, c.name), h('small', {}, typeLabel(c.bodyType)))),
      button('+ 新增车型', () => {
        const car: CarType = {
          id: uid('car'), name: '自定义车型', bodyType: 'open',
          length: 14, width: 3.1, height: 3.3, bogieSpacing: 8.7,
          parts: [
            { id: 'body', name: '车体', kind: 'body', mass: 18, cog: [0, 1.7, 0], halfSize: [6.7, 1.4, 1.5], origin: [0, 1.1, 0] },
            { id: 'bogie1', name: '前转向架', kind: 'bogie', mass: 2.4, cog: [-4.35, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [-4.35, 0, 0] },
            { id: 'bogie2', name: '后转向架', kind: 'bogie', mass: 2.4, cog: [4.35, 0.45, 0], halfSize: [1.1, 0.45, 1.1], origin: [4.35, 0, 0] },
            { id: 'coupler1', name: '前车钩', kind: 'coupler', mass: 0.35, cog: [-7.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [-7.1, 0, 0] },
            { id: 'coupler2', name: '后车钩', kind: 'coupler', mass: 0.35, cog: [7.1, 0.85, 0], halfSize: [0.4, 0.2, 0.2], origin: [7.1, 0, 0] },
          ],
          liftPoints: [
            { id: 'lp-fl', name: '前左吊点', offset: [-6, 1.3, -1.2] },
            { id: 'lp-fr', name: '前右吊点', offset: [-6, 1.3, 1.2] },
            { id: 'lp-rl', name: '后左吊点', offset: [6, 1.3, -1.2] },
            { id: 'lp-rr', name: '后右吊点', offset: [6, 1.3, 1.2] },
          ],
        };
        state.cars.push(car);
        selectedId = car.id;
        renderAll();
      }, 'primary'),
    );
  }

  function renderRight(): void {
    clear(right);
    const car = current();
    if (!car) { right.append(h('p', {}, '请选择车型')); return; }
    const edit = (mut: (c: CarType) => void) => {
      mut(car);
      void saveCar(car);
      rebuild3D();
    };

    right.append(h('h3', {}, '车辆参数'));
    const head = h('div', { class: 'form-grid' },
      label('名称', h('input', { value: car.name, oninput: (e) => edit((c) => { c.name = (e.target as HTMLInputElement).value; }) })),
      label('类型', select([
        { value: 'open', text: '敞车' }, { value: 'covered', text: '棚车' },
        { value: 'tank', text: '罐车' }, { value: 'locomotive', text: '机车' },
      ], car.bodyType, (v) => edit((c) => { c.bodyType = v as CarType['bodyType']; }))),
      label('车长 m', numInput(car.length, 0.1, (v) => edit((c) => { c.length = v; }))),
      label('车宽 m', numInput(car.width, 0.05, (v) => edit((c) => { c.width = v; }))),
      label('车高 m', numInput(car.height, 0.05, (v) => edit((c) => { c.height = v; }))),
      label('转向架中心距 m', numInput(car.bogieSpacing, 0.1, (v) => edit((c) => { c.bogieSpacing = v; }))),
    );
    right.append(head);

    // 罐车装载
    if (car.bodyType === 'tank') {
      const info = tankCarMassAndCog(car);
      right.append(h('h4', {}, '罐车装载 (重心随装载变化)'),
        label('装载状态', select([
          { value: 'empty', text: '空车' }, { value: 'half', text: '半载' }, { value: 'full', text: '满载' },
        ], car.tankLoad ?? 'empty', (v) => {
          edit((c) => { c.tankLoad = v as TankLoad; });
          renderRight();
        })),
        h('p', { class: 'hint' }, `当前总质量 ${info.mass.toFixed(1)} t, 重心高 ${info.cogY.toFixed(2)} m`),
      );
    }

    // 部件表
    right.append(h('h4', {}, '独立部件 (自重 / 重心 / 外形)'));
    const partRows = car.parts.map((p) => [
      p.name,
      `${p.mass} t`,
      `(${p.cog.map((x) => x.toFixed(2)).join(', ')})`,
      `(${p.halfSize.map((x) => x.toFixed(2)).join(', ')})`,
    ]);
    right.append(table(['部件', '自重', '重心(x,y,z)', '半尺寸(x,y,z)'], partRows));

    car.parts.forEach((p) => {
      const box = h('div', { class: 'sub-form' }, h('strong', {}, p.name));
      box.append(label('自重 t', numInput(p.mass, 0.1, (v) => edit((c) => { const t = c.parts.find((q) => q.id === p.id)!; t.mass = v; }))));
      (['x', 'y', 'z'] as const).forEach((axis, ai) => {
        box.append(label(`重心 ${axis} m`, numInput(p.cog[ai], 0.05, (v) => edit((c) => {
          c.parts.find((q) => q.id === p.id)!.cog[ai] = v;
        }))));
      });
      right.append(box);
    });

    // 吊点
    right.append(h('h4', {}, '吊点位置 (相对车体坐标)'));
    car.liftPoints.forEach((lp) => {
      const box = h('div', { class: 'sub-form' }, h('strong', {}, lp.name));
      (['x', 'y', 'z'] as const).forEach((axis, ai) => {
        box.append(label(`${axis} m`, numInput(lp.offset[ai], 0.05, (v) => edit((c) => {
          c.liftPoints.find((q) => q.id === lp.id)!.offset[ai] = v;
        }))));
      });
      right.append(box);
    });

    const total = car.parts.reduce((s, p) => s + p.mass, 0);
    right.append(
      h('p', { class: 'hint' }, `部件自重合计 ${total.toFixed(2)} t (罐车货物另计)`),
      !car.builtIn ? button('删除该车型', () => { void deleteCar(car.id).then(() => { selectedId = state.cars[0]?.id ?? ''; renderAll(); }); }, 'danger') : h('p', { class: 'hint' }, '内置车型不可删除, 可直接修改参数'),
    );
  }

  function renderAll(): void {
    renderLeft();
    renderRight();
    rebuild3D();
  }

  viewport = new Viewport(canvas, rebuild3D);
  viewport.renderer.camera.target = [0, 1.5, 0];
  viewport.renderer.camera.distance = 20;
  renderAll();
  void deg2rad;
}

function typeLabel(t: string): string {
  return { open: '敞车', covered: '棚车', tank: '罐车', locomotive: '机车' }[t] ?? t;
}
