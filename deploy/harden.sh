#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# 服务器加固 + 自查(Ubuntu 22.04 / 24.04,root 运行,重跑无副作用)。
#
#   bash deploy/harden.sh           加固:SSH 只认密钥 + fail2ban + 防火墙 ufw,最后打自查表。server-setup.sh 末尾自动跑
#   bash deploy/harden.sh check     只打自查表:应用起来以后、迁移以后都跑一次。有 ❌ 退出码就不是 0
#   bash deploy/harden.sh db-user   正式站连库从 root 换成只有 park_demo3 权限的专用账号;账号已经在用就只核对一遍
#                                   (gen-env.sh 生成 .env 的新服务器开机就是专用账号,不用跑)
#
# 2026-10-11 从 运维文档/对外发布准备/harden.sh 收进仓库。生产机原本 SSH 开着密码登录、root 能用密码登,
# 就是因为加固只写在 README §7 里当手动步骤。复查后改的几处:不是用密钥登进来的就不关密码登录(会把自己锁在门外)、
# 等 fail2ban 起来再查状态(原来常在这里中途退出,防火墙就没开)、apt 等锁、关完密码登录要验证真关了。
#
# 脚本管不到、要自己做的:阿里云开机器时选「密钥对」;安全组只放 22、80、443。
# 22 别把来源限成你自己的 IP:GitHub 自动发版的机器 IP 不固定,限了发版就连不上。挡暴力破解靠只认密钥 + fail2ban。
# ⚠ Docker 发布的端口(80/443/8081)不经过 ufw,对不对外由 docker-compose.yml 的端口映射决定 ——
#   8081 默认只绑 127.0.0.1。所以自查表里「对外开着的端口」按实际在监听的查,不看 ufw。
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
die() { echo "❌ $*"; exit 1; }
[ "$(id -u)" -eq 0 ] || die "请用 root 运行:sudo bash deploy/harden.sh"
LOGIN=${SUDO_USER:-root}
KEYS=$(getent passwd "$LOGIN" | cut -d: -f6)/.ssh/authorized_keys
# 24.04 上 ssh 是按需启动的,开机后还没人连过时没有 /run/sshd,sshd -t / -T 会直接报错
mkdir -p /run/sshd
ssh_ports() { sshd -T | awk '$1=="port"{print $2}'; }
# 新开的机器常在后台自动更新系统、占着 apt 的锁,不等的话 apt 立刻失败,脚本停在半截
apt_() {
  local i
  for i in $(seq 30); do
    apt-get -o DPkg::Lock::Timeout=60 -y -qq "$@" && return
    echo "  apt 没成功(多半是系统在后台自动更新),10 秒后重试 $i/30"; sleep 10
  done
  return 1
}

check() {
  local bad=0 v open b u h
  ok()   { echo "  ✅ $*"; }
  no()   { echo "  ❌ $*"; bad=$((bad+1)); }
  warn() { echo "  ⚠ $*"; }
  echo "== 自查 =="
  v=$(sshd -T)
  grep -qx 'passwordauthentication no' <<<"$v" && ok "SSH 密码登录已关" || no "SSH 密码登录还开着"
  grep -qx 'kbdinteractiveauthentication no' <<<"$v" && ok "SSH 键盘交互登录已关" || no "SSH 键盘交互登录还开着(它也能输密码)"
  # sshd -T 把 prohibit-password 显示成它的旧名 without-password,两个是一回事
  grep -qxE 'permitrootlogin (without-password|prohibit-password|no)' <<<"$v" && ok "root 只能用密钥登录" || no "root 还能用密码登录"
  [ -s "$KEYS" ] && ok "$LOGIN 有登录密钥" || no "$LOGIN 没有登录密钥($KEYS 是空的)"
  fail2ban-client status sshd >/dev/null 2>&1 && ok "fail2ban 在跑" || no "fail2ban 没在跑"
  ufw status 2>/dev/null | grep -q '^Status: active' && ok "防火墙 ufw 开着" || no "防火墙 ufw 没开"
  # 只绑本机回环的不算;绑内网 IP 的也算对外(公网 IP 是 NAT 到内网 IP 上的)
  open=$(ss -ltnH | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)|%lo:' | sed 's/.*://' | sort -un \
         | grep -vxE "80|443|$(ssh_ports | paste -sd'|')" | paste -sd' ' || true)
  [ -z "$open" ] && ok "对外只开着 SSH、80、443" || no "还有对外开着的端口:$open(8081 的话看 .env 里是不是写了 WEB_BIND)"
  b=$(cd "$ROOT" && docker compose ps -q backend 2>/dev/null || true)
  if [ -z "$b" ]; then
    warn "正式站还没起来,连库账号没查(起来以后再跑 bash deploy/harden.sh check)"
  else
    u=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$b" | sed -n 's/^DB_USER=//p')
    h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$b")
    if [ "$u" = root ]; then no "正式站连库还在用 root(换账号:bash deploy/harden.sh db-user)"
    elif [ "$h" != healthy ]; then no "正式站后端现在不健康($h),账号 $u 可能连不上库:docker compose logs backend"
    else ok "正式站连库用专用账号 $u"; fi
  fi
  [ ! -f /var/run/reboot-required ] && ok "系统不等重启" \
    || warn "系统更新后在等重启($(paste -sd' ' /var/run/reboot-required.pkgs 2>/dev/null || true)),找空闲时间 reboot,几个站会一起停几分钟"
  warn "脚本查不到:阿里云安全组只放 22、80、443(22 别限来源 IP,GitHub 自动发版要连)"
  [ "$bad" -eq 0 ] && echo "== 全部通过 ==" || echo "== $bad 项没通过 =="
  return "$bad"
}

