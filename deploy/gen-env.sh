#!/usr/bin/env bash
# 生成生产 .env(随机强密钥,prod profile fail-fast 四件套齐全)。
# 用法(在项目根目录): bash deploy/gen-env.sh <服务器公网IP或域名>
set -euo pipefail
HOST="${1:?用法: bash deploy/gen-env.sh <公网IP或域名>}"
[ -f .env ] && { echo "❌ .env 已存在,拒绝覆盖(重生成请先手动删除并重置库口令)"; exit 1; }

rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

cat > .env <<EOF
WEB_PORT=80
DB_PASSWORD=$(rand 24)
SPRING_PROFILES_ACTIVE=prod
JWT_SECRET=$(rand 48)
ADMIN_PASSWORD=$(rand 16)
VIEWER_PASSWORD=$(rand 12)
CORS_ALLOWED_ORIGINS=http://${HOST}
EOF
chmod 600 .env

echo "== 已生成 .env(口令妥善保存,viewer 发给测试者,admin 自留) =="
grep -E 'ADMIN_PASSWORD|VIEWER_PASSWORD' .env
echo "访问地址: http://${HOST}  (admin=管理员可写 / viewer=只读)"
echo "⚠ 当前为明文 HTTP:口令在网络上未加密传输。口令请一对一私发;admin 避免在公共 WiFi 登录;正式使用前按 README 第7节上 HTTPS"
