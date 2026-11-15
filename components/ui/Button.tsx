import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * COPIED from the premium app (components/ui/Button.tsx).
 *
 * Buttons (asset sheet → Key Components → Buttons). ONE primary per screen:
 *   primary   — Deep Forest fill, white label, soft shadow
 *   secondary — lifted surface, warm hairline, ink label
 *   ghost     — no fill, faint hairline, ink label; for tertiary actions
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-[0_1px_2px_rgba(15,107,70,0.25),0_6px_16px_-8px_rgba(15,107,70,0.5)] hover:bg-brand-hover disabled:opacity-40",
  secondary:
    "bg-surface text-ink border border-line-strong shadow-control hover:border-ink/60 hover:bg-white disabled:opacity-40",
  ghost: "bg-transparent text-ink border border-line hover:border-line-strong hover:bg-surface disabled:opacity-40",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] gap-1.5",
  md: "h-11 px-5 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

const base =
  "inline-flex items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors duration-200 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** The button look for anything that isn't a <button> — a <Link>, an <a>. */
export function buttonClass({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `${base} ${variantClasses[variant]} ${sizeClasses[size]}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}