harden() {
  # 阿里云开机器默认选的是「自定义密码」。用密码登进来跑完这一步,之后就只能从控制台 VNC 进去救
  [ -s "$KEYS" ] || die "$LOGIN 没有登录密钥($KEYS 是空的),密码登录没关,什么都没改。
   先在阿里云控制台给这台机器绑定密钥对(或把你的公钥追加进这个文件),用密钥登录一次,再跑 bash deploy/harden.sh"
  # 文件里有密钥也不等于你手上有:比如只放了 GitHub 发版用的那把。看这次 SSH 登录是怎么进来的(sudo 会吞掉 SSH_CLIENT,那就只能靠上一条)
  if [ -n "${SSH_CLIENT:-}" ]; then
    local how c=($SSH_CLIENT)   # 「客户端IP 客户端端口 本机端口」,日志里记成「Accepted 方式 for 用户 from IP port 端口」
    how=$({ journalctl -q --no-pager -t sshd -t sshd-session -S -2d 2>/dev/null; cat /var/log/auth.log 2>/dev/null; } \
          | grep -F " from ${c[0]} port ${c[1]} " | grep -oE 'Accepted [a-z-]+' | tail -n 1 || true)
    case "$how" in
      *publickey) ;;
      "") echo "  ⚠ 查不到这次 SSH 是怎么登进来的,只确认了 $KEYS 里有密钥" ;;
      *) die "你这次是用密码登进来的($how),关了密码登录你就进不来了。密码登录没关,什么都没改。
   先把你自己的公钥追加进 $KEYS,用密钥登录一次,再跑 bash deploy/harden.sh" ;;
    esac
  fi

  echo "== 1/3 SSH:只认密钥 =="
  # sshd 每个关键字取第一次读到的值。Ubuntu 主配置开头就 Include sshd_config.d/*.conf,按文件名顺序读,
  # 00- 排在云镜像常带的 50-cloud-init.conf(常把密码登录打开)前面
  cat > /etc/ssh/sshd_config.d/00-harden.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
  chmod 644 /etc/ssh/sshd_config.d/00-harden.conf
  # 主配置里写在 Include 前面的开关会抢先生效(生产机当初就写在主配置里),注释掉
  sed -ri 's/^\s*(PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PermitRootLogin)\s+yes/#&/I' /etc/ssh/sshd_config
  sshd -t
  local v; v=$(sshd -T)
  grep -qx 'passwordauthentication no' <<<"$v" && grep -qx 'kbdinteractiveauthentication no' <<<"$v" \
    || die "改完以后 sshd 认到的还是能用密码登录(主配置里没有 Include /etc/ssh/sshd_config.d/*.conf?)。
   sshd 没有重新加载,现在的登录方式没变。把 00-harden.conf 那四行写到 /etc/ssh/sshd_config 最前面再重跑"
  systemctl reload-or-restart ssh

  echo "== 2/3 fail2ban:同一 IP 10 分钟内错 5 次封 1 小时 =="
  # 只按默认模式数「试不存在的账号」这类;拿 root 试、被密钥挡回去的不数 —— 真正挡暴力破解的是上一步关了密码登录。
  # 不开 aggressive:发版机器(GitHub Actions)每次 ssh-keyscan 都会在认证前断开,那个模式会把它封掉
  export DEBIAN_FRONTEND=noninteractive
  apt_ update || echo "  ⚠ apt update 有源没更新成,接着用现有的软件列表装"
  apt_ install fail2ban ufw
  # port 按 sshd 实际端口写,SSH 改过端口的机器不写的话封了也只封 22
  cat > /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled  = true
