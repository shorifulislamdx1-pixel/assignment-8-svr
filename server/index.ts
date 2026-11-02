
import express from "express";
import { MongoClient } from "mongodb";
import "dotenv/config";
import { verifyToken } from "./middleware/verifyToken.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(express.json());

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not defined in .env");
}

const client = new MongoClient(uri);

async function startServer() {
  try {
    await client.connect();

    console.log("MongoDB connected successfully!");

    app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "BookNook server is running!",
      });
    });

    app.get("/api/protected", verifyToken, (req, res) => {
      res.json({
        success: true,
        message: "You have successfully accessed a protected API!",
        user: res.locals.auth,
      });
    });

    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: "API route not found.",
      });
    });

    app.listen(PORT, () => {
      console.log(`Server running at https://assignment-8-mauve-three.vercel.app:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    await client.close().catch(() => undefined);
    process.exit(1);
  }
}

startServer();
