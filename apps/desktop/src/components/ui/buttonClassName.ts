export type ButtonVariant = "primary" | "outline" | "ghost";

export type ButtonClassNameProps = {
  variant?: ButtonVariant;
  destructive?: boolean;
  className?: string;
};

export function buttonClassName({
  variant = "outline",
  destructive = false,
  className = "",
}: ButtonClassNameProps): string {
  const classes = ["btn"];
  if (destructive) classes.push("btn-danger");
  else if (variant === "primary") classes.push("btn-primary");
  else if (variant === "ghost") classes.push("btn-ghost");
  else classes.push("btn-secondary");
  if (className.trim()) classes.push(className.trim());
  return classes.join(" ");
}
