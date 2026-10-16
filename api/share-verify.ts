import { accessCookieName } from './_lib/crypto.js';
import { env } from './_lib/env.js';
import { api, parseBody, setCookie, shareIdFrom, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { verifyPin } from './_lib/shares.js';
import { verifyPinSchema } from './_lib/validation.js';

// POST /api/shares/:id/verify — check the PIN; on success set an HttpOnly access cookie scoped to /api.
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const { pin } = parseBody(req, verifyPinSchema);
    const { token, maxAge } = await verifyPin(id, pin, await requestContext(req));
    setCookie(res, accessCookieName(id), token, { maxAge, path: '/api', secure: env().secureCookies });
    res.status(200).json({ ok: true });
  },
});
