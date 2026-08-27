import { Button } from "../Button/Button";
import "./ErrorState.css";

export function ErrorState({
  title = "Couldn't reach the local backend",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state__title">{title}</p>
      {description && <p className="error-state__description">{description}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
