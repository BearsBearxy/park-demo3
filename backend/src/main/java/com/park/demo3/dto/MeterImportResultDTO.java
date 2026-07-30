package com.park.demo3.dto;
import java.util.List;
// 抄表导入返回体(METER-IMPORT-SPEC §4):在共享 ImportResultDTO 之上加逐行匹配依据。
// 只有 /meters/import 用它——其余 20 个导入器的 ImportResultDTO 不动(前端多一个字段忽略即可)。
public record MeterImportResultDTO(int imported, int skipped, List<ImportError> errors, List<Match> matches) {
    // matchBy:code=按编码命中 / addr=按位置命中 / name=按标识命中 / new=新建
    public record Match(int rowIndex, String label, String matchBy, Integer meterId) {}
}
