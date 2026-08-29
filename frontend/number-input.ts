"use client";
import type React from "react";
import type { WheelEvent } from "react";

type WheelSafeNumberInput = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onWheel"
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
