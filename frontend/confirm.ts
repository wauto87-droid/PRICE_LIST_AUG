export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "warning" | "primary" | "info";
  icon?: string;
}

export interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  defaultValue?: string;
}

export interface ConfirmPayload extends ConfirmOptions {
  message: string;
  isPrompt?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

let confirmResolver: ((val: boolean) => void) | null = null;
let promptResolver: ((val: string | null) => void) | null = null;
let onConfirmShow: ((payload: ConfirmPayload) => void) | null = null;

export function registerConfirmHandler(
  handler: ((payload: ConfirmPayload) => void) | null,
) {
  onConfirmShow = handler;
}

export function resolveConfirm(value: boolean) {
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
}

export function resolvePrompt(value: string | null) {
  if (promptResolver) {
    promptResolver(value);
    promptResolver = null;
  }
}

export async function showConfirm(
  message: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    const payload: ConfirmPayload = {
      message,
      title: options?.title,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      tone: options?.tone || "primary",
      icon: options?.icon,
    };
    if (onConfirmShow) {
      onConfirmShow(payload);
    } else {
      console.warn("showConfirm called before ConfirmModal mounted:", message);
      resolve(false);
    }
  });
}

export async function showPrompt(
  message: string,
  options?: PromptOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    promptResolver = resolve;
    const payload: ConfirmPayload = {
      message,
      title: options?.title,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      tone: options?.tone || "primary",
      icon: options?.icon,
      isPrompt: true,
      placeholder: options?.placeholder,
      defaultValue: options?.defaultValue,
    };
    if (onConfirmShow) {
      onConfirmShow(payload);
    } else {
      console.warn("showPrompt called before ConfirmModal mounted:", message);
      resolve(null);
    }
  });
}

export async function showAlert(
  message: string,
  options?: ConfirmOptions,
): Promise<void> {
  await showConfirm(message, {
    ...options,
    cancelText: "", // Signals single button (OK/Acknowledge)
  });
}

