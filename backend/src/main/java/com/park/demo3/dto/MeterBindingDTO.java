package com.park.demo3.dto;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
// S2-BIND-SPEC §3:归属覆盖率报表(按账期月读侧派生)。
// status=auto|auto_bld|override|override_stale|manual|pending|placeholder;
// bucket 仅 manual 时给(date_missing|ambiguous|bld_mismatch|no_contract);candidates 供 UI 选择/一键确认。
public record MeterBindingDTO(Summary summary, List<Row> rows) {
    public record Summary(int auto, int autoBld, int override, int overrideStale,
                          Map<String, Integer> manual,   // 按桶计数,四桶恒在(零也给,UI 稳定)
                          int pending, int placeholder, int missingReadings) {}
    public record Row(Integer meterId, String status, String bucket, Integer contractId, String contractNo,
                      List<Candidate> candidates, boolean hasReading) {}
    public record Candidate(Integer contractId, String contractNo, String buildingName,
                            LocalDate startDate, LocalDate endDate) {}
}
