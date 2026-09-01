-- V117__weather_hour.sql — 外部逐小时天气与太阳辐射(PV-ANALYSIS-SPEC §02)。
-- 光伏分栋分析靠 13 栋互相当基准(中位数抛光),这套办法有一个结构性盲区:全园同时变差
-- (集体积灰、同批组件衰减)会被完全吸收进「当日天气因子」,残差纹丝不动。外部辐照是
-- **唯一**能看见「大家一起在变差」的通道 —— 这张表存在的理由就是补这个盲区(§5.5)。
--
-- 只存小时原始值,日累计走 SQL GROUP BY 现算(WeatherHourMapper.selectDaily):
--   一个坐标点 × 24 × 365 = 8760 行/年,扫描聚合毫秒级,没有性能理由建第二张日表;
--   更要紧的是口径写在 SQL 里,改了立刻生效不用重导 —— 落库就多一处会不同步的地方。
-- 园区单点(佛山高明),13 栋楼在同一 1km 网格内 —— **不设地点字段**。
-- 数据源 datashareclub 导出 CSV,逐小时**实测**(非预报)。dni/dhi 当前用不上但导出本就带,
-- 顺手落库:将来做遮挡分析(散射占比高的日子遮挡影响小)会用到,不落的话得重导一次。

CREATE TABLE weather_hour (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  obs_time    DATETIME     NOT NULL,                  -- 观测整点(本地时,与电表日界对齐)
  ghi         DECIMAL(7,2) NULL,                      -- 短波太阳辐射 W/m2
  dni         DECIMAL(7,2) NULL,                      -- 直射辐射 W/m2
  dhi         DECIMAL(7,2) NULL,                      -- 散射太阳辐射 W/m2
  temp_c      DECIMAL(5,2) NULL,                      -- 气温 摄氏度
  precip_mm   DECIMAL(6,2) NULL,                      -- 降水量 mm
  humidity    TINYINT UNSIGNED NULL,                  -- 相对湿度 %
  weather_txt VARCHAR(16)  NULL,                      -- 晴/多云/阴/中雨
  source      VARCHAR(16)  NOT NULL DEFAULT 'import', -- import / api
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_weather_hour (obs_time),
  KEY idx_weather_hour_date (obs_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='外部逐小时天气与辐射';
