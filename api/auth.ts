import { clearSessionCookie, currentUser, login, publicUser, setSessionCookie, signup } from './_lib/auth.js';
import { api, errors, ipHash, parseBody, queryParam, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { loginSchema, signupSchema } from './_lib/validation.js';

// GET  /api/auth/me      — the logged-in account, or { user: null }
// POST /api/auth/signup  — create an account and log in
// POST /api/auth/login   — log in
// POST /api/auth/logout  — log out
export default api({
  GET: async (req: ApiRequest, res: ApiResponse) => {
    if (queryParam(req, 'action') !== 'me') throw errors.notFound('No such endpoint.');
    const user = await currentUser(req.cookies ?? {});
    res.status(200).json({ user: user ? publicUser(user) : null });
  },
  POST: async (req: ApiRequest, res: ApiResponse) => {
    const action = queryParam(req, 'action');
    if (action === 'signup') {
      const input = parseBody(req, signupSchema);
      const user = await signup(input, ipHash(req));
      setSessionCookie(res, user._id);
      return res.status(201).json({ user: publicUser(user) });
    }
    if (action === 'login') {
      const { email, password } = parseBody(req, loginSchema);
      const user = await login(email, password, ipHash(req));
      setSessionCookie(res, user._id);
      return res.status(200).json({ user: publicUser(user) });
    }
    if (action === 'logout') {
      clearSessionCookie(res);
      return res.status(200).json({ user: null });
    }
    throw errors.notFound('No such endpoint.');
  },
});
