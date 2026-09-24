package com.park.demo3.dto;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
// S2-BIND-SPEC §3:归属覆盖率报表(按账期月读侧派生)。
// status=auto|auto_bld|override|override_stale|manual|pending|placeholder;
// bucket 仅 manual 时给(date_missing|ambiguous|bld_mismatch|no_contract);candidates 供 UI 选择/一键确认。
// locations=合同费项位置标签「费项名(去『租金』尾)·位置原文(含栋层单元)」,每 distinct location 一条(2026-08-04 用户要求)。
public record MeterBindingDTO(Summary summary, List<Row> rows) {
    public record Summary(int auto, int autoBld, int override, int overrideStale,
                          Map<String, Integer> manual,   // 按桶计数,四桶恒在(零也给,UI 稳定)
                          int pending, int placeholder, int missingReadings) {}
    // pinnedContractNo=人工绑定钉的那份合同号,仅当它没被直接用上时给(本月落到了同链的另一段,
    // 或链里没有覆盖本月的段、退回了自动归属)。屏上据此说明「钉的是哪份、本月落在哪份」,不静默替换。
    // suggestion(METER-TIMELINE-SPEC §3.6):待绑定(manual / override_stale)或房号对不上所用合同的行,
    // 反查本月在租、场地房号含这块表房号的**他户**合同,唯一时给出(屏上「从本月起改归 X」);否则 null。
    public record Row(Integer meterId, String status, String bucket, Integer contractId, String contractNo,
                      String pinnedContractNo,
                      List<String> locations, List<Candidate> candidates, boolean hasReading,
                      Suggestion suggestion) {}
    public record Suggestion(Integer tenantId, String tenantName, Integer contractId, String contractNo) {}
    public record Candidate(Integer contractId, String contractNo, String buildingName,
                            LocalDate startDate, LocalDate endDate, List<String> locations) {}
}
