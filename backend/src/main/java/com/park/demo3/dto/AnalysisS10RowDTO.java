package com.park.demo3.dto;
import java.math.BigDecimal;

// s10 租户×月 slim 行(分析层一次拉全,替代 月×期 20 次取数):
// elec = elecBasic+elecStd+elecMaint;water = waterStd+waterMaint;total = 25 费用列Σ。
public record AnalysisS10RowDTO(String acctMonth, int phase, Integer tenantId, String tenantName,
                                BigDecimal elec, BigDecimal water, BigDecimal total) {}
