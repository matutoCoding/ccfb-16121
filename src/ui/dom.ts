// 极简 DOM 构建工具, 避免引入框架。
export type ElChild = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function label(text: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, text), input);
}

export function numInput(value: number, step: number, onChange: (v: number) => void, min?: number, max?: number): HTMLInputElement {
  const input = h('input', {
    type: 'number', step: String(step), value: String(+value.toFixed(4)),
    oninput: () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) onChange(min !== undefined && max !== undefined ? Math.min(max, Math.max(min, v)) : v);
    },
  }) as HTMLInputElement;
  return input;
}

export function slider(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  return h('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    oninput: (e) => onChange(parseFloat((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
}

export function select(options: { value: string; text: string }[], current: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { onchange: () => onChange(s.value) },
    ...options.map((o) => h('option', { value: o.value, ...(o.value === current ? { selected: true } : {}) }, o.text)),
  ) as HTMLSelectElement;
  return s;
}

export function button(text: string, onClick: () => void, kind: '' | 'primary' | 'danger' = ''): HTMLButtonElement {
  return h('button', { class: kind, onclick: onClick }, text) as HTMLButtonElement;
}

export function table(headers: string[], rows: (string | number)[][]): HTMLElement {
  return h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', {}, x)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, String(c)))))),
  );
}
