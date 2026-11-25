import './styles.css';
import { getState, initState, ROUTE_LABELS, setState, subscribe, type Route } from './state';
import { seedIfEmpty } from './services/repository';
import { mountCarsPage } from './pages/cars';
import { mountCranesPage } from './pages/cranes';
import { mountScenePage } from './pages/scene';
import { mountPlanPage } from './pages/plan';
import { mountPlaybackPage } from './pages/playback';
import { mountSheetPage } from './pages/sheet';
import { el } from './render/viewport';

const ROUTES: Route[] = ['cars', 'cranes', 'scene', 'plan', 'playback', 'sheet'];
const MOUNTERS: Record<Route, (root: HTMLElement) => void> = {
  cars: mountCarsPage,
  cranes: mountCranesPage,
  scene: mountScenePage,
  plan: mountPlanPage,
  playback: mountPlaybackPage,
  sheet: mountSheetPage,
};

let prevPage: HTMLElement | null = null;

function renderShell(): void {
  // 先通知旧页面停止 RAF 与交互监听（DOM 销毁前派发）
  prevPage?.dispatchEvent(new Event('unmount'));
  const app = document.querySelector('#app')!;
  app.innerHTML = '';
  const root = el('div', 'app');
  const top = el('div', 'topbar');
  top.innerHTML = `<div class="logo">🚆 铁路救援吊复方案推演系统</div>`;
  const nav = el('nav');
  const state = getState();
  for (const r of ROUTES) {
    const btn = el('button', state.route === r ? 'active' : '', ROUTE_LABELS[r]);
    btn.onclick = () => setState({ route: r });
    nav.appendChild(btn);
  }
  top.appendChild(nav);
  const spacer = el('div', 'spacer');
  top.appendChild(spacer);
  const tag = el('div', 'env-tag', 'TypeScript + WebGL2 · 数据存 IndexedDB');
  top.appendChild(tag);
  root.appendChild(top);

  const page = el('div', 'page');
  root.appendChild(page);
  app.appendChild(root);

  MOUNTERS[state.route](page);
  prevPage = page;
}

async function bootstrap(): Promise<void> {
  const loading = el('div', 'app');
  loading.style.display = 'flex';
  loading.style.alignItems = 'center';
  loading.style.justifyContent = 'center';
  loading.style.color = 'var(--muted)';
  loading.textContent = '正在初始化本地数据库与种子数据…';
  document.querySelector('#app')!.appendChild(loading);

  try {
    const data = await seedIfEmpty();
    initState(data);
    loading.remove();
    subscribe(() => renderShell());
    renderShell();
  } catch (e) {
    loading.textContent = '初始化失败：' + (e instanceof Error ? e.message : String(e));
  }
}

void bootstrap();
