# Outbound email through Resend (ADR-0017), sent from a subdomain so its reputation is separate from
# the apex: From: no-reply@mail.<domain>. Resend issues the DKIM key when the domain is added in
# its dashboard, so that one value comes in as a variable; the rest is fixed.
#
# Don't use Resend's "Auto configure" button for Cloudflare: it would create these records
# outside OpenTofu, and the next apply would fight it.

locals {
  mail_domain = "mail.${var.domain}"
}

# DKIM: the public key receivers use to check Resend's signature on our mail. d=mail.<domain>, so
# it aligns with the From domain, which is what DMARC (below) checks.
resource "cloudflare_dns_record" "resend_dkim" {
  zone_id = var.cloudflare_zone_id
  name    = "resend._domainkey.${local.mail_domain}"
  type    = "TXT"
  content = "\"${var.resend_dkim_public_key}\""
  ttl     = 3600
}

# Bounce and complaint handling: Resend (Amazon SES underneath) uses send.mail.<domain> as the
# envelope sender (Return-Path), so bounces come back to it here.
resource "cloudflare_dns_record" "resend_bounce_mx" {
  zone_id  = var.cloudflare_zone_id
  name     = "send.${local.mail_domain}"
  type     = "MX"
  content  = "feedback-smtp.${var.resend_region}.amazonses.com"
  priority = 10
  ttl      = 3600
}

# SPF for that envelope sender: only Amazon SES may send as send.mail.<domain>.
resource "cloudflare_dns_record" "resend_spf" {
  zone_id = var.cloudflare_zone_id
  name    = "send.${local.mail_domain}"
  type    = "TXT"
  content = "\"v=spf1 include:amazonses.com ~all\""
  ttl     = 3600
}

# DMARC for the whole domain (subdomains inherit it): mail claiming to be from us must pass DKIM
# or SPF with an aligned domain, or receivers should put it in spam. Gmail and Yahoo require a
# DMARC record from senders. `quarantine` rather than `none` because nothing else sends as this
# domain, so anything failing is spoofed. No `rua` reports: they need a mailbox to receive them.
resource "cloudflare_dns_record" "dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "\"v=DMARC1; p=quarantine; adkim=r; aspf=r\""
  ttl     = 3600
}
