package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 楼栋损耗备注 upsert 请求(V127__loss_note.sql)。键=(ym, headBuildingId)=快照行的组头楼栋。
 * note 空串/全空白=删行(屏上清空备注);非空即 upsert。备注是本屏唯一可写的格,其余列全是派生值。
 */
public record AllocLossNoteReq(
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym,
    @NotNull Integer headBuildingId,
    @Size(max = 255) String note
) {}
