@echo off
REM demo3 本地真实数据库一键备份 — 双击运行(需 Docker Desktop 已启动)。
REM 产出 backup-local-日期时间.sql 于本目录;该命名已被 .gitignore 排除,永不误入 git。
cd /d %~dp0
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set TS=%%i
docker exec demo3-mysql sh -c "mysqldump -uroot -proot --single-transaction park_demo3" > backup-local-%TS%.sql
if %errorlevel%==0 (
  echo.
  echo 备份完成: backup-local-%TS%.sql
  echo 建议定期把备份文件复制一份到移动硬盘或网盘。
) else (
  echo.
  echo 备份失败: 请确认 Docker Desktop 正在运行, 且 demo3-mysql 容器已启动。
)
pause
