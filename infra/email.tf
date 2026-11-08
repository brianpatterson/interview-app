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

# Return-Path (bounces and SPF): Resend's own sending infrastructure ("Forge"), which replaced the
# older Amazon SES MX + SPF records for new domains. A CNAME can't share its name with any other
# record, so these replace those. Targets as shown in Resend → Domains → mail.<domain>.
resource "cloudflare_dns_record" "resend_send" {
  zone_id = var.cloudflare_zone_id
  name    = "send.${local.mail_domain}"
  type    = "CNAME"
  content = "send.forge.rmta.net"
  proxied = false
  ttl     = 3600
}

moved {
  from = cloudflare_dns_record.resend_bounce_mx
  to   = cloudflare_dns_record.resend_send
}

resource "cloudflare_dns_record" "resend_rsend" {
  zone_id = var.cloudflare_zone_id
  name    = "rsend.${local.mail_domain}"
  type    = "CNAME"
  content = "rsend.forge.rmta.net"
  proxied = false
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
