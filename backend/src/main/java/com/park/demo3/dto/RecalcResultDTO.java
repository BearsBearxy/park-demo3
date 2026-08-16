package com.park.demo3.dto;
import java.util.List;
// POST /api/params/recalc?ym= 摘要(spec §5.5):池快照行数 / 楼栋损耗行数 / 本批新插催缴单数 / 因已确认·已导出跳过的户数 / 池引擎告警
public record RecalcResultDTO(int pools, int lossUnits, int notices, int skippedConfirmed, List<String> warnings) {}
