import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo } from "./db/connect.js";

const PORT = Number(process.env.PORT ?? 4000);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === "") {
  console.error("JWT_SECRET is required. Copy .env.example to .env and set it.");
  process.exit(1);
}

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri || mongoUri.trim() === "") {
  console.error("MONGODB_URI is required. Copy .env.example to .env and set it.");
  process.exit(1);
}

await connectMongo(mongoUri);

const { app } = createApp({ userStore: createMongooseUserStore() });

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
