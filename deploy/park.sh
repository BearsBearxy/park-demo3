#!/usr/bin/env bash
# 同一台机上再开一个园区(或演示站),不改仓库里任何文件(2026-10-09 用户:「没有一个模板化的部署方式吗,每次都要改 docker compose？」)。
# 在 /opt/demo3 下跑:
#   bash deploy/park.sh add  <名> <域名>                       # 空库园区(新园区装好的样子:起点链、关模拟填充)
#   bash deploy/park.sh add  <名> <域名> --data <数据.sql.gz>   # 演示数据园区(脱敏我园数据,老迁移链):先灌数据再启动
#   read -rs PARK_DB_PASSWORD && export PARK_DB_PASSWORD        # 连客户 RDS 时先这样输口令(不进命令行、不进 history)
#   bash deploy/park.sh add  <名> <域名> --db-host <主机> --db-name <库> --db-user <账号>   # 连客户自己的 RDS(库要是空的)
#   bash deploy/park.sh load   <名> <数据.sql.gz>               # 只对演示数据园区:先备份,再清空重灌
#   bash deploy/park.sh list
#   bash deploy/park.sh remove <名>                            # 停掉、摘掉域名;库留着(要删自己 DROP)
#
# 怎么做到不改仓库:每个园区一份 ../parks/<名>.yml(服务名带园区名 —— compose 会把服务名注册成网络别名,同叫 backend 会被
# 正式站前端随机连到)和一份 ../parks/caddy/<名>.caddy;yml 追加进 .env 的 COMPOSE_FILE,compose 自动合进来,
# 发版时的 `docker compose up -d` 就一起更新了。../parks 在 /opt/demo3 外面,发版整树替换碰不到它。
# 每个本机园区一个自己的库和只授权这个库的 MySQL 账号(不用 root);口令只进 ../parks/<名>.yml(600)和 mysql 的标准输入。
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "❌ 没有 .env(先按 README §4 / §8 把正式站装好)"; exit 1; }

