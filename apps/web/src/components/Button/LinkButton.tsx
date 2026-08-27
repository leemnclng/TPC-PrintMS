import { Link, LinkProps } from "react-router-dom";
import { buttonClassName, ButtonSize, ButtonVariant } from "./Button";

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClassName(variant, size, className)} {...rest} />;
}
