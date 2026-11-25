import './styles.css';
import { initState } from './ui/store';
import { renderApp } from './ui/router';

const app = document.getElementById('app')!;
const sidebar = document.getElementById('sidebar')!;
const page = document.getElementById('page')!;
void app;

async function boot(): Promise<void> {
  try {
    await initState();
    await renderApp(page, sidebar);
    window.addEventListener('hashchange', () => renderApp(page, sidebar));
  } catch (err) {
    page.textContent = `启动失败: ${(err as Error).message}`;
    console.error(err);
  }
}

boot();
