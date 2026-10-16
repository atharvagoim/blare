import { api, clientIp, parseBody, type ApiRequest, type ApiResponse, requestContext } from './_lib/http.js';
import { createShare } from './_lib/shares.js';
import { verifyTurnstile } from './_lib/turnstile.js';
import { createShareSchema } from './_lib/validation.js';

// POST /api/shares — create a text share, or reserve a file share and get a presigned upload URL.
export default api({
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const input = parseBody(req, createShareSchema);
    await verifyTurnstile(input.turnstileToken, clientIp(req));
    const result = await createShare(input, await requestContext(req));
    res.status(201).json(result);
  },
});
