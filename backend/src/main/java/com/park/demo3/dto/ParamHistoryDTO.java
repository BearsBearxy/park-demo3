package com.park.demo3.dto;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
// GET /api/params/history?key=&scope=(spec §5.4):versions=该 (作用域,键) 全部版本行(时间轴,含区间文案);
// changes=param_change_log 该 (作用域,键) 的记录(时间倒序)。Change 亦是 GET /api/params/changes 的行
// (全页变更记录多带 label/scopeLabel 人话;recalc 动作带 ym)。与前端 api/params.ts ParamVersionDTO/ParamChangeDTO 对齐。
// valueText / oldText / newText = 值的人话文案(与列表行 valueText 同一格式器:枚举字典 / 布尔状态句 / 引用显名 / 千分位+单位),
// 值为空时文案为 null(前端显「—」);前端只显文案不再自己格式化数字。
// authorizer = 提权授权人(param_change_log.authorizer;本人有权 = null):本月改动表「谁」那格写「陈会计 张经理授权」(S21 §5.4,2026-10-03)。
public record ParamHistoryDTO(List<Version> versions, List<Change> changes) {
    public record Version(String acctMonth, String mode, BigDecimal value, String valueText, String note, String rangeText, Integer rowId) {}
    public record Change(Long id, LocalDateTime ts, String actor, String action, String key, String scope,
                         String scopeLabel, String label, String acctMonth, String mode,
                         BigDecimal oldValue, BigDecimal newValue, String oldText, String newText, String note, String ym,
                         String authorizer) {}
}
