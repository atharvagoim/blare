import type {
  ApiErrorBody,
  CompleteShareResponse,
  CreateShareResponse,
  LockedShareView,
  ShareView,
} from '../../shared/limits';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const fallback = res.status === 429 ? 'Too many requests. Try again shortly.' : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? fallback);
  }
  return data as T;
}

export interface CreateShareInput {
  type: 'text' | 'file';
  text?: string;
  file?: { name: string; size: number; mime: string };
  ttlSeconds: number;
  visibility: 'public' | 'private';
  turnstileToken?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  signup: (input: { name: string; email: string; dob: string; password: string; confirmPassword: string }) =>
    request<{ user: User }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ user: null }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  createShare: (input: CreateShareInput) =>
    request<CreateShareResponse>('/api/shares', { method: 'POST', body: JSON.stringify(input) }),
  completeShare: (id: string, manageToken: string) =>
    request<CompleteShareResponse>(`/api/shares/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'X-Manage-Token': manageToken },
    }),
  /** Sends the creator's manage token when this browser has one, so the owner skips the code. */
  getShare: (id: string, manageToken?: string | null) =>
    request<ShareView | LockedShareView>(`/api/shares/${encodeURIComponent(id)}`, {
      headers: manageToken ? { 'X-Manage-Token': manageToken } : {},
    }),
  deleteShare: (id: string, manageToken: string) =>
    request<void>(`/api/shares/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Manage-Token': manageToken },
    }),
  requestOtp: (id: string) =>
    request<{ message: string; cooldownSeconds: number }>(`/api/shares/${encodeURIComponent(id)}/otp`, {
      method: 'POST',
      body: '{}',
    }),
  verifyOtp: (id: string, code: string) =>
    request<{ ok: true }>(`/api/shares/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

/** PUT the file straight to R2 with progress. Large files never touch the API. */
export function uploadToStorage(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, 'upload_failed', 'The upload was rejected by storage. Try again.'));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'upload_failed', 'The upload could not reach storage. Check your connection and try again.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export function isLocked(v: ShareView | LockedShareView): v is LockedShareView {
  return 'locked' in v && v.locked === true;
}
