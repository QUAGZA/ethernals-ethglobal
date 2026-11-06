import type { ReactNode } from "react";
import { SERVER_DOWN_HINT, type ApiRequestError } from "@/lib/api";

/** Shows a server error and its hint in plain words. */
export function ErrorNotice({
  error,
  title,
  onRetry,
  className = "",
}: {
  error: Pick<ApiRequestError, "message" | "hint"> | null | undefined;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (!error) return null;
  // The server being unreachable is not a red alert: one quiet line, and the app keeps retrying.
  if (error.hint === SERVER_DOWN_HINT) {
    return (
      <p className={`m-0 flex flex-wrap items-center gap-x-3 text-[11px] opacity-60 ${className}`}>
        <span>Live data is unavailable while the server is offline.</span>
        {onRetry && (
          <button className="cursor-pointer border-b" onClick={onRetry}>
            Retry
          </button>
        )}
      </p>
    );
  }
  return (
    <div role="alert" className={`border-l-[5px] border-bad bg-bad/10 px-4 py-3 leading-[1.5] ${className}`}>
      {title && <p className="eyebrow m-0 mb-1 font-medium text-bad">{title}</p>}
      <p className="m-0 font-medium">{error.message}</p>
      {error.hint && <p className="m-0 mt-1 opacity-80">{error.hint}</p>}
      {onRetry && (
        <button className="mt-2 cursor-pointer border-b text-[11px]" onClick={onRetry}>
          TRY AGAIN ↻
        </button>
      )}
    </div>
  );
}

/** A quiet "nothing here yet" line. */
export function EmptyNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 border border-dashed border-current/40 px-4 py-6 leading-[1.6] opacity-80 ${className}`}>{children}</p>;
}
