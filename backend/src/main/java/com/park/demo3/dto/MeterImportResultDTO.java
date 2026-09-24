package com.park.demo3.dto;
import java.util.List;
// 抄表导入返回体(METER-IMPORT-SPEC §4):在共享 ImportResultDTO 之上加逐行匹配依据。
// 只有 /meters/import 用它——其余 20 个导入器的 ImportResultDTO 不动(前端多一个字段忽略即可)。
// 刀G 复核(2026-07-31):notices 与 errors **必须分开**。原实现把「归属被人工钉住」「位置被冻结」
// 「疑似重复建档」这类提示 addAll 进 errors,前端 ImportResultToast 用 errors.length 决定
// 警告三角与「N 行未导入」文案 —— 那些行其实成功导入了,提示被渲染成失败,越提示越吓人。
// METER-TIMELINE-SPEC §3.2:batchId = 本批档案改动的批次号(POST /import-batches/{batchId}/revert 撤销用);
// changes = 本批让档案变了的地方,一表一字段一条(新建的表不列,matches 里 matchBy=new 已说明)。
public record MeterImportResultDTO(int imported, int skipped, List<ImportError> errors,
                                   List<Match> matches, List<ImportError> notices,
                                   String batchId, List<Change> changes) {
    // matchBy:code=按编码命中 / addr=按位置命中 / name=按标识命中 / new=新建
    public record Match(int rowIndex, String label, String matchBy, Integer meterId) {}
    // field:tenant buildingId ownership area spot floorLabel side roomNo subName contractId(MeterTimeline.diff 的字段名)或 status;
    // before/after 是该字段的原值(tenant 取企业名称原文,buildingId/contractId 取 id);
    // 影响 from ~ until,until = 这一段最后一个月(含),null = 链尾(一直到以后)
    public record Change(int meterId, String label, String field, String before, String after, String from, String until) {}
}
