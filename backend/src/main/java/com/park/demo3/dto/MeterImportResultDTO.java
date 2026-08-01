package com.park.demo3.dto;
import java.util.List;
// 抄表导入返回体(METER-IMPORT-SPEC §4):在共享 ImportResultDTO 之上加逐行匹配依据。
// 只有 /meters/import 用它——其余 20 个导入器的 ImportResultDTO 不动(前端多一个字段忽略即可)。
// 刀G 复核(2026-07-31):notices 与 errors **必须分开**。原实现把「归属被人工钉住」「位置被冻结」
// 「疑似重复建档」这类提示 addAll 进 errors,前端 ImportResultToast 用 errors.length 决定
// 警告三角与「N 行未导入」文案 —— 那些行其实成功导入了,提示被渲染成失败,越提示越吓人。
public record MeterImportResultDTO(int imported, int skipped, List<ImportError> errors,
                                   List<Match> matches, List<ImportError> notices) {
    // matchBy:code=按编码命中 / addr=按位置命中 / name=按标识命中 / new=新建
    public record Match(int rowIndex, String label, String matchBy, Integer meterId) {}
}
