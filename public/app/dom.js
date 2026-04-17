const SVG_NS = 'http://www.w3.org/2000/svg';

export function $(selector, context = document) {
  return context.querySelector(selector);
}

export function $$(selector, context = document) {
  return [...context.querySelectorAll(selector)];
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el[key] = value;
    else if (key === 'className') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

export function createClientOpaqueId(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  const bytes = new Uint32Array(2);
  window.crypto?.getRandomValues?.(bytes);
  const fallback = [...bytes].map((value) => value.toString(16).padStart(8, '0')).join('')
    || `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}-${fallback}`;
}

export function createSvgIcon(name, iconSpecs, attrs = {}) {
  const spec = iconSpecs[name];
  if (!spec) return document.createTextNode('');
  const svg = document.createElementNS(SVG_NS, 'svg');
  const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'aria-hidden': 'true' };
  Object.entries({ ...base, ...attrs }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'style' && typeof value === 'object') Object.assign(svg.style, value);
    else svg.setAttribute(key, String(value));
  });
  spec.forEach(([tag, shapeAttrs]) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(shapeAttrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    svg.appendChild(node);
  });
  return svg;
}
