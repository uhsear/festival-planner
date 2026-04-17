export function createToastController(h, getContainer) {
  // toast(message, type, options)
  // options.action = { label: string, fn: () => void } — renders an undo/action button
  // options.duration — ms before auto-dismiss (default 3000, 4500 when action present)
  return function toast(message, type = 'success', options = {}) {
    const { action, duration } = options;
    const ariaLive = type === 'error' ? 'assertive' : 'polite';
    const autoDismiss = duration ?? (action ? 4500 : 3000);
    const toastNode = h('div', { className: `toast toast-${type}`, role: 'alert', 'aria-live': ariaLive });
    toastNode.appendChild(h('span', { className: 'toast-message' }, message));
    if (action && typeof action.fn === 'function') {
      const actionBtn = h('button', {
        className: 'toast-action-btn',
        type: 'button',
        onclick: () => { clearTimeout(timer); toastNode.remove(); action.fn(); }
      }, action.label || 'Undo');
      toastNode.appendChild(actionBtn);
    }
    const container = getContainer();
    if (container) container.appendChild(toastNode);
    const timer = setTimeout(() => {
      if (toastNode.parentNode) toastNode.remove();
    }, autoDismiss);
  };
}
