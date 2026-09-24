-- V130__meter_book_seen.sql — 本月册子已核(METER-TIMELINE-SPEC §10)。
--
-- 同值重导不改写归属行(§9),src 一直是 migrate,数据上分不出「这个月的册子里有这块表」
-- 和「上线时照抄、这个月册子里根本没有」,所以单独记:导入每认到一块表(含新建)、没被判行级错误,
-- 就给 (表, 行的月份) 记一笔。某表在 M 月册子里出现过 = 存在任意一行 (meter_id, M)。
-- 不回填(§10.2):上线前后的旧导入都分不清,回填会把「在册子里但值没变」的表误标成没有。
-- batch_id 索引是 SPEC 之外加的:撤销导入按批次删本批的记录,不走全表。

CREATE TABLE meter_book_seen (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id  INT UNSIGNED NOT NULL,
  ym        CHAR(7)      NOT NULL COMMENT '册子行的月份',
  batch_id  VARCHAR(36)  NOT NULL COMMENT '导入批次(同 meter_archive_log.batch_id)',
  file_name VARCHAR(255) NULL COMMENT '导入的文件名',
  seen_at   DATETIME     NOT NULL COMMENT 'Java 时钟写',
  PRIMARY KEY (id),
  UNIQUE KEY uk_meter_book_seen (meter_id, ym, batch_id),
  KEY idx_meter_book_seen_ym (ym),
  KEY idx_meter_book_seen_batch (batch_id),
  CONSTRAINT fk_meter_book_seen_meter FOREIGN KEY (meter_id) REFERENCES meter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='某表在某月导入的册子里出现过(METER-TIMELINE-SPEC §10)';
