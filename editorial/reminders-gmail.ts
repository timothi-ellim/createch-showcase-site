import nodemailer from 'nodemailer';
import { normaliseEmail, type Mail, type DeliveryResult } from './reminders.ts';

/** SMTP acceptance is not proof of inbox delivery. Never retry an ambiguous send. */
export function gmailTransport(user: string, password: string) {
  if (
    !user ||
    !password ||
    normaliseEmail(user) !== user ||
    !user.endsWith('@gmail.com')
  )
    throw new Error('REMINDERS_UNAVAILABLE');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    verify: () => transport.verify(),
    send: async (mail: Mail): Promise<DeliveryResult> => {
      const messageId = `<${mail.key.replaceAll('/', '-')}@gmail.com>`;
      try {
        const info = await transport.sendMail({
          from: { name: 'Timothi Lim · CreaTech Showcase', address: user },
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          messageId,
        });
        return {
          status: info.accepted?.length === 1 ? 'accepted' : 'failed',
          providerId: messageId,
        };
      } catch (reason) {
        const error = reason as {
          responseCode?: number;
          command?: string;
          code?: string;
        };
        const rejected =
          Number(error.responseCode) >= 400 && Number(error.responseCode) < 600;
        const recipientRejected =
          error.command?.startsWith('RCPT') &&
          [550, 551, 553].includes(error.responseCode ?? 0);
        return {
          status:
            rejected ||
            ['EAUTH', 'ECONNECTION', 'EDNS'].includes(error.code ?? '')
              ? 'failed'
              : 'uncertain',
          providerId: messageId,
          ...(recipientRejected ? { suppressed: true } : {}),
        };
      }
    },
  };
}
