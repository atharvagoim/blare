import { api, shareIdFrom, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { deleteShare, getShareView } from './_lib/shares.js';

// GET    /api/shares/:id — view a share (private shares return { locked: true } unless verified or creator)
// DELETE /api/shares/:id — creating browser (X-Manage-Token) or owner account deletes it immediately
export default api({
  GET: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const manage = req.headers['x-manage-token'];
    const view = await getShareView(
      id,
      { cookies: req.cookies ?? {}, manageToken: typeof manage === 'string' ? manage : undefined },
      await requestContext(req),
    );
    res.status(200).json(view);
  },
  DELETE: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const token = req.headers['x-manage-token'];
    await deleteShare(id, typeof token === 'string' ? token : undefined, await requestContext(req));
    res.status(204).end();
  },
});
