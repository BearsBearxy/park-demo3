# 前端镜像:node 构建(含 vue-tsc 类型检查) → nginx 托管静态产物 + /api 反代后端。
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# 127.0.0.1 而非 localhost:容器内 localhost 先解析 ::1(IPv6),而 nginx 只 listen IPv4,
# busybox wget 无回退 → 恒 unhealthy(香港部署实测踩坑;后端不受影响因 Tomcat 监听 IPv6 通配)
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
