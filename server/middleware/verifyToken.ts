
import type { RequestHandler } from "express";
import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

export const verifyToken: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Unauthorized: Token is missing.",
      });
      return;
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token.",
      });
      return;
    }

    const jwksUrl = process.env.JWKS_URL;
    const issuer = process.env.AUTH_ISSUER;
    const audience = process.env.AUTH_AUDIENCE;

    if (!jwksUrl || !issuer || !audience) {
      console.error("JWT/JWKS environment variables are missing.");

      res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
      return;
    }

    if (!JWKS) {
      JWKS = createRemoteJWKSet(new URL(jwksUrl));
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience,
    });

    if (!payload.sub) {
      res.status(401).json({
        success: false,
        message: "Invalid token: User ID is missing.",
      });
      return;
    }

    res.locals.auth = {
      userId: payload.sub,
      email:
        typeof payload.email === "string"
          ? payload.email
          : undefined,
      name:
        typeof payload.name === "string"
          ? payload.name
          : undefined,
    };

    next();
  } catch (error) {
    console.error("JWT verification failed:", error);

    res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token.",
    });
  }
};
