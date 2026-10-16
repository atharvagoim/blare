import { safeEqual } from '../_lib/crypto.js';
import { ensureIndexes } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { api, errors, type ApiRequest, type ApiResponse } from '../_lib/http.js';
import { sweepExpired, sweepOrphans } from '../_lib/shares.js';

// GET /api/cron/cleanup — invoked by Vercel Cron (daily on Hobby). Vercel sends
// "Authorization: Bearer $CRON_SECRET". Expiry is enforced on every read regardless.
export default api({
  GET: async (req: ApiRequest, res: ApiResponse) => {
    const secret = env().CRON_SECRET;
    const auth = req.headers.authorization ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw errors.unauthorized();

    const started = Date.now();
    // Self-heal indexes; a failure here must never stop the cleanup itself.
    await ensureIndexes().catch((err) => console.warn('[cron] index check failed', err?.message ?? err));
    let expired = 0;
    // Batches of 500 until done or ~20s have passed (well under the function limit).
    for (;;) {
      const n = await sweepExpired(500);
      expired += n;
      if (n < 500 || Date.now() - started > 20_000) break;
    }
    const orphans = await sweepOrphans(5);
    res.status(200).json({ ok: true, expiredRemoved: expired, orphanObjectsRemoved: orphans, ms: Date.now() - started });
  },
});
