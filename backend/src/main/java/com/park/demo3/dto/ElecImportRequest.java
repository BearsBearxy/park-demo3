package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 电费成本导入(附表11)。body 仅 rows;每行自带 type(energy/basic)+phaseId(p1/p2/p3)+acctMonth(必填 YYYY-MM)。
// 前端 importElecRows 解析:一(记账期,期)→ 多 energy(各用电类别)+ 大工业行附 1 basic。
// 按(phaseId,acctMonth)整月整期 upsert(删该(期,月)任意来源 energy+basic 行再插)。
// 派生(不含税金额/税额/价税合计/基本用电费)不导,后端读时算。
public record ElecImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String type,         // energy / basic
        String phaseId,      // p1 / p2 / p3
        String acctMonth,    // YYYY-MM 记账月(必填)
        String invDate,      // YYYY-MM-DD 开票日期(选填)
        String period,       // 峰/平/谷(仅 energy,真实模板空)
        String cat,          // 用电类别(仅 energy)
        String unit,         // 单位(仅 energy)
        BigDecimal qty,      // 电量(仅 energy)
        BigDecimal demand,   // 计费需量(仅 basic)
        BigDecimal price,    // energy:不含税单价 / basic:单价
        BigDecimal rate,     // 税率(小数)
        String note
    ) {}
}
