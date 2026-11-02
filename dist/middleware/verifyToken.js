"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = void 0;
const jose_1 = require("jose");
let JWKS = null;
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        // Check Authorization header
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({
                success: false,
                message: "Unauthorized: Token is missing.",
            });
            return;
        }
        // Extract JWT token
        const token = authHeader.split(" ")[1];
        if (!token) {
            res.status(401).json({
                success: false,
                message: "Unauthorized: Invalid token.",
            });
            return;
        }
        // Get JWKS configuration
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
        // Create remote JWKS resolver
        if (!JWKS) {
            JWKS = (0, jose_1.createRemoteJWKSet)(new URL(jwksUrl));
        }
        // Verify JWT signature and claims
        const { payload } = await (0, jose_1.jwtVerify)(token, JWKS, {
            issuer,
            audience,
        });
        // Validate user ID
        if (!payload.sub) {
            res.status(401).json({
                success: false,
                message: "Invalid token: User ID is missing.",
            });
            return;
        }
        // Attach authenticated user information
        res.locals.auth = {
            userId: payload.sub,
            email: typeof payload.email === "string"
                ? payload.email
                : undefined,
            name: typeof payload.name === "string"
                ? payload.name
                : undefined,
        };
        next();
    }
    catch (error) {
        console.error("JWT verification failed:", error);
        res.status(401).json({
            success: false,
            message: "Unauthorized: Invalid or expired token.",
        });
    }
};
exports.verifyToken = verifyToken;
