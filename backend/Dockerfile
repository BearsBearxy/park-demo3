# 后端镜像:多阶段构建。测试不在镜像内跑(CI 负责),构建只编译打包。
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
# 先拷 pom 拉依赖,源码变更时依赖层可复用缓存
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
# alpine 自带 busybox wget,供 compose healthcheck 用
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:8080/actuator/health | grep -q '"UP"' || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
