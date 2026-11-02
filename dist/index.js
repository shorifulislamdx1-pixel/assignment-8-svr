"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
require("dotenv/config");
const verifyToken_js_1 = require("./middleware/verifyToken.js");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 8000;
app.use(express_1.default.json());
const uri = process.env.MONGODB_URI;
if (!uri) {
    throw new Error("MONGODB_URI is not defined in .env");
}
const client = new mongodb_1.MongoClient(uri);
async function startServer() {
    try {
        await client.connect();
        console.log("MongoDB connected successfully!");
        // Public API
        app.get("/", (req, res) => {
            res.json({
                success: true,
                message: "BookNook server is running!",
            });
        });
        // Protected test API
        app.get("/api/protected", verifyToken_js_1.verifyToken, (req, res) => {
            res.json({
                success: true,
                message: "You have successfully accessed a protected API!",
                user: res.locals.auth,
            });
        });
        // Handle unknown routes
        app.use((req, res) => {
            res.status(404).json({
                success: false,
                message: "API route not found.",
            });
        });
        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    }
    catch (error) {
        console.error("Server startup failed:", error);
        await client.close().catch(() => undefined);
        process.exit(1);
    }
}
startServer();
