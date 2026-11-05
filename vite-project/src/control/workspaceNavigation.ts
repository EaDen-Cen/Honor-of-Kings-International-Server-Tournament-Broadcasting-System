/** Reveal existing dock/accordion hosts without remounting capture consumers. */
export function openWorkspace(id: string) {
  document.dispatchEvent(new CustomEvent('hok-open-panel', { detail: id }));
  let element: HTMLElement | null = document.getElementById(id);
  while (element) {
    if (element instanceof HTMLDetailsElement) element.open = true;
    element = element.parentElement;
  }
}
