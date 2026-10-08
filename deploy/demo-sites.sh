#!/usr/bin/env bash
# 演示站的一次性准备(2026-10-09 用户:一套空库看新园区装好的样子,一套放脱敏数据,由用户自己登录演示给客户看)。
# 在 /opt/demo3 下跑:
#   bash deploy/demo-sites.sh init                    # .env 补演示站口令(已有的不动),建 park_demo / park_new 两个库和各自的 MySQL 账号
#   bash deploy/demo-sites.sh load <脱敏数据.sql.gz>   # 清空 park_demo 再灌脱敏数据;以后想把演示站还原成原样也跑这一句
# 然后 .env 的 COMPOSE_PROFILES 加上 demo(如 COMPOSE_PROFILES=https,demo),docker compose up -d。
# 各站的账号只授权自己那个库,不用 root:演示站万一被打穿,碰不到正式库 park_demo3。
# 口令只进 .env 和 mysql 的标准输入,不上命令行、不打印。
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "❌ 没有 .env(先按 README §4 / §8 把正式站装好)"; exit 1; }

rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
val() { sed -n "s/^$1=//p" .env | tail -n 1; }
mysql_root() { docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$@"' mysql "$@"; }

case "${1:-}" in
init)
  for kv in DEMO_DB_PASSWORD:24 DEMO_JWT_SECRET:48 DEMO_ADMIN_PASSWORD:16 \
            NEW_DB_PASSWORD:24 NEW_JWT_SECRET:48 NEW_ADMIN_PASSWORD:16; do
    k=${kv%%:*}; n=${kv##*:}
    grep -q "^$k=" .env || echo "$k=$(rand "$n")" >> .env
  done
  chmod 600 .env
  mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS park_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS park_new  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'demo_site'@'%' IDENTIFIED BY '$(val DEMO_DB_PASSWORD)';
CREATE USER IF NOT EXISTS 'new_site'@'%'  IDENTIFIED BY '$(val NEW_DB_PASSWORD)';
ALTER USER 'demo_site'@'%' IDENTIFIED BY '$(val DEMO_DB_PASSWORD)';
ALTER USER 'new_site'@'%'  IDENTIFIED BY '$(val NEW_DB_PASSWORD)';
GRANT ALL PRIVILEGES ON park_demo.* TO 'demo_site'@'%';
GRANT ALL PRIVILEGES ON park_new.*  TO 'new_site'@'%';
SQL
  echo "✅ 两个库、两个账号就绪;.env 里补了演示站口令(admin 口令:grep -E 'DEMO_ADMIN_PASSWORD|NEW_ADMIN_PASSWORD' .env)"
  echo "   下一步:bash deploy/demo-sites.sh load <脱敏数据.sql.gz>,再把 demo 加进 COMPOSE_PROFILES,docker compose up -d"
  ;;
load)
  f="${2:?用法: bash deploy/demo-sites.sh load <脱敏数据.sql.gz>}"
  [ -f "$f" ] || { echo "❌ 找不到 $f"; exit 1; }
  docker compose --profile demo stop backend-demo >/dev/null 2>&1 || true
  mysql_root -e "DROP DATABASE IF EXISTS park_demo; CREATE DATABASE park_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  gunzip -c "$f" | mysql_root park_demo
  mysql_root -N -e "SELECT CONCAT('楼栋 ', COUNT(*)) FROM park_demo.building; SELECT CONCAT('租户 ', COUNT(*)) FROM park_demo.tenant;"
  # admin 的口令在导出里是占位符,后端启动时写成 DEMO_ADMIN_PASSWORD(AdminInitializer)。
  # 只在 profile 已开时拉起:没开就手动起来的话,以后发版的 up -d 不管它,演示站会一直停在旧版
  if val COMPOSE_PROFILES | grep -q demo; then docker compose up -d backend-demo frontend-demo; fi
  echo "✅ park_demo 已灌好;admin 口令 = .env 的 DEMO_ADMIN_PASSWORD"
  ;;
*)
  echo "用法: bash deploy/demo-sites.sh init | load <脱敏数据.sql.gz>"; exit 1 ;;
esac
