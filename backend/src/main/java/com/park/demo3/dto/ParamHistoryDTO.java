package com.park.demo3.dto;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
// GET /api/params/history?key=&scope=(spec §5.4):versions=该 (作用域,键) 全部版本行(时间轴,含区间文案);
// changes=param_change_log 该 (作用域,键) 的记录(时间倒序)。Change 亦是 GET /api/params/changes 的行
// (全页变更记录多带 label/scopeLabel 人话;recalc 动作带 ym)。与前端 api/params.ts ParamVersionDTO/ParamChangeDTO 对齐。
public record ParamHistoryDTO(List<Version> versions, List<Change> changes) {
    public record Version(String acctMonth, String mode, BigDecimal value, String note, String rangeText, Integer rowId) {}
    public record Change(Long id, LocalDateTime ts, String actor, String action, String key, String scope,
                         String scopeLabel, String label, String acctMonth, String mode,
                         BigDecimal oldValue, BigDecimal newValue, String note, String ym) {}
}
