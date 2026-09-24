package com.park.demo3.service;

import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;
import lombok.Data;

import java.math.BigDecimal;

/**
 * 站在某月看到的一块表(METER-TIMELINE-SPEC §2):meter 资产列 + 该月归属(assignAt)+ 该月状态(statusAt)。
 * 只读投影,不落库:归属只经 MeterTimelineService.writeAssign 写,资产只经 MeterMapper 写。
 * 取法只有 MeterTimelineService.metersAt(ym);没有月份语境(档案枚举)取 metersAt(MeterTimeline.LATEST)。
 *
 * ponytail: 字段与 V129 删列前的 Meter 逐个同名 —— 池引擎 / 催缴单 / 绑定的读法一行不改,
 *   改的只是「站在哪个月取」,那正是删列时编译器逐个报出来、逐个换源的地方。
 */
@Data
public class MeterAt {
    private String ym;   // 站在哪个月看的(LATEST = 最新一行)

    // ── meter 资产列(不分月)──
    private Integer id;
    private String kind, zone, name, code, meterType, deviceType, suspect;
    private BigDecimal factor;
    private Integer isDormRoom, sortNo;

    // ── meter_assign:assignAt(ym);of() 遇到还没有任何归属行的表时全空,ownership 取列默认 share ──
    private Integer tenantId, buildingId, contractId;
    private String tenantName, area, spot, floorLabel, side, roomNo, subName;
    private String ownership;
    private Integer tenantManual = 0, ownerManual = 0, locManual = 0;

    // ── meter_status:statusAt(ym);null = 该月不在册(早于第一条状态)──
    private String status;

    public static MeterAt of(Meter m, MeterAssign a, MeterStatus s, String ym) {
        MeterAt x = new MeterAt();
        x.ym = ym;
        x.id = m.getId(); x.kind = m.getKind(); x.zone = m.getZone(); x.name = m.getName();
        x.code = m.getCode(); x.meterType = m.getMeterType(); x.deviceType = m.getDeviceType();
        x.suspect = m.getSuspect(); x.factor = m.getFactor(); x.isDormRoom = m.getIsDormRoom(); x.sortNo = m.getSortNo();
        if (a != null) {
            x.tenantId = a.getTenantId(); x.buildingId = a.getBuildingId(); x.contractId = a.getContractId();
            x.tenantName = a.getTenantName(); x.area = a.getArea(); x.spot = a.getSpot();
            x.floorLabel = a.getFloorLabel(); x.side = a.getSide(); x.roomNo = a.getRoomNo(); x.subName = a.getSubName();
            x.tenantManual = nz(a.getTenantManual()); x.ownerManual = nz(a.getOwnerManual()); x.locManual = nz(a.getLocManual());
        }
        x.ownership = a == null || a.getOwnership() == null ? "share" : a.getOwnership();
        x.status = s == null ? null : s.getStatus();
        return x;
    }

    /** 本投影的归属部分落成 fromYm 那一行(写入走 MeterTimelineService.writeAssign)。 */
    public MeterAssign toAssign(String fromYm) {
        MeterAssign a = new MeterAssign();
        a.setMeterId(id); a.setFromYm(fromYm);
        a.setTenantId(tenantId); a.setTenantName(tenantName); a.setBuildingId(buildingId); a.setOwnership(ownership);
        a.setArea(area); a.setSpot(spot); a.setFloorLabel(floorLabel); a.setSide(side); a.setRoomNo(roomNo);
        a.setSubName(subName); a.setContractId(contractId);
        a.setTenantManual(tenantManual); a.setOwnerManual(ownerManual); a.setLocManual(locManual);
        return a;
    }

    /** 资产列写回 m(kind zone name code meterType deviceType suspect factor sortNo;is_dorm_room 不经这里)。 */
    public void assetInto(Meter m) {
        m.setKind(kind); m.setZone(zone); m.setName(name); m.setCode(code); m.setMeterType(meterType);
        m.setDeviceType(deviceType); m.setSuspect(suspect); m.setFactor(factor); m.setSortNo(sortNo);
    }

    private static int nz(Integer v) { return v == null ? 0 : v; }
}
