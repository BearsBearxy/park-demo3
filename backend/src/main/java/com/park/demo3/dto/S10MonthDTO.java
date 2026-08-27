package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
public record S10MonthDTO(
    int phase,
    int year,
    int month,
    boolean recorded,                       // 该年该月是否存在任意行
    List<S10RecordDTO> rows,                // 稀疏:无行回空数组(不补零)
    Map<String, BigDecimal> columnTotals,  // 25 列列合计(key=camelCase 列名)
    BigDecimal grandTotal,                 // 总计 = 全表之和
    // 归档列(spec §2):本月有钱但生效模板不渲染的自定义列,前端追加为只读列
    List<BookDtos.ArchivedColDTO> archivedCols
) {}
