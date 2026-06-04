export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError(400, code, message, details);
}

export function unauthorized(code: string, message: string): AppError {
  return new AppError(401, code, message);
}

export function forbidden(code: string, message: string): AppError {
  return new AppError(403, code, message);
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

export function unprocessable(code: string, message: string, details?: unknown): AppError {
  return new AppError(422, code, message, details);
}
