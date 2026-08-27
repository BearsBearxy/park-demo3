@echo off
REM Local backend dev launcher (called by .claude/launch.json). ASCII only: cmd reads .cmd as GBK.
REM  port 8481 : 8080 sits inside a Windows TCP excluded range, cannot bind.
REM              Must match the /api proxy target in frontend/vite.config.ts.
REM  DB_PORT   : local dev DB is docker container demo3-mysql, 3306 mapped to host 13306.
cd /d "%~dp0..\backend"
call .\mvnw.cmd spring-boot:run -Dspring-boot.run.arguments="--server.port=8481 --DB_PORT=13306"
