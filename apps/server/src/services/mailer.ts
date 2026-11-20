import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

/*
 * Envío de emails (verificación y recuperación de contraseña). Con SMTP_URL
 * se usa ese servidor; sin él, los emails se escriben en el registro del
 * servidor (desarrollo, Station sin correo) y se guardan en `outbox` (pruebas).
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  readonly outbox: Mail[] = [];
  private readonly transport: Transporter | null;

  constructor(
    private readonly opts: { smtpUrl?: string; from: string },
    private readonly log: FastifyBaseLogger,
  ) {
    this.transport = opts.smtpUrl ? nodemailer.createTransport(opts.smtpUrl) : null;
  }

  get configured(): boolean {
    return !!this.transport;
  }

  async send(mail: Mail): Promise<void> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    if (!this.transport) {
      this.log.info({ to: mail.to, subject: mail.subject }, `Email (sin SMTP):\n${mail.text}`);
      return;
    }
    await this.transport.sendMail({ from: this.opts.from, ...mail });
  }
}
