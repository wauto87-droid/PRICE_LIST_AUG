import type { KeyboardEvent } from "react";

/** Main entry cells only: expanded details and drag handles keep their own keys. */
export function navigateQuotationGrid(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const input = event.target as HTMLInputElement;
  if (!(input instanceof HTMLInputElement) || !input.dataset.cartField) return;
  if (input.getAttribute("aria-expanded") === "true" && ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)) return;
  const row = input.closest("tr");
  const table = input.closest("table");
  if (!row || !table) return;
  const editable = (scope: Element) => Array.from(scope.querySelectorAll<HTMLInputElement>("input[data-cart-field]")).filter(node => !node.disabled && !node.readOnly);
  const rows = Array.from(table.querySelectorAll("tbody tr")).filter(node => editable(node).length);
  const cells = editable(table);
  const column = input.dataset.cartField;
  let target: HTMLInputElement | undefined;
  const vertical = event.key === "Enter" || event.key === "ArrowUp" || event.key === "ArrowDown";
  if (vertical) {
    event.preventDefault();
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const direction = event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1;
    for (let index = rows.indexOf(row) + direction; index >= 0 && index < rows.length; index += direction) {
      const next = rows[index];
      target = editable(next).find(node => node.dataset.cartField === (event.key === "Enter" && next.hasAttribute("data-entry-draft") ? "search" : column));
      if (target) break;
    }
  } else if (event.key === "Tab") {
    target = cells[cells.indexOf(input) + (event.shiftKey ? -1 : 1)];
    if (target) event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const left = event.key === "ArrowLeft";
    const boundary = input.selectionStart === null || (left ? input.selectionStart === 0 && input.selectionEnd === 0 : input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
    if (!boundary) return;
    const rowCells = editable(row);
    target = rowCells[rowCells.indexOf(input) + (left ? -1 : 1)];
    if (target) event.preventDefault();
  }
  if (target) { target.focus({ preventScroll: true }); target.select(); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
