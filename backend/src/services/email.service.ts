import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
}

function getTransport(): Transporter {
  if (!emailConfigured()) throw new Error('SMTP is not configured (SMTP_HOST is empty)');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      requireTLS: !env.SMTP_SECURE && env.isProduction,
    });
  }
  return transporter;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<string> {
  const info = await getTransport().sendMail({ from: env.SMTP_FROM, to, subject, text, html });
  return info.messageId;
}

export async function verifySmtp(): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await getTransport().verify();
    return true;
  } catch {
    return false;
  }
}
