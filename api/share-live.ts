import { api, parseBody, requestContext, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { listLiveShares } from './_lib/shares.js';
import { liveSharesSchema } from './_lib/validation.js';

// POST /api/shares/live — links the caller can still manage: their account's, plus the ones this
// browser created (it sends the manage tokens it holds; each is checked against the stored hash).
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const { items } = parseBody(req, liveSharesSchema);
    res.status(200).json(await listLiveShares(items, await requestContext(req)));
  },
});
