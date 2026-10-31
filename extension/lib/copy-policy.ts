const CONTROLS = 'input, textarea, select, button, label, summary, a, video, audio, canvas, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="grid"], [role="button"], [role="link"], [role="slider"], [role="progressbar"], [role="scrollbar"], [role="spinbutton"], [role="menuitem"], [tabindex]';

export const COPY_CSS = `:where(body, body *):not(:where(${CONTROLS}, :is(${CONTROLS}) *)) { -webkit-user-select: text !important; user-select: text !important; }`;

export function isEditing(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="grid"]');
}

export function isSelectionControl(event: Event): boolean {
  // composedPath includes controls inside open shadow roots, before retargeting.
  return event.composedPath().some(target => target instanceof Element && !!target.closest(CONTROLS));
}
