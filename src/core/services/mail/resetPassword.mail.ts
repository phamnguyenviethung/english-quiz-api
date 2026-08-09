import { sendMail } from '@/configs/mail.config';

/**
 * Mail đặt lại mật khẩu cho tài khoản quản trị.
 *
 * `url` do Better Auth dựng sẵn, trỏ về endpoint callback của API
 * (`/api/auth/reset-password/:token?callbackURL=...`) — endpoint đó verify token
 * rồi mới redirect người dùng sang dashboard. Không tự ghép link ở đây.
 */

export const RESET_PASSWORD_EXPIRES_MINUTES = 15;

interface SendResetPasswordEmailParams {
  user: { email: string; name?: string | null };
  url: string;
}

export async function sendResetPasswordEmail({ user, url }: SendResetPasswordEmailParams): Promise<void> {
  const greetingName = user.name?.trim() || user.email;
  const subject = 'Đặt lại mật khẩu — English Quiz Admin';

  const text = [
    `Xin chào ${greetingName},`,
    '',
    'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản quản trị English Quiz.',
    `Mở link sau để đặt mật khẩu mới (có hiệu lực ${RESET_PASSWORD_EXPIRES_MINUTES} phút, chỉ dùng được một lần):`,
    url,
    '',
    'Nếu bạn không yêu cầu việc này, hãy bỏ qua email — mật khẩu hiện tại vẫn giữ nguyên.'
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 16px;font-size:20px;color:#111827">Đặt lại mật khẩu</h2>
  <p style="margin:0 0 12px">Xin chào <strong>${escapeHtml(greetingName)}</strong>,</p>
  <p style="margin:0 0 12px">Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản quản trị English Quiz.</p>
  <p style="margin:0 0 24px">
    <a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Đặt lại mật khẩu</a>
  </p>
  <p style="margin:0 0 12px;color:#6b7280;font-size:13px">
    Link có hiệu lực <strong>${RESET_PASSWORD_EXPIRES_MINUTES} phút</strong> và chỉ dùng được một lần.
  </p>
  <p style="margin:0 0 12px;color:#6b7280;font-size:13px">
    Nút không hoạt động? Sao chép link này vào trình duyệt:<br />
    <span style="word-break:break-all;color:#374151">${escapeHtml(url)}</span>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="margin:0;color:#6b7280;font-size:13px">
    Nếu bạn không yêu cầu việc này, hãy bỏ qua email — mật khẩu hiện tại vẫn giữ nguyên.
  </p>
</div>`.trim();

  await sendMail({ to: user.email, subject, html, text });
}

// Tên user do người dùng tự nhập nên phải escape trước khi nhúng vào HTML mail.
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
