locals {
  name   = "interview-app"
  labels = { app = local.name, managed_by = "opentofu" }
}

resource "hcloud_ssh_key" "admin" {
  name       = "${local.name}-admin"
  public_key = file(pathexpand(var.admin_ssh_public_key_path))
}

# Primary IPs are separate resources so the addresses (and the DNS records pointing at them)
# survive replacing the server.
resource "hcloud_primary_ip" "ipv4" {
  name        = "${local.name}-ipv4"
  type        = "ipv4"
  location    = var.location
  auto_delete = false
  labels      = local.labels
}

resource "hcloud_primary_ip" "ipv6" {
  name        = "${local.name}-ipv6"
  type        = "ipv6"
  location    = var.location
  auto_delete = false
  labels      = local.labels
}

resource "hcloud_firewall" "app" {
  name   = local.name
  labels = local.labels

  rule {
    description = "SSH (key-only)"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_allowed_cidrs
  }
  rule {
    description = "HTTP (ACME challenges, redirect to HTTPS)"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "HTTP/3"
    direction   = "in"
    protocol    = "udp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "Ping"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

# Postgres data and certificates live here, not on the server's disk, so the server is
# disposable: replace it and the data reattaches. Delete protection guards against `tofu destroy`.
resource "hcloud_volume" "data" {
  name              = "${local.name}-data"
  size              = var.data_volume_size
  location          = var.location
  format            = "ext4"
  delete_protection = true
  labels            = local.labels
}

resource "hcloud_server" "app" {
  name         = local.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.app.id]
  labels       = local.labels

  public_net {
    ipv4 = hcloud_primary_ip.ipv4.id
    ipv6 = hcloud_primary_ip.ipv6.id
  }

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    admin_ssh_public_key  = trimspace(file(pathexpand(var.admin_ssh_public_key_path)))
    deploy_ssh_public_key = trimspace(var.deploy_ssh_public_key)
    volume_device         = hcloud_volume.data.linux_device
  })
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.app.id
  automount = false # cloud-init mounts it at /srv/data
}
