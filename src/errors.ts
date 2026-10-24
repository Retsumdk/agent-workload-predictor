/** Coded errors with stable CLI exit codes. */

export type ErrorCode =
  | "BAD_INPUT"
  | "INSUFFICIENT_HISTORY"
  | "UNKNOWN_KIND"
  | "EMPTY_HISTORY";

export class WorkloadError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "WorkloadError";
    this.code = code;
  }
}

export function exitCodeOf(e: unknown): number {
  if (e instanceof WorkloadError) {
    switch (e.code) {
      case "EMPTY_HISTORY":
      case "BAD_INPUT":
        return 5;
      case "INSUFFICIENT_HISTORY":
        return 3;
      case "UNKNOWN_KIND":
        return 4;
    }
  }
  return 1;
}
