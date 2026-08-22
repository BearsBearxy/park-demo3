package com.park.demo3.dto;
import java.util.List;
/**
 * notices 与 errors **必须分开**(同 MeterImportResultDTO 的裁决):前端 ImportResultToast
 * 用 errors.length 决定成败判定,把「已导入,仅需知会」的提示塞进 errors 会让成功的导入显示成失败。
 * 三参构造是给不产生 notice 的导入用的,15 个既有构造点不用改。
 */
public record ImportResultDTO(int imported, int skipped, List<ImportError> errors, List<ImportError> notices) {
    public ImportResultDTO(int imported, int skipped, List<ImportError> errors) {
        this(imported, skipped, errors, List.of());
    }
}