envval() { sed -n "s/^$1=//p" .env | tail -n 1; }
die() { echo "❌ $*"; exit 1; }
PARKS=$(envval PARKS_DIR); PARKS=${PARKS:-../parks}
MAIN_DB=park_demo3   # 正式库(docker-compose.yml 的 MYSQL_DATABASE)
# head 取够就退出,tr 收到 SIGPIPE 退 141;pipefail 下这算失败,赋值语句会让 set -e 直接退出 —— 所以兜一个 || true
rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }
mysql_root() { docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$@"' mysql "$@"; }
# 镜像版本钉住正式站当前在跑的那一版:发版只在 ssh 会话里 export IMAGE_TAG,.env 里没有;不钉的话这里的 compose 命令
# 会回落到 :latest(可能是装机时的旧版)。所有 up 都带 --no-deps,只动点名的服务,不连带重建正式站
if [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE_TAG=$(envval IMAGE_TAG)
  if [ -z "$IMAGE_TAG" ]; then
    b=$(docker compose ps -q backend 2>/dev/null || true)
    [ -n "$b" ] && IMAGE_TAG=$(docker inspect -f '{{.Config.Image}}' "$b" | sed 's/.*://')
  fi
  [ -n "$IMAGE_TAG" ] || die "取不到正式站的镜像版本(正式站没在跑?);手动 export IMAGE_TAG=<提交号> 再跑"
  export IMAGE_TAG
fi
check_name() {
  [[ "$1" =~ ^[a-z][a-z0-9]{1,15}$ ]] || die "园区名只能是小写字母开头、字母数字、2–16 位:$1"
  [ "park_$1" != "$MAIN_DB" ] || die "园区名 $1 会和正式库 $MAIN_DB 同名,换一个"
}
compose_files() { local f; f=$(envval COMPOSE_FILE); echo "${f:-docker-compose.yml}"; }
set_env() {   # set_env KEY VALUE:有就改,没有就加(值只来自本脚本拼出的路径,不含 |)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
caddy_id() { docker compose ps -q caddy 2>/dev/null || true; }
caddy_validate() { [ -z "$(caddy_id)" ] || docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; }
caddy_reload() { [ -z "$(caddy_id)" ] || { docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null && echo "  Caddy 已重新加载"; }; }
park_containers() {   # 按 compose 标签找,不依赖 yml 还在不在
  local proj; proj=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$(docker compose ps -q mysql)")
  docker ps -aq --filter "label=com.docker.compose.project=$proj" --filter "label=com.docker.compose.service=$1-backend"
  docker ps -aq --filter "label=com.docker.compose.project=$proj" --filter "label=com.docker.compose.service=$1-frontend"
}
load_dump() {   # load_dump <名> <文件>:只对本机 mysql 里的库
  local p=$1 f=$2
  [ -f "$f" ] || die "找不到 $f"
  # 带 USE / CREATE DATABASE 的导出(mysqldump -B / --databases)会切到别的库里写 —— 原库名若是正式库就覆盖了它
  if gunzip -c "$f" | grep -qiE '^(USE |CREATE DATABASE|DROP DATABASE)'; then
    die "$f 里带 USE / CREATE DATABASE,会写到别的库;用不带 -B / --databases 的 mysqldump 重导"
  fi
  mysql_root -e "DROP DATABASE IF EXISTS park_$p; CREATE DATABASE park_$p CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  gunzip -c "$f" | mysql_root "park_$p"   # 用 root 灌:导出里的视图带 DEFINER=root
  # 演示数据里只许 admin 能登,口令由 yml 的 ADMIN_PASSWORD 在启动时写入(AdminInitializer 认这个占位符);其余账号一律停用
  mysql_root "park_$p" -e "UPDATE auth_user SET password_hash='!unset:ADMIN_PASSWORD' WHERE username='admin';
    UPDATE auth_user SET password_hash='!disabled', status=0 WHERE username<>'admin';"
  mysql_root -N -e "SELECT CONCAT('  楼栋 ', COUNT(*)) FROM park_$p.building; SELECT CONCAT('  租户 ', COUNT(*)) FROM park_$p.tenant;"
}
yq() {   # YAML 双引号串 + compose 插值转义:拒 " \ 换行,$ → $$
  [[ "$1" != *'"'* && "$1" != *'\'* && "$1" != *$'\n'* ]] || die "值里有 \" 或 \\ 或换行,写不进配置:请换一个口令/名称"
  printf '%s' "${1//\$/\$\$}"
}

cmd=${1:-}; shift || true
case "$cmd" in
add)
  P=${1:?用法: bash deploy/park.sh add <名> <域名> [--data 文件 | --db-host 主机 --db-name 库 --db-user 账号]}; DOMAIN=${2:?缺域名}; shift 2
  check_name "$P"
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || die "域名格式不对:$DOMAIN"
  grep -qE "(^|[ ,])$DOMAIN([ ,{]|$)" deploy/Caddyfile && die "$DOMAIN 是正式站已经在用的域名"
  for f in "$PARKS"/caddy/*.caddy; do [ -e "$f" ] && grep -q "^$DOMAIN {" "$f" && die "$DOMAIN 已经给了园区 $(basename "$f" .caddy)"; done
  DATA=; DBHOST=; DBNAME=; DBUSER=
  while [ $# -gt 0 ]; do case "$1" in
    --data) DATA=$2; shift 2 ;; --db-host) DBHOST=$2; shift 2 ;; --db-name) DBNAME=$2; shift 2 ;; --db-user) DBUSER=$2; shift 2 ;;
    *) die "不认识的参数 $1" ;; esac; done
  [ -e "$PARKS/$P.yml" ] && die "园区 $P 已经有了($PARKS/$P.yml);要重来先 remove"
  [ -n "$DATA" ] && [ -n "$DBHOST" ] && die "--data 只能灌本机的库,不能和 --db-host 一起用"
  mkdir -p "$PARKS/caddy"
  if [ -n "$DBHOST" ]; then
    [ -n "$DBNAME" ] && [ -n "$DBUSER" ] || die "连 RDS 要同时给 --db-name 和 --db-user"
    for v in "$DBHOST" "$DBNAME" "$DBUSER"; do [[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || die "主机 / 库名 / 账号只能是字母数字和 . _ -:$v"; done
    DBPASS=${PARK_DB_PASSWORD:?连 RDS:先 read -rs PARK_DB_PASSWORD && export PARK_DB_PASSWORD}
    # 客户 RDS 多半走公网:强制 TLS(默认 url 写死 useSSL=false)
    EXTRA="
      SPRING_DATASOURCE_URL: \"jdbc:mysql://$DBHOST:3306/$DBNAME?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&sslMode=REQUIRED&rewriteBatchedStatements=true\""
    DEPENDS=""
  else
    DBHOST=mysql; DBNAME=park_$P; DBUSER=${P}_site; DBPASS=$(rand 24); EXTRA=""
    # 同名库已在(remove 只摘不删库):不复用 —— 上次可能停在迁移半截,复用会在下一条迁移上撞「字段已存在」
    [ -z "$(mysql_root -N -e "SHOW DATABASES LIKE '$DBNAME'" 2>/dev/null)" ] || \
      die "库 $DBNAME 已经有了(以前开过同名园区)。确认不要了:DROP DATABASE $DBNAME; 再 add"
    mysql_root <<SQL
CREATE DATABASE $DBNAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DBUSER'@'%' IDENTIFIED BY '$DBPASS';
ALTER USER '$DBUSER'@'%' IDENTIFIED BY '$DBPASS';
GRANT ALL PRIVILEGES ON $DBNAME.* TO '$DBUSER'@'%';
SQL
    DEPENDS="
    depends_on:
      mysql:
        condition: service_healthy"
    echo "  本机库 $DBNAME、账号 $DBUSER 就绪(只授权这个库)"
  fi
  if [ -n "$DATA" ]; then
    # 演示数据 = 我园数据(脱敏)→ 老迁移链;空库遇老链 FlywayChainGuard 会拒,所以先灌再起
    FLYWAY="classpath:db/migration,classpath:db/common"; TOOLS=true; BASE=0.0.0
    load_dump "$P" "$DATA"
  else
    # 空库 = 新园区装机口径(同 deploy/gen-env.sh)
    FLYWAY="classpath:db/baseline,classpath:db/common"; TOOLS=false
    BASE=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' frontend/package.json | head -n 1)
  fi
  umask 077
  cat > "$PARKS/$P.yml" <<EOF
# 园区 $P($DOMAIN),由 deploy/park.sh 生成于 $(date +%F)。口令在下面,本文件 600。
services:
  $P-backend:
    image: \${IMAGE_PREFIX:-ghcr.io/bearsbearxy/park-demo3}-backend:\${IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      DB_HOST: "$DBHOST"
      DB_PORT: "3306"
      DB_NAME: "$DBNAME"
      DB_USER: "$(yq "$DBUSER")"
      DB_PASSWORD: "$(yq "$DBPASS")"
      SPRING_PROFILES_ACTIVE: prod
      JWT_SECRET: "$(rand 48)"
      ADMIN_PASSWORD: "$(rand 16)"
      CORS_ALLOWED_ORIGINS: "https://$DOMAIN"
      FLYWAY_LOCATIONS: "$FLYWAY"
      PARK_TOOLS_ENABLED: "$TOOLS"
      RELEASE_BASELINE: "$BASE"
      JAVA_TOOL_OPTIONS: "-Xmx384m"   # 2C4G 机器上多开几个后端:堆 384M、容器 700M 封顶,超了只重启这个园区$EXTRA
    mem_limit: 700m
    healthcheck:
      start_period: 300s   # 空库第一次启动要建全部表;几个后端同时在跑时 2C4G 上要两三分钟,镜像默认的 60s 不够
    networks:
      default: {}
      park-$P:
        aliases: [backend]   # 前端镜像的 nginx 写死 proxy_pass http://backend:8080;只在本园区自己的网里叫这个$DEPENDS
  $P-frontend:
    image: \${IMAGE_PREFIX:-ghcr.io/bearsbearxy/park-demo3}-frontend:\${IMAGE_TAG:-latest}
    restart: unless-stopped
    networks: [park-$P]
    depends_on:
      $P-backend:
        condition: service_started   # 不等 healthy:园区后端反复重启时,发版的 up -d 不会被它一直挂住
  caddy:
    networks: [default, park-$P]
networks:
  park-$P: {}
EOF
  cat > "$PARKS/caddy/$P.caddy" <<EOF
$DOMAIN {
	reverse_proxy $P-frontend:80
	header Strict-Transport-Security "max-age=31536000"
}
EOF
  umask 022
  # Caddy 认不认这份配置先验一遍:坏片段留在 import 目录里,下次 caddy 重启时正式站也会跟着断 HTTPS
  caddy_validate || { rm -f "$PARKS/caddy/$P.caddy" "$PARKS/$P.yml"; die "Caddy 不认这份配置($DOMAIN),已撤回;库 $DBNAME 留着"; }
  set_env COMPOSE_PATH_SEPARATOR ":"
  set_env COMPOSE_FILE "$(compose_files):$PARKS/$P.yml"
  docker compose up -d --no-deps --wait --wait-timeout 420 "$P-backend" "$P-frontend" || \
    die "$P 没能在 7 分钟内起来,看日志:docker compose logs $P-backend。配置已写好,修好后在 /opt/demo3 下跑:IMAGE_TAG=$IMAGE_TAG docker compose up -d --no-deps $P-backend $P-frontend(别急着 remove:迁移半截停下会留下残库)"
  if [ -n "$(caddy_id)" ]; then   # caddy 接进本园区的网(不重建 caddy,正式站不断);下次发版 compose 按 yml 里的 caddy.networks 自己接
    proj=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$(caddy_id)")
    docker network connect "${proj}_park-$P" "$(caddy_id)" 2>/dev/null || true
  fi
  caddy_reload
  echo "✅ 园区 $P 已上线:https://$DOMAIN(域名解析要先指到本机,证书才签得下来)"
  echo "   登录 admin,口令:grep ADMIN_PASSWORD $PARKS/$P.yml"
  ;;
load)
  P=${1:?用法: bash deploy/park.sh load <名> <数据.sql.gz>}; F=${2:?缺数据文件}
  check_name "$P"; [ -e "$PARKS/$P.yml" ] || die "没有园区 $P"
  # 只对用 --data 建的演示数据园区:空库园区可能已经是真实客户在用
  grep -q 'FLYWAY_LOCATIONS: "classpath:db/migration' "$PARKS/$P.yml" || die "$P 不是演示数据园区(不是用 --data 建的),不清它的库"
  grep -q 'DB_HOST: "mysql"' "$PARKS/$P.yml" || die "$P 连的是外部库,load 只管本机的库"
  mkdir -p "$PARKS/backup"; bk="$PARKS/backup/$P-$(date +%F-%H%M%S).sql.gz"
  ( umask 077; docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$1"' sh "park_$P" | gzip > "$bk" )
  echo "  原库已备份:$bk"
  docker compose stop "$P-backend" >/dev/null
  load_dump "$P" "$F"
  docker compose up -d --no-deps --wait --wait-timeout 420 "$P-backend" "$P-frontend"
  echo "✅ 园区 $P 的数据已还原;admin 口令不变(grep ADMIN_PASSWORD $PARKS/$P.yml)"
  ;;
list)
  for f in "$PARKS"/*.yml; do [ -e "$f" ] || continue
    p=$(basename "$f" .yml); d=$(sed -n 's/.*CORS_ALLOWED_ORIGINS: "https:\/\/\(.*\)"/\1/p' "$f")
    printf '%-16s %s\n' "$p" "$d"; done
  ;;
remove)
  P=${1:?用法: bash deploy/park.sh remove <名>}; check_name "$P"
  # 先从 COMPOSE_FILE 摘掉(yml 被手删了也能收拾),再按标签停容器,最后删文件
  set_env COMPOSE_FILE "$(compose_files | tr ':' '\n' | grep -vx "$PARKS/$P.yml" | paste -sd: -)"
  ids=$(park_containers "$P"); [ -z "$ids" ] || docker rm -f $ids >/dev/null
  rm -f "$PARKS/$P.yml" "$PARKS/caddy/$P.caddy"
  caddy_reload
  echo "✅ 园区 $P 已停用、域名已摘;库 park_$P 还在(确定不要了:DROP DATABASE park_$P;)"
  ;;
*)
  sed -n '2,13p' "$0"; exit 1 ;;
esac
