/** Creates MongoDB indexes (including TTL indexes). Run once after configuring MONGODB_URI. */
import { disconnectDb, ensureIndexes } from '../api/_lib/db.js';

ensureIndexes()
  .then(async () => {
    console.log('Indexes are in place: users, shares, ratelimits (TTL indexes included).');
    await disconnectDb();
  })
  .catch(async (err) => {
    console.error('Index setup failed:', err instanceof Error ? err.message : err);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
