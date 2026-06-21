import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Express 4 does not catch promise rejections thrown inside async route
 * handlers — without this wrapper, an awaited error (e.g. an upstream API
 * client throwing) crashes the process instead of reaching the global
 * error handler. Wrap every async route handler with this.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
