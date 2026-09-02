import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  buttonClassName,
  type ButtonVariant,
} from "./buttonClassName.ts";

export type { ButtonVariant };
export { buttonClassName };

export type ButtonProps = {
  variant?: ButtonVariant;
  destructive?: boolean;
  to?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "href">;

export function Button({
  variant = "outline",
  destructive = false,
  to,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = buttonClassName({ variant, destructive, className });
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
