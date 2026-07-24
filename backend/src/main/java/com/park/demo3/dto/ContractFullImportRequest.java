package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;

// 合同全量导入(POST /api/contracts/import-full):一行 = 一户合同(期限原文 + 整组计费行)。
// 租户匹配:企业全称优先,简称+期兜底;合同匹配:在册单份直用 / 多份取最新期 / 无则自动新建。
// 计费行复用 BillingLinesImportRequest.Line(含 propertyType 段类型),整组替换 source='import' 行,manual 保留。
public record ContractFullImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String  tenantName,      // 简称(兜底匹配键)
        String  tenantFullName,  // 企业全称(优先匹配键)
        Integer phase,           // 期(同名简称去歧义 + 新建合同定楼栋)
        String  buildingHint,    // 物业位置原文(新建合同时据此定楼栋)
        LocalDate startDate,
        LocalDate endDate,
        String  termText,        // 期限原文(用户点名必导)
        String  termType,        // explicit|multiple|relative|none
        String  tierPriceNote,   // 分年阶梯价说明(AH)
        String  remark,
        List<Term> terms,        // 多租期 A 类续签链(升序,≥2 才拆);terms[0] = 本行明细期,起止与 startDate/endDate 同
        List<BillingLinesImportRequest.Line> lines
    ) {}

    /** 续签链的一期:text = 该段期限原文(落该期 termText),amountNote = 原文里跟在该段后的金额(落 remark 待补)。 */
    public record Term(LocalDate startDate, LocalDate endDate, String text, String amountNote) {}

    // 到户报告项:每行落到哪户哪份合同、matched 还是 created、跳过原因
    public record Item(int rowIndex, String tenantName, Integer tenantId,
                       Integer contractId, String contractNo, String action, String message) {}

    // 返回体 = ImportResultDTO(imported=matched+created / skipped / errors) + 到户报告
    public record Result(ImportResultDTO result, int matched, int created, List<Item> report) {}
}
