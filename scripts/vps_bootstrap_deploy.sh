#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Van-is-code/Vanmerchant.git}"
APP_DIR="${APP_DIR:-/var/www/vanmerchant}"
BRANCH="${BRANCH:-master}"
API_DOMAIN="${API_DOMAIN:-apitranhalam.uyentoan.studio}"
WEB_DOMAIN="${WEB_DOMAIN:-tranhalam.uyentoan.studio}"
POSTGRES_DB="${POSTGRES_DB:-tranhalam}"
POSTGRES_USER="${POSTGRES_USER:-tranhalam}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-tranhalam}"
JWT_SECRET="${JWT_SECRET:-}"
STORE_NAME="${STORE_NAME:-Van Merchant}"
PAYOS_CLIENT_ID="${PAYOS_CLIENT_ID:-}"
PAYOS_API_KEY="${PAYOS_API_KEY:-}"
PAYOS_CHECKSUM_KEY="${PAYOS_CHECKSUM_KEY:-}"
PRINTER_ENABLED="${PRINTER_ENABLED:-false}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
DNS_WAIT_INTERVAL="${DNS_WAIT_INTERVAL:-30}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root on the VPS."
  exit 1
fi

generate_token() {
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"
}

load_env_file() {
  local env_path="$1"
  [ -f "${env_path}" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac

    local key value
    key="${line%%=*}"
    value="${line#*=}"

    case "$value" in
      '"'*) value="${value#\"}" ;;
    esac
    case "$value" in
      *'"') value="${value%\"}" ;;
    esac

    case "$key" in
      POSTGRES_DB) POSTGRES_DB="$value" ;;
      POSTGRES_USER) POSTGRES_USER="$value" ;;
      POSTGRES_PASSWORD) POSTGRES_PASSWORD="$value" ;;
      JWT_SECRET) JWT_SECRET="$value" ;;
      STORE_NAME) STORE_NAME="$value" ;;
      PAYOS_CLIENT_ID) PAYOS_CLIENT_ID="$value" ;;
      PAYOS_API_KEY) PAYOS_API_KEY="$value" ;;
      PAYOS_CHECKSUM_KEY) PAYOS_CHECKSUM_KEY="$value" ;;
      PAYOS_BASE_URL) PAYOS_BASE_URL="$value" ;;
      SEPAY_ENABLED) SEPAY_ENABLED="$value" ;;
      SEPAY_API_URL) SEPAY_API_URL="$value" ;;
      MERCHANT_ID) MERCHANT_ID="$value" ;;
      SECRET_KEY) SECRET_KEY="$value" ;;
      PRINTER_ENABLED) PRINTER_ENABLED="$value" ;;
    esac
  done < "${env_path}"
}

resolve_public_ip() {
  curl -fs4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'
}

wait_for_dns() {
  local public_ip="$1"
  while true; do
    local web_resolved api_resolved
    web_resolved="$(dig +short A "${WEB_DOMAIN}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    api_resolved="$(dig +short A "${API_DOMAIN}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"

    if echo " ${web_resolved} " | grep -q " ${public_ip} " && echo " ${api_resolved} " | grep -q " ${public_ip} "; then
      echo "==> DNS is ready"
      break
    fi

    echo "==> Waiting for DNS propagation"
    echo "    ${WEB_DOMAIN} -> ${web_resolved:-<not resolved>}"
    echo "    ${API_DOMAIN} -> ${api_resolved:-<not resolved>}"
    echo "    Expected IP: ${public_ip}"
    sleep "${DNS_WAIT_INTERVAL}"
  done
}

