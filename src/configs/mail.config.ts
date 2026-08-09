import { Resend } from 'resend';
import logger from '@/configs/logger.config';
import { BusinessLogicException } from '@/core/exceptions';

/**
 * Mail provider (Resend) — hiện chỉ dùng cho reset password.
 *
 * Thiếu env thì service vẫn boot (giống Google sign-in), chỉ mất tính năng gửi mail.
 * Lưu ý: Better Auth bọc `sendResetPassword` trong `runInBackgroundOrAwait` — hàm đó
 * nuốt exception và chỉ log lại, nên log ở đây là tín hiệu duy nhất báo mail hỏng.
 * Winston có Discord transport từ mức `warn` nên các log này tự động về kênh Discord.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;

export const mailEnabled = Boolean(RESEND_API_KEY && MAIL_FROM);
if (!mailEnabled) {
  logger.warn('[Mail] Thiếu RESEND_API_KEY/MAIL_FROM — chức năng reset password bị tắt');
}

const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

interface SendMailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail({ to, subject, html, text }: SendMailParams): Promise<void> {
  if (!resendClient || !MAIL_FROM) {
    logger.error(`[Mail] Chưa cấu hình RESEND_API_KEY/MAIL_FROM — không gửi được mail tới ${to}`);
    throw new BusinessLogicException('Mail provider chưa được cấu hình (RESEND_API_KEY/MAIL_FROM)');
  }

  const { data, error } = await resendClient.emails.send({ from: MAIL_FROM, to, subject, html, text });

  if (error) {
    logger.error(
      `[Mail] Gửi thất bại tới ${to}: ${error.name} (${error.statusCode ?? 'no status'}) — ${error.message}`
    );
    throw new BusinessLogicException(`Không gửi được email: ${error.message}`);
  }

  logger.info(`[Mail] Sent "${subject}" → ${to} (id=${data?.id})`);
}
