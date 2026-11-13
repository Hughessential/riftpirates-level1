/** A tiny ornamental voxel star; it never replaces or intercepts the pointer. */
export function initMenuCursor() {
  const title = document.getElementById('titleScreen');
  if (!title || document.getElementById('menuCursorStar')) return;
  const star = document.createElement('div');
  star.id = 'menuCursorStar';
  star.setAttribute('aria-hidden', 'true');
  star.innerHTML = `<svg viewBox="0 0 28 28" focusable="false" aria-hidden="true">
    <path fill="#8428e8" d="M12 2h4v8h8v4h-8v10h-4V14H2v-4h10z"/>
    <path fill="#21ffdc" d="M12 0h4v8h-4zM0 12h8v4H0zM20 12h8v4h-8zM12 20h4v8h-4z"/>
    <path fill="#b52aff" d="M8 8h12v12H8z"/>
    <path fill="#efffff" d="M11 6h6v5h5v6h-5v5h-6v-5H6v-6h5z"/>
    <path fill="#ffffff" d="M11 11h6v6h-6z"/>
  </svg>`;
  document.body.append(star);
  let lastPointer = false;
  const paintVisibility = () => {
    star.classList.toggle('visible', lastPointer && !title.classList.contains('hidden'));
  };
  document.addEventListener('pointermove', (event) => {
    lastPointer = event.pointerType !== 'touch';
    star.style.setProperty('--mouse-x', `${event.clientX + 15}px`);
    star.style.setProperty('--mouse-y', `${event.clientY + 16}px`);
    paintVisibility();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { lastPointer = false; paintVisibility(); });
  window.addEventListener('blur', () => { lastPointer = false; paintVisibility(); });
  new MutationObserver(paintVisibility).observe(title, { attributes: true, attributeFilter: ['class'] });
}
