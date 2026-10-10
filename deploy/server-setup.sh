#!/usr/bin/env bash
# demo3 云服务器一次性初始化(Ubuntu 22.04,root 运行):安装 Docker + Compose 插件,最后跑 deploy/harden.sh 加固。
# 默认用阿里云镜像源(国内服务器直连 download.docker.com 慢/不稳);境外服务器可把
# MIRROR 改为 https://download.docker.com 。
set -euo pipefail
MIRROR="${MIRROR:-https://mirrors.aliyun.com/docker-ce}"

export DEBIAN_FRONTEND=noninteractive
# 新开的机器常在后台自动更新系统、占着 apt 的锁,不等的话第一条 apt 就失败、脚本停在开头
apt_() {
  local i
  for i in $(seq 30); do
    apt-get -o DPkg::Lock::Timeout=60 -y "$@" && return
    echo "apt 没成功(多半是系统在后台自动更新),10 秒后重试 $i/30"; sleep 10
  done
  return 1
}
apt_ update
apt_ install ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "${MIRROR}/linux/ubuntu/gpg" | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] ${MIRROR}/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt_ update
apt_ install docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# Docker Hub 大陆直连不可用(2024年中起被阻断):配置 registry 镜像加速,否则
# docker compose up --build 拉基础镜像(mysql/maven/node/nginx)即超时。
# 公共镜像站可用性会漂移:失效时换 REGISTRY_MIRROR=<新地址> 重跑本脚本,或改选香港地域直连。
REGISTRY_MIRROR="${REGISTRY_MIRROR:-https://docker.m.daocloud.io}"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{ "registry-mirrors": ["${REGISTRY_MIRROR}"] }
EOF
systemctl restart docker

# 2G swap:4G 内存同时跑 MySQL+JVM,再叠加"更新代码重新构建"(vue-tsc/mvn 并行)会触 OOM killer
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 安装完成 =="
docker --version
docker compose version
echo "registry mirror: ${REGISTRY_MIRROR}"

# 服务器加固(2026-10-11 起自动跑):SSH 只认密钥、fail2ban、防火墙,最后打一张自查表。
# 原来写在 README §7 当手动步骤,生产机因此 SSH 一直开着密码登录。没有登录密钥时它会停下、什么都不改
bash "$(dirname "$0")/harden.sh"
