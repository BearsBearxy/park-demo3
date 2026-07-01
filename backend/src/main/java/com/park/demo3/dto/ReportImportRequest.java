package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 导入本期:每公司一段(公司名匹配 management_company,未匹配自动新建);per 公司 clear+insert 本期
public record ReportImportRequest(List<CompanySection> sections) {
    public record CompanySection(String companyName, List<Cell> cells) {}
    public record Cell(String rowKey, String field, BigDecimal amount) {}
}
