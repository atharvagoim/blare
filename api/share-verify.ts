import { accessCookieName } from './_lib/crypto.js';
import { env } from './_lib/env.js';
import { api, parseBody, setCookie, shareIdFrom, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { verifyOtp } from './_lib/shares.js';
import { verifyOtpSchema } from './_lib/validation.js';

// POST /api/shares/:id/verify — check the code; on success set an HttpOnly access cookie scoped to /api.
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const { code } = parseBody(req, verifyOtpSchema);
    const { token, maxAge } = await verifyOtp(id, code, await requestContext(req));
    setCookie(res, accessCookieName(id), token, { maxAge, path: '/api', secure: env().secureCookies });
    res.status(200).json({ ok: true });
  },
});
