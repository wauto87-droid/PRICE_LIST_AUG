"use client";
import type React from "react";
import type { KeyboardEvent, WheelEvent } from "react";

type WheelSafeNumberInput = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onWheel"
>;
type DiscountSafeNumberInput = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onWheel" | "onKeyDown"
>;

export function preventWheelNumberInputChange(
  event: Pick<WheelEvent<HTMLInputElement>, "currentTarget" | "preventDefault">,
) {
  event.preventDefault();
  event.currentTarget.blur();
}

export const wheelSafeNumberInputProps: WheelSafeNumberInput = {
  onWheel: preventWheelNumberInputChange,
};

export function preventArrowNumberInputChange(
  event: Pick<KeyboardEvent<HTMLInputElement>, "key" | "preventDefault">,
) {
  if (event.key === "ArrowUp" || event.key === "ArrowDown")
    event.preventDefault();
}

export const discountSafeNumberInputProps: DiscountSafeNumberInput = {
  ...wheelSafeNumberInputProps,
  onKeyDown: preventArrowNumberInputChange,
};
