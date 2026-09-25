import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo } from "./db/connect.js";
import {
  listQueuedJobIds,
  markInterruptedRunningJobs,
} from "./jobs/store.js";

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

const interrupted = await markInterruptedRunningJobs();
if (interrupted > 0) {
  console.warn(
    `Marked ${interrupted} in-flight job(s) as failed (INTERRUPTED). Clients may retry.`,
  );
}

const { app, worker } = createApp({
  userStore: createMongooseUserStore(),
  allowPrivateHosts: process.env.ALLOW_PRIVATE_HOSTS === "true",
});

for (const id of await listQueuedJobIds()) {
  worker.enqueue(id);
}

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
