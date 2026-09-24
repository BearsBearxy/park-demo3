-- V127__loss_note.sql — 楼栋损耗备注(用户要求:楼栋损耗屏的「备注」列要能自己填)。
-- 为什么另起一张表,而不是给 alloc_loss_result 加一列 note:
--   ① AllocService.generate 对该表是「按 ym 先删后插」(lossResults.deleteByYm(ym) → insertBatch),
--      computeLossUnits 纯派生、不读旧行 —— 备注若落在快照行上,每重算一次就归零;
--   ② MeterService 的抄表批量删(DELETE /api/meters/readings,cascade)同样 deleteByYm 整月抹掉。
--   独立表挂业务键 (ym, head_building_id),generate 一格不碰,重算/重导读数天然存活。
--   手法同 V92 bill_note_override(催缴单备注,同一个「重生成会抹掉人工字」的坑)。
-- 清空备注=删行:PUT 传空串即删,表里不存空串行,「有没有备注」只看有没有行。
-- head_building_id 对齐 building.id 的 INT UNSIGNED(alloc_loss_result 那列是 INT 无 FK;这里挂 FK 故取 UNSIGNED)。
-- updated_at 由 DB 维护,实体不映射(同 BillNoteOverride)。
CREATE TABLE alloc_loss_note (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym               CHAR(7)      NOT NULL,
  head_building_id INT UNSIGNED NOT NULL COMMENT '组头楼栋=alloc_loss_result.head_building_id',
  note             VARCHAR(255) NOT NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loss_note (ym, head_building_id),
  CONSTRAINT fk_loss_note_building FOREIGN KEY (head_building_id) REFERENCES building(id) ON DELETE CASCADE
) COMMENT='楼栋损耗备注(人工填);独立于 alloc_loss_result,重算(先删后插)不丢';
