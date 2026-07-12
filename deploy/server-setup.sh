#!/usr/bin/env bash
# demo3 云服务器一次性初始化(Ubuntu 22.04,root 运行):安装 Docker + Compose 插件。
# 默认用阿里云镜像源(国内服务器直连 download.docker.com 慢/不稳);境外服务器可把
# MIRROR 改为 https://download.docker.com 。
set -euo pipefail
MIRROR="${MIRROR:-https://mirrors.aliyun.com/docker-ce}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "${MIRROR}/linux/ubuntu/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] ${MIRROR}/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
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
