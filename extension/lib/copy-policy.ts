export const COPY_CSS = ':where(body, body *):not(:where(input, textarea, select, button, [contenteditable="true"], [contenteditable="true"] *, [contenteditable=""], [contenteditable=""] *, [role="textbox"], [role="textbox"] *, [role="grid"], [role="grid"] *)) { -webkit-user-select: text !important; user-select: text !important; }';

export function isEditing(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="grid"]');
}

export function isPlainText(target: EventTarget | null): boolean {
  return target instanceof Element && !isEditing(target) && !target.closest('a, button, label, summary, video, audio, canvas, [role="button"], [role="link"], [role="slider"], [role="menuitem"], [tabindex]') && !!target.textContent?.trim();
}
