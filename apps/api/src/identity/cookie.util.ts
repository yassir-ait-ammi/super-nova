import { parse, serialize } from "cookie";
import type { Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "@nova/shared";
import { SESSION_TTL_MS } from "./session.service";

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[SESSION_COOKIE_NAME];
}

export function writeSessionCookie(res: Response, token: string): void {
  // SEC-15: __Host- cookie => Secure, HttpOnly, SameSite=Strict, Path=/, no Domain attribute.
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    })
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    })
  );
}
