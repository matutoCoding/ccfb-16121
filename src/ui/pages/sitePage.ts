// 事故现场页面: 线路平面/路堤/路肩/接触网参数生成; 脱轨车位置与倾角可拖, 侧翻车可摆; 起重机站位。
import { h, clear, button, label, numInput, slider, select } from '../dom';
import { state, saveSite, saveScene, uid, deleteScene } from '../store';
import { Viewport } from '../viewport';
import { buildSite, buildCar, buildCrane } from '../../render/sceneBuilder';
import { computeOutriggerReactions } from '../../core/crane';
import { rad2deg, deg2rad } from '../../core/geometry';
import type { AccidentScene, SiteParams } from '../../core/types';

export async function renderSite(root: HTMLElement): Promise<void> {
  clear(root);
  let scene = state.scenes[0];
  let site = state.sites.find((s) => s.id === scene.siteId)!;
  let viewport: Viewport | null = null;
  let dragAxis: 'x' | 'z' | 'roll' = 'x';

  const layout = h('div', { class: 'page-layout' });
  const left = h('div', { class: 'panel' });
  const center = h('div', { class: 'panel canvas-panel' });
  const right = h('div', { class: 'panel wide' });
  layout.append(left, center, right);
  root.append(h('h2', {}, '事故现场'), layout);

  const canvas = h('canvas', { id: 'site-canvas' }) as HTMLCanvasElement;
  center.append(canvas);

  const model = state.cranes[0];
  const car = state.cars.find((c) => c.id === scene.cars[0].carTypeId)!;

  function persist(): void {
    void saveSite(site);
    void saveScene(scene);
  }

  function rebuild3D(): void {
    if (!viewport) return;
    viewport.renderer.clearNodes();
    buildSite(viewport.renderer, site);
    buildCar(viewport.renderer, car, scene.cars[0].position, scene.cars[0].rotation, 1);
    const pose = scene.cranePoses[0];
    const reactions = computeOutriggerReactions(model, pose, 25, site.allowableBearing);
    buildCrane(viewport.renderer, model, pose, reactions.map((r) => ({ overloaded: r.overloaded, lifted: r.lifted })));
  }

  function renderRight(): void {
    clear(right);
    const dc = scene.cars[0];
    right.append(h('h3', {}, '脱轨车辆 (可在画布上拖拽)'));
    const editCar = (mut: () => void) => { mut(); persist(); rebuild3D(); renderRight(); };

    right.append(
      label('拖拽模式', select([
        { value: 'x', text: '沿线路纵向 X' }, { value: 'z', text: '横向 Z' }, { value: 'roll', text: '侧倾角 (侧翻摆放)' },
      ], dragAxis, (v) => { dragAxis = v as typeof dragAxis; })),
      label('位置 X m', numInput(dc.position[0], 0.1, (v) => editCar(() => { dc.position[0] = v; }))),
      label('位置 Y (离地) m', numInput(dc.position[1], 0.05, (v) => editCar(() => { dc.position[1] = v; }), 0, 8)),
      label('位置 Z m', numInput(dc.position[2], 0.1, (v) => editCar(() => { dc.position[2] = v; }))),
      label(`侧倾角 ${rad2deg(dc.rotation[2]).toFixed(1)}° (0~90° 可摆侧翻)`,
        slider(rad2deg(dc.rotation[2]), 0, 90, 1, (v) => editCar(() => { dc.rotation[2] = deg2rad(v); }))),
      label(`俯仰角 ${rad2deg(dc.rotation[0]).toFixed(1)}°`,
        slider(rad2deg(dc.rotation[0]), -30, 30, 1, (v) => editCar(() => { dc.rotation[0] = deg2rad(v); }))),
      label(`偏航角 ${rad2deg(dc.rotation[1]).toFixed(1)}°`,
        slider(rad2deg(dc.rotation[1]), -45, 45, 1, (v) => editCar(() => { dc.rotation[1] = deg2rad(v); }))),
      h('label', { class: 'field' }, h('span', {}, '转向架与车体分离吊'),
        h('input', {
          type: 'checkbox', ...(dc.bogieDetached ? { checked: true } : {}),
          onchange: (e) => editCar(() => { dc.bogieDetached = (e.target as HTMLInputElement).checked; }),
        })),
    );

    const pose = scene.cranePoses[0];
    right.append(h('h4', {}, '起重机站位'));
    const editCrane = (mut: () => void) => { mut(); persist(); rebuild3D(); renderRight(); };
    right.append(
      label('站位 X m', numInput(pose.position[0], 0.1, (v) => editCrane(() => { pose.position[0] = v; }))),
      label('站位 Z m', numInput(pose.position[2], 0.1, (v) => editCrane(() => { pose.position[2] = v; }))),
      label(`朝向 ${rad2deg(pose.heading).toFixed(0)}°`,
        slider(rad2deg(pose.heading), -180, 180, 5, (v) => editCrane(() => { pose.heading = deg2rad(v); }))),
    );
  }

  function renderLeft(): void {
    clear(left);
    left.append(
      h('h3', {}, '现场选择'),
      select(state.scenes.map((s) => ({ value: s.id, text: s.name })), scene.id, (v) => {
        scene = state.scenes.find((s) => s.id === v)!;
        site = state.sites.find((s) => s.id === scene.siteId)!;
        renderAll();
      }),
      h('h3', {}, '线路与路基参数'),
    );
    const edit = (mut: () => void) => { mut(); persist(); rebuild3D(); };
    left.append(
      label('曲线半径 m (0=直线)', numInput(site.curveRadius, 50, (v) => edit(() => { site.curveRadius = v; }), 0, 5000)),
      label('路堤高度 m', numInput(site.embankmentHeight, 0.1, (v) => edit(() => { site.embankmentHeight = v; }), 0, 15)),
      label('路肩宽度 m', numInput(site.shoulderWidth, 0.05, (v) => edit(() => { site.shoulderWidth = v; }), 0.3, 3)),
      label('接触网立柱距本线中心 m', numInput(site.mastOffset, 0.1, (v) => edit(() => { site.mastOffset = v; }), 3, 12)),
      label('立柱间距 m', numInput(site.mastSpacing, 5, (v) => edit(() => { site.mastSpacing = v; }), 30, 80)),
      label('导线高度 m', numInput(site.wireHeight, 0.1, (v) => edit(() => { site.wireHeight = v; }), 5, 8)),
      label('路基容许承载力 kPa', numInput(site.allowableBearing, 10, (v) => edit(() => { site.allowableBearing = v; }), 50, 400)),
      h('h4', {}, '现场管理'),
      button('复制为新现场', () => {
        const newSite: SiteParams = { ...site, id: uid('site'), name: site.name + ' (副本)', builtIn: false };
        const newScene: AccidentScene = JSON.parse(JSON.stringify(scene));
        newScene.id = uid('scene');
        newScene.name = newSite.name;
        newScene.siteId = newSite.id;
        state.sites.push(newSite);
        state.scenes.push(newScene);
        void saveSite(newSite);
        void saveScene(newScene).then(renderAll);
      }, 'primary'),
      !site.builtIn ? button('删除该现场', () => {
        void deleteScene(scene.id).then(() => {
          scene = state.scenes[0]; site = state.sites.find((s) => s.id === scene.siteId)!;
          renderAll();
        });
      }, 'danger') : h('p', { class: 'hint' }, '内置现场不可删除'),
    );
  }

  // 画布拖拽: 射线与车辆包围盒求交, 把指针移动映射到 X/Z 或侧倾角
  function bindDrag(): void {
    let dragging = false;
    let lastPx = 0, lastPy = 0;
    canvas.addEventListener('pointerdown', (e) => {
      const id = viewport!.renderer.pick(e.clientX, e.clientY);
      if (id >= 0) { dragging = true; lastPx = e.clientX; lastPy = e.clientY; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastPx, dy = e.clientY - lastPy;
      lastPx = e.clientX; lastPy = e.clientY;
      const dc = scene.cars[0];
      if (dragAxis === 'roll') {
        dc.rotation[2] = Math.max(0, Math.min(Math.PI / 2, dc.rotation[2] + dy * 0.01));
      } else if (dragAxis === 'x') {
        dc.position[0] += dx * 0.05;
      } else {
        dc.position[2] += dx * 0.05 + dy * 0.02;
      }
      persist();
      rebuild3D();
      renderRight();
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  function renderAll(): void {
    renderLeft();
    renderRight();
    rebuild3D();
  }

  viewport = new Viewport(canvas, rebuild3D);
  viewport.renderer.camera.target = [0, 2, 0];
  viewport.renderer.camera.distance = 30;
  bindDrag();
  renderAll();
}
