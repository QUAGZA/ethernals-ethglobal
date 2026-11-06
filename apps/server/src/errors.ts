/** An error safe to show to users, with an HTTP status and a plain-English hint. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, hint?: string) => new AppError(400, message, hint);
export const unauthorized = (message = "Please sign in first.", hint?: string) => new AppError(401, message, hint);
export const forbidden = (message: string, hint?: string) => new AppError(403, message, hint);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string, hint?: string) => new AppError(409, message, hint);
