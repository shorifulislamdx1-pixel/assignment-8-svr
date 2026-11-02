import express from 'express';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Error: MONGODB_URI is not defined in .env file");
  process.exit(1);
}

const client = new MongoClient(uri);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
 }
}

app.get('/', (req, res) => {
  res.send({ message: 'server is running fine!' });
});

async function startServer() {
  await connectToMongoDB();

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer();