port     = $(ssh_ports | paste -sd, -)
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
  systemctl enable fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
  # restart 一返回就查会连不上(服务端还在读配置),set -e 下整个脚本就停了
  for _ in $(seq 30); do fail2ban-client ping >/dev/null 2>&1 && break; sleep 1; done

  echo "== 3/3 防火墙 ufw:进来的只放 SSH、80、443 =="
  local p
  for p in $(ssh_ports); do ufw allow "$p/tcp" >/dev/null; done   # SSH 改过端口的机器按实际端口放
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null

  echo "⚠ 别急着关这个窗口:另开一个窗口用密钥登一次,进得去再关"
  check
}

db_user() {
  cd "$ROOT"
  [ -f .env ] || die "$ROOT 下没有 .env"
  envval() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'; }
  local b cur u pw new= tag
  b=$(docker compose ps -q backend 2>/dev/null || true)
  [ -n "$b" ] || die "正式站后端没在跑"
  cur=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$b" | sed -n 's/^DB_USER=//p')
  u=$(envval DB_APP_USER); pw=$(envval DB_APP_PASSWORD)
  if [ -z "$u" ]; then
    u=demo3_site; pw=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true); new=1
  fi
  # 口令要拼进 SQL,只收字母数字
  [[ "$u" =~ ^[A-Za-z0-9_]{1,32}$ && "$pw" =~ ^[A-Za-z0-9]{16,}$ ]] \
    || die ".env 里 DB_APP_USER / DB_APP_PASSWORD 不对:账号只能是字母数字下划线,口令要 16 位以上字母数字"
  # 建号、对口令、授权,重跑无害。迁移到新机器时 mysql 数据卷要是先于 .env 里这两行建好的,也靠这一步把号补上。
  # 先建号、能登上了才写 .env:写早了而这里失败,下一次发版就会拿一个不存在的账号去连库
  docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot' <<SQL \
    || die "在 mysql 里建号失败(上面是 mysql 的报错),.env 和正式站都没动"
CREATE USER IF NOT EXISTS '$u'@'%' IDENTIFIED BY '$pw';
ALTER USER '$u'@'%' IDENTIFIED BY '$pw';
GRANT ALL PRIVILEGES ON park_demo3.* TO '$u'@'%';
SQL
  docker compose exec -T -e MYSQL_PWD="$pw" mysql mysql -h127.0.0.1 -u"$u" park_demo3 -e 'SELECT 1' >/dev/null \
    || die "账号 $u 连不上 park_demo3,.env 和正式站都没动"
  if [ -n "$new" ]; then
    [ -z "$(tail -c 1 .env)" ] || echo >> .env   # 最后一行没换行的话,追加会粘到上一行后面
    printf 'DB_APP_USER=%s\nDB_APP_PASSWORD=%s\n' "$u" "$pw" >> .env
  fi
  [ "$cur" != "$u" ] || { echo "✅ 正式站已经在用 $u 连库,账号和口令也核对过了"; return; }
  # 钉住正式站正在跑的镜像版本,同 park.sh:不钉的话 compose 回落到 :latest(可能是装机时的旧版)
  tag=${IMAGE_TAG:-$(docker inspect -f '{{.Config.Image}}' "$b" | sed 's/.*://')}
  echo "  重建正式站后端(镜像 $tag,只动 backend,约 1–2 分钟打不开)"
  if ! IMAGE_TAG=$tag docker compose up -d --no-deps --wait --wait-timeout 420 backend; then
    sed -i '/^DB_APP_USER=/d; /^DB_APP_PASSWORD=/d' .env
    IMAGE_TAG=$tag docker compose up -d --no-deps --wait --wait-timeout 420 backend || true
    docker compose restart frontend >/dev/null   # 理由同下
    die "换了账号后端起不来,已改回 root(.env 里那两行已删)。看日志:docker compose logs backend"
  fi
  # 前端的 nginx 只在启动时解析一次 backend 的地址,后端重建后地址可能变了
  docker compose restart frontend >/dev/null
  echo "✅ 正式站已改用 $u 连库"
}

case "${1:-}" in
  "")      harden ;;
  check)   check ;;
  db-user) db_user ;;
  *)       die "用法:bash deploy/harden.sh [check|db-user]" ;;
esac