write_backend_env() {
  local env_file="${APP_DIR}/deploy/env/backend.env"
  mkdir -p "$(dirname "${env_file}")"
  cat > "${env_file}" <<EOF
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
JWT_SECRET=${JWT_SECRET}
STORE_NAME="${STORE_NAME}"
FRONTEND_URL=https://${WEB_DOMAIN}
BACKEND_URL=https://${API_DOMAIN}
PORT=2026
PAYOS_CLIENT_ID=${PAYOS_CLIENT_ID}
PAYOS_API_KEY=${PAYOS_API_KEY}
PAYOS_CHECKSUM_KEY=${PAYOS_CHECKSUM_KEY}
PAYOS_BASE_URL=${PAYOS_BASE_URL}
SEPAY_ENABLED=${SEPAY_ENABLED}
SEPAY_API_URL=${SEPAY_API_URL}
MERCHANT_ID=${MERCHANT_ID}
SECRET_KEY=${SECRET_KEY}
SEPAY_ACCOUNT_NUMBER=
SEPAY_BANK_CODE=
SEPAY_ACCOUNT_NAME=
PRINTER_ENABLED=${PRINTER_ENABLED}
EOF
}

write_frontend_env() {
  cat > "${APP_DIR}/frontend/.env.production" <<EOF
VITE_API_BASE=https://${API_DOMAIN}
EOF
}

cleanup_nginx_sites() {
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/sites-enabled/vanmerchant
  rm -f /etc/nginx/sites-enabled/vanmerchant.conf
  rm -f /etc/nginx/sites-available/vanmerchant
}

write_nginx_config() {
  cat > /etc/nginx/sites-available/vanmerchant.conf <<EOF
server {
  listen 80;
  server_name ${WEB_DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:2245;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${API_DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:2026;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /api/events {
    proxy_pass http://127.0.0.1:2026/api/events;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
    proxy_read_timeout 3600s;
  }
}
EOF
  cleanup_nginx_sites
  ln -sf /etc/nginx/sites-available/vanmerchant.conf /etc/nginx/sites-enabled/vanmerchant.conf
  nginx -t
  systemctl restart nginx
}

echo "==> Install base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git ufw nginx dnsutils

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Install Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Ensure Docker Compose plugin"
apt-get install -y docker-compose-plugin
systemctl enable docker --now

echo "==> Configure firewall"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> Sync repository"
mkdir -p /var/www
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"
fi

if [ ! -f "${APP_DIR}/deploy/env/backend.env" ] && [ -f "${APP_DIR}/deploy/env/backend.env.example" ]; then
  mkdir -p "${APP_DIR}/deploy/env"
  cp "${APP_DIR}/deploy/env/backend.env.example" "${APP_DIR}/deploy/env/backend.env"
fi

load_env_file "${APP_DIR}/deploy/env/backend.env"
load_env_file "${APP_DIR}/backend/.env"

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_token 24)}"
JWT_SECRET="${JWT_SECRET:-$(generate_token 48)}"

export POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD JWT_SECRET STORE_NAME API_DOMAIN WEB_DOMAIN
export PAYOS_CLIENT_ID PAYOS_API_KEY PAYOS_CHECKSUM_KEY MERCHANT_ID SECRET_KEY PRINTER_ENABLED

write_backend_env
write_frontend_env

PUBLIC_IP="$(resolve_public_ip)"
echo "==> Public IP: ${PUBLIC_IP}"
echo "==> DNS targets"
echo "    ${WEB_DOMAIN} -> ${PUBLIC_IP}"
echo "    ${API_DOMAIN} -> ${PUBLIC_IP}"
echo "==> Create A records in your DNS provider, then press Enter to start polling until they resolve."
read -r -p "Press Enter when DNS records are ready: "
wait_for_dns "${PUBLIC_IP}"

echo "==> Configure nginx vhost"
write_nginx_config

echo "==> Build and run containers"
cd "${APP_DIR}/deploy"
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Wait for backend health"
until curl -fsS http://127.0.0.1:2026/health >/dev/null; do
  sleep 5
done

echo "==> Update database schema + seed"
docker compose -f docker-compose.prod.yml exec -T backend npm run db:push
docker compose -f docker-compose.prod.yml exec -T backend npm run db:seed

if [ -n "${LETSENCRYPT_EMAIL}" ]; then
  echo "==> Install certbot and issue certificates"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -n --agree-tos --redirect --force-renewal \
    -m "${LETSENCRYPT_EMAIL}" \
    -d "${WEB_DOMAIN}" -d "${API_DOMAIN}" || true
  systemctl reload nginx || true
fi

echo "==> Done"
echo "Frontend: http://${WEB_DOMAIN}"
echo "Backend : http://${API_DOMAIN}"
