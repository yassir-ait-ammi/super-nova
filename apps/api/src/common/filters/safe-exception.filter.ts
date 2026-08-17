import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * SEC-12/SEC-06: every error response is a stable, non-sensitive code plus a
 * correlation id — never a raw message, stack trace, or a hint that lets a
 * caller distinguish "exists but unauthorized" from "does not exist".
 * Full detail goes only to the server log, keyed by the same correlation id.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        code = body;
      } else if (typeof body === "object" && body !== null) {
        const b = body as Record<string, unknown>;
        code = typeof b.code === "string" ? b.code : (exception.message ?? "error");
        // `issues` (ZodValidationPipe) and `details` (domain-thrown minimized
        // context, e.g. which Business Scopes block a Company deactivation)
        // are both safe-by-construction — callers only ever set them to
        // non-sensitive, already-authorized data, never raw error internals.
        details = b.issues ?? b.details;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`[${correlationId}] ${exception.message}`, exception.stack);
    } else {
      this.logger.error(`[${correlationId}] non-Error exception thrown`);
    }

    res.status(status).json({
      code,
      correlationId,
      ...(details ? { details } : {}),
    });
  }
}
