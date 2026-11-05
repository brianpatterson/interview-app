# SSH keys generated here rather than by hand. The private halves live only in OpenTofu state,
# which is already treated as a secret (see README).

# The server's SSH host key, installed by cloud-init. Stable across droplet replacement, and
# published as a known_hosts line so CI can verify it's talking to the real server.
resource "tls_private_key" "host" {
  algorithm = "ED25519"
}

# GitHub Actions logs in as `deploy` with this key (stored as a GitHub Environment secret).
resource "tls_private_key" "deploy" {
  algorithm = "ED25519"
}
