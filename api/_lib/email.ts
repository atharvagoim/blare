import { env } from './env.js';
import { HttpError } from './http.js';

interface OtpEmail {
  to: string;
  code: string;
  minutes: number;
  shareUrl?: string;
}

function render({ code, minutes, shareUrl }: OtpEmail) {
  const subject = `Your share PIN: ${code}`;
  const text = [
    `Someone is trying to open one of your private files on share.`,
    ``,
    `Your PIN is ${code}. It works for ${minutes} minutes.`,
    shareUrl ? `\nOpen the share: ${shareUrl}` : '',
    ``,
    `If this wasn't you, don't share the PIN. The file stays locked without it.`,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:32px;background:#fff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#000">
<p style="margin:0 0 24px;font-size:15px">Someone is trying to open one of your private files on share.</p>
<p style="margin:0 0 8px;font-size:13px;color:#555">Your PIN</p>
<p style="margin:0 0 24px;font-size:36px;letter-spacing:8px;font-weight:600">${code}</p>
<p style="margin:0 0 24px;font-size:13px;color:#555">It works for ${minutes} minutes. If this wasn't you, don't share the PIN. The file stays locked without it.</p>
</body></html>`;
  return { subject, text, html };
}

export async function sendOtpEmail(msg: OtpEmail): Promise<void> {
  const e = env();
  if (!e.EMAIL_FROM) throw new HttpError(503, 'email_not_configured', 'Email delivery is not configured on this server.');
  const { subject, text, html } = render(msg);

  if (e.EMAIL_PROVIDER === 'smtp') {
    if (!e.SMTP_URL) throw new HttpError(503, 'email_not_configured', 'Email delivery is not configured on this server.');
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport(e.SMTP_URL);
    try {
      await transport.sendMail({ from: e.EMAIL_FROM, to: msg.to, subject, text, html });
    } catch (err) {
      console.error('[email] smtp send failed', err);
      throw new HttpError(502, 'email_failed', 'We could not send the code. Try again in a minute.');
    }
    return;
  }

  if (!e.RESEND_API_KEY) throw new HttpError(503, 'email_not_configured', 'Email delivery is not configured on this server.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [msg.to], subject, text, html }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    console.error('[email] resend request failed', err);
    return null;
  });
  if (!res || !res.ok) {
    if (res) console.error('[email] resend rejected', res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'email_failed', 'We could not send the code. Try again in a minute.');
  }
}
