import { api, shareIdFrom, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { completeShare } from './_lib/shares.js';

// POST /api/shares/:id/complete — verify the uploaded object (size + magic bytes) and start the expiry clock.
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const token = req.headers['x-manage-token'];
    const result = await completeShare(id, typeof token === 'string' ? token : undefined, await requestContext(req));
    res.status(200).json(result);
  },
});
