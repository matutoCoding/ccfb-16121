// 哈希路由: 六个页面。
import { h, clear } from './dom';
import { renderCarLibrary } from './pages/carLibrary';
import { renderCrane } from './pages/cranePage';
import { renderSite } from './pages/sitePage';
import { renderPlanList } from './pages/planList';
import { renderReplay } from './pages/replay';
import { renderReport } from './pages/report';

export type Route =
  | 'cars' | 'crane' | 'site' | 'plans' | 'replay' | 'report';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'cars', label: '车型库', icon: '🚃' },
  { route: 'crane', label: '起重机', icon: '🏗' },
  { route: 'site', label: '事故现场', icon: '🛤' },
  { route: 'plans', label: '吊复方案', icon: '📋' },
  { route: 'replay', label: '推演回放', icon: '▶' },
  { route: 'report', label: '方案单', icon: '🖨' },
];

export function currentRoute(): Route {
  const r = location.hash.replace('#/', '') as Route;
  return NAV.some((n) => n.route === r) ? r : 'cars';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export async function renderApp(root: HTMLElement, sidebar: HTMLElement): Promise<void> {
  const route = currentRoute();
  clear(sidebar);
  sidebar.append(
    h('div', { class: 'brand' }, h('strong', {}, '救援吊复推演'), h('small', {}, '160t 救援列车')),
    ...NAV.map((n) => h('a', {
      class: n.route === route ? 'nav-item active' : 'nav-item',
      href: `#/${n.route}`,
    }, h('span', { class: 'nav-icon' }, n.icon), n.label)),
  );

  clear(root);
  const view = h('div', { class: 'page-view' });
  root.append(view);
  switch (route) {
    case 'cars': await renderCarLibrary(view); break;
    case 'crane': await renderCrane(view); break;
    case 'site': await renderSite(view); break;
    case 'plans': await renderPlanList(view); break;
    case 'replay': await renderReplay(view); break;
    case 'report': await renderReport(view); break;
  }
}
