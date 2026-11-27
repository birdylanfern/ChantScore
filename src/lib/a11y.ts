/**
 * Stopgap for icon-only controls: many toolbar buttons carry a `title` but no
 * accessible name. This gives any button with no text and no aria-label the
 * name from its `title`, and keeps doing so as the UI re-renders. Prefer
 * explicit aria-labels on new components; this only closes the existing gap.
 */
export function applyAutoAriaLabels(root: ParentNode): number {
  let changed = 0;
  root.querySelectorAll<HTMLElement>('button:not([aria-label]):not([aria-labelledby])').forEach((el) => {
    const title = el.getAttribute('title');
    if (title && !(el.textContent ?? '').trim()) {
      el.setAttribute('aria-label', title);
      changed += 1;
    }
  });
  return changed;
}

export function installAutoAriaLabels(root: HTMLElement = document.body): () => void {
  let frame = 0;
  const run = () => {
    frame = 0;
    applyAutoAriaLabels(root);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(run);
  };
  run();
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
