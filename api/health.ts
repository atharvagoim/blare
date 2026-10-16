import { connectDb } from './_lib/db.js';
import { api, type ApiRequest, type ApiResponse } from './_lib/http.js';

// GET /api/health — configuration + database reachability check.
export default api({
  GET: async (_req: ApiRequest, res: ApiResponse) => {
    const mongoose = await connectDb();
    await mongoose.connection.db!.admin().ping();
    res.status(200).json({ ok: true });
  },
});
