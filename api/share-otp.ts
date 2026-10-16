import { env } from './_lib/env.js';
import { api, shareIdFrom, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { requestOtp } from './_lib/shares.js';

function baseUrl(req: ApiRequest): string {
  const configured = env().APP_ORIGIN?.split(',')[0]?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  return `${proto}://${req.headers.host}`;
}

// POST /api/shares/:id/otp — email a one-time code to OWNER_EMAIL (the address is never revealed).
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const id = shareIdFrom(req);
    const result = await requestOtp(id, `${baseUrl(req)}/s/${id}`, await requestContext(req));
    res.status(202).json(result);
  },
});
