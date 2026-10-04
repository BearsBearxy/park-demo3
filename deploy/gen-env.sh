#!/usr/bin/env bash
# 生成生产 .env(随机强密钥,prod profile fail-fast 四件套齐全)。
# 2026-10-04 用户拍板产品卖给别的园区、每园一个库:新生成 .env 的服务器就是新园区 ——
#   · 直接写起点链 FLYWAY_LOCATIONS(空库起步,不灌老链里的我园数据);我园服务器的 .env 早已存在,本脚本拒绝覆盖,碰不到
#   · 不再生成 VIEWER_PASSWORD:那个只读账号原本是发给我园测试者的,建在客户库里就是一个客户不知道、口令在我们手里的账号
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
FLYWAY_LOCATIONS=classpath:db/baseline,classpath:db/common
CORS_ALLOWED_ORIGINS=http://${HOST}
EOF
chmod 600 .env

echo "== 已生成 .env(口令妥善保存;迁移走起点链,新园区空库起步) =="
grep -E 'ADMIN_PASSWORD|FLYWAY_LOCATIONS' .env
echo "访问地址: http://${HOST}  (admin=管理员)"
echo "⚠ 当前为明文 HTTP:口令在网络上未加密传输。口令请一对一私发;admin 避免在公共 WiFi 登录;正式使用前按 README 第7节上 HTTPS"
