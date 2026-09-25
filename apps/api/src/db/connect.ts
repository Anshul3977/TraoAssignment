import mongoose from "mongoose";

/**
 * Connect once per process. Safe to call again when already connected.
 */
export async function connectMongo(uri: string): Promise<typeof mongoose> {
  if (!uri || uri.trim() === "") {
    throw new Error("MONGODB_URI is required");
  }
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  return mongoose.connect(uri);
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
