import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { env } from './env.js';

// mongoose is CommonJS; under native ESM (Vercel's Node runtime) only the default export is reliable.
const { Schema, model, models } = mongoose;

// ---- Connection (cached across warm serverless invocations) ----

const globalCache = globalThis as unknown as { __vanishMongo?: Promise<typeof mongoose> };

export async function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!globalCache.__vanishMongo) {
    mongoose.set('strictQuery', true);
    globalCache.__vanishMongo = mongoose
      .connect(env().MONGODB_URI, {
        // M0 allows 500 connections in total; keep each function instance small.
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
        // Indexes are created by `npm run setup:db` (and once lazily below), not on every cold start.
        autoIndex: false,
      })
      .catch((err) => {
        globalCache.__vanishMongo = undefined;
        throw err;
      });
  }
  return globalCache.__vanishMongo;
}

export async function disconnectDb(): Promise<void> {
  globalCache.__vanishMongo = undefined;
  await mongoose.disconnect();
}

// ---- Schemas ----

const shareSchema = new Schema(
  {
    _id: { type: String, required: true }, // 128-bit random, URL-safe
    kind: { type: String, enum: ['text', 'image', 'audio', 'zip'], required: true },
    visibility: { type: String, enum: ['public', 'private'], required: true },
    // 'expired' / 'deleted' are content-free tombstones, so a dead link keeps saying what happened.
    status: { type: String, enum: ['pending', 'ready', 'expired', 'deleted'], required: true },

    // File shares
    objectKey: { type: String }, // R2 key, never derived from user input
    fileName: { type: String, maxlength: 200 },
    mime: { type: String },
    size: { type: Number, min: 0 },

    // Text shares — AES-256-GCM ciphertext
    textCiphertext: { type: String },
    textLength: { type: Number },

    manageTokenHash: { type: String, required: true },
    /** Account that created the share. Required for private shares: only this account can open them. */
    ownerId: { type: String },
    creatorIpHash: { type: String, required: true },
    ttlSeconds: { type: Number, required: true },

    readyAt: { type: Date },
    /** Pending: upload deadline. Ready: moment access stops. Enforced on every read. */
    expiresAt: { type: Date, required: true },
    /** MongoDB TTL backstop, well after expiry, so cleanup can still find the R2 key first. */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
shareSchema.index({ expiresAt: 1 });
shareSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

const otpSchema = new Schema(
  {
    _id: { type: String, required: true }, // share id — one live code per private share
    shareId: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const userSchema = new Schema(
  {
    _id: { type: String, required: true }, // 128-bit random
    name: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, maxlength: 254 }, // normalised lower-case
    dob: { type: Date, required: true },
    passwordHash: { type: String, required: true }, // scrypt
  },
  { timestamps: true, versionKey: false },
);
userSchema.index({ email: 1 }, { unique: true });

const rateLimitSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${bucket}:${subject}:${windowStart}`
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type ShareDoc = InferSchemaType<typeof shareSchema> & { _id: string; createdAt: Date };
export type OtpDoc = InferSchemaType<typeof otpSchema> & { _id: string };
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };

export const Share = (models.Share as Model<ShareDoc>) ?? model<ShareDoc>('Share', shareSchema);
export const Otp = (models.Otp as Model<OtpDoc>) ?? model<OtpDoc>('Otp', otpSchema);
export const User = (models.User as Model<UserDoc>) ?? model<UserDoc>('User', userSchema);
export const RateLimit =
  (models.RateLimit as Model<{ _id: string; count: number; expiresAt: Date }>) ??
  model<{ _id: string; count: number; expiresAt: Date }>('RateLimit', rateLimitSchema);

let indexesEnsured = false;
/** Idempotent; called by setup script and by the cron job. */
export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  await connectDb();
  await Promise.all([Share.createIndexes(), Otp.createIndexes(), User.createIndexes(), RateLimit.createIndexes()]);
  indexesEnsured = true;
}
