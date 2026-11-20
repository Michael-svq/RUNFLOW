-- Las cuentas que ya existían se dan por verificadas.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
--> statement-breakpoint
ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Solo el servidor (transacción de sistema) usa estos enlaces.
CREATE POLICY email_tokens_system ON email_tokens FOR ALL
  USING (app_bypass_rls())
  WITH CHECK (app_bypass_rls());
