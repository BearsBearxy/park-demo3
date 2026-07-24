package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 园区抄表导入(METER-SPEC §4)。行自带 kind/zone/name(档案 upsert 键)+ym+档案描述+读数;
// 表按 (kind,zone,name) 建档或刷新描述,读数按 (表,ym) 先删后插覆盖;非法 kind/zone/ym、空 name=行级错误跳过。
public record MeterImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String kind, String zone, String name, String ym,
        String area, String spot, String tenantName,
        Integer tenantId, Integer buildingId, String ownership,   // v2:非空才覆盖档案;ownership 非法=行级错误
        String meterType,
        String subName, String code, BigDecimal factor,
        BigDecimal prevTotal, BigDecimal currTotal,
        BigDecimal prevSharp, BigDecimal prevPeak, BigDecimal prevFlat, BigDecimal prevValley,
        BigDecimal currSharp, BigDecimal currPeak, BigDecimal currFlat, BigDecimal currValley,
        String note
    ) {}
}
