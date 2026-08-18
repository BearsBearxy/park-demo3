# MySQL 慢查询日志开启说明

运维动作，不涉及代码。目的是在"接口慢"时能一句话回答**慢在不在库里**。

## 为什么阈值取 0.2s，而不是默认的 10s

本库实测（2026-08）：

| 表 | 行数 | 全表扫描耗时 |
|---|---|---|
| alloc_result | 1135 | 0.77ms |
| meter_reading | 2161 | 0.51ms |
| report_amount | 13935 | 2.1ms |

即正常查询在 **2ms 量级**。MySQL 默认 `long_query_time=10` 在这套数据上永远不会打出一条，
等于开了个空日志。取 **0.2s = 正常值的 100 倍**：能捞到真正跑飞的语句（笛卡尔积、丢索引、锁等待），
又不会被日常查询淹没。

配套结论：后端接口耗时里 SQL 只占约 15%（`/api/alloc/pools` 234ms 里 SQL 几毫秒），
**慢查询日志长期为空是预期结果** —— 空日志本身就是一条证据：慢的不是库，别再往加索引的方向找。
索引已建全，不要因为看到 `log_queries_not_using_indexes` 的记录就去补索引，先看该表多大。

## docker compose 部署（已配好）

`docker-compose.yml` 的 mysql 服务 `command` 里已带：

```
--slow_query_log=1 --long_query_time=0.2 --log_queries_not_using_indexes=1
```

日志落在 datadir，也就是 `mysql-data` 卷内的 `<容器名>-slow.log`，重启/重建容器不丢。看日志：

```bash
docker compose exec mysql sh -c 'tail -f /var/lib/mysql/*-slow.log'
# 汇总排序（按累计耗时）——原始日志超过几十条就别肉眼看了
docker compose exec mysql sh -c 'mysqldumpslow -s t -t 20 /var/lib/mysql/*-slow.log'
```

`log_queries_not_using_indexes=1` 会把**小表全扫**也记进去（本库小表全扫 <1ms，属正常）。
若刷屏，去掉这一个开关即可，另两个保留。

## 已在跑的实例（不重启，临时开）

改这三项是动态变量，`SET GLOBAL` 立即生效，**重启后失效**——排障用完记得关回去：

```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 0.2;              -- 对已建立的连接不生效，需重连
SET GLOBAL log_queries_not_using_indexes = ON;
SHOW VARIABLES LIKE 'slow_query_log_file';     -- 确认落盘位置

-- 关闭
SET GLOBAL slow_query_log = OFF;
```

⚠ `long_query_time` 是 session 变量继承 global 值，**对已存在的连接不生效**。
后端用的是 HikariCP 长连接池，改完必须重启后端（或等连接被回收）才看得到效果。

## 和应用侧的两个观测点配合

- `SlowRequestFilter`（阈值 `app.slow-request-ms`，默认 500ms）：超时的请求打一条 warn，
  带 `[traceId]`、方法、URI、queryString。日志格式里的 traceId 与响应头 `X-Trace-Id` 同源，
  用户报上来的 traceId 可直接 grep。
- `/actuator/metrics/http.server.requests`：已开直方图与 SLO 分桶（200ms/500ms/1s/3s），
  看的是分布而非均值。**需登录**（`/actuator/**` 的 GET 要求已认证，非 GET 要 ADMIN），
  只有 `/actuator/health` 匿名可达。

排查顺序：先看 metrics 分位数确认是否普遍慢 → 再用 traceId 定位到具体请求 →
最后才查慢查询日志。日志为空 = 瓶颈在请求次数与包体大小，不在 SQL。
