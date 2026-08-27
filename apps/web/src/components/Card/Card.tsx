import type { HTMLAttributes, ReactNode } from "react";
import "./Card.css";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["card", className].filter(Boolean).join(" ")} {...rest} />;
}

export function CardHeader({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="card__header">
      <h3 className="card__title">{title}</h3>
      {action ?? (meta && <span className="card__meta numeric">{meta}</span>)}
    </div>
  );
}
