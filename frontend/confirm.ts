let confirmResolver: ((val: boolean) => void) | null = null;
let onConfirmShow: ((msg: string) => void) | null = null;

export function registerConfirmHandler(handler: ((msg: string) => void) | null) {
  onConfirmShow = handler;
}

export function resolveConfirm(value: boolean) {
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
}

export async function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    if (onConfirmShow) {
      onConfirmShow(message);
    } else {
      resolve(window.confirm(message));
    }
  });
}
