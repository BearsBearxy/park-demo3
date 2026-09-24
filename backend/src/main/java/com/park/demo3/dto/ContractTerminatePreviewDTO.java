package com.park.demo3.dto;
import java.util.List;
/**
 * 终止合同确认框的取数(METER-TIMELINE-SPEC §3.6):这一户在解约月挂着的表(在册、未拆)。
 * vacateFrom = 解约次月,勾上的表自这个月起写空置行;checked = 表房号与这份合同计费行位置的房号对得上(默认勾选)。
 * label 与催缴单告警同一个称呼(表名带字用表名,裸数字表名回落「位置 + 表序」)。
 */
public record ContractTerminatePreviewDTO(String vacateFrom, List<Meter> meters) {
    public record Meter(Integer meterId, String label, String roomNo, boolean checked) {}
}
