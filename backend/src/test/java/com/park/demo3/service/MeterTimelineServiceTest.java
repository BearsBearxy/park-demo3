package com.park.demo3.service;

import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// METER-TIMELINE-SPEC 的纯函数(MeterTimeline):取值、区间、链尾、「变了」判据。不起 Spring、不碰库。
// R4 三段走查照 SPEC 用真实月份:A@2023-08 B@2023-11 C@2024-05。
class MeterTimelineServiceTest {

    private static MeterAssign a(String from, String tenant) {
        MeterAssign r = new MeterAssign();
        r.setFromYm(from); r.setTenantName(tenant); r.setOwnership("tenant");
        return r;
    }

    private static MeterStatus s(String from, String status) {
        MeterStatus r = new MeterStatus();
        r.setFromYm(from); r.setStatus(status);
        return r;
    }

    private static final List<MeterAssign> ABC = List.of(a("2023-08", "A"), a("2023-11", "B"), a("2024-05", "C"));
    private static final List<String> FROMS = List.of("2023-08", "2023-11", "2024-05");

    // §2 取值:from ≤ ym 的最后一行;归属早于第一行取第一行,状态早于第一行 = 不在册
    @Test
    void pick_lastRowAtOrBeforeMonth() {
        assertThat(MeterTimeline.assignAt(ABC, "2023-08").getTenantName()).isEqualTo("A");
        assertThat(MeterTimeline.assignAt(ABC, "2023-10").getTenantName()).isEqualTo("A");
        assertThat(MeterTimeline.assignAt(ABC, "2023-11").getTenantName()).isEqualTo("B");
        assertThat(MeterTimeline.assignAt(ABC, "2024-04").getTenantName()).isEqualTo("B");
        assertThat(MeterTimeline.assignAt(ABC, "2024-05").getTenantName()).isEqualTo("C");
        assertThat(MeterTimeline.assignAt(ABC, MeterTimeline.LATEST).getTenantName()).isEqualTo("C");
        assertThat(MeterTimeline.assignAt(ABC, "2023-07").getTenantName()).isEqualTo("A");   // 防御:取第一行
        assertThat(MeterTimeline.assignAt(List.of(), "2023-08")).isNull();

        List<MeterStatus> st = List.of(s("2023-08", "active"), s("2024-03", "retired"), s("2024-09", "removed"));
        assertThat(MeterTimeline.statusAt(st, "2023-07")).isNull();                          // 不在册
        assertThat(MeterTimeline.statusAt(st, "2024-02").getStatus()).isEqualTo("active");
        assertThat(MeterTimeline.statusAt(st, "2024-08").getStatus()).isEqualTo("retired");
        assertThat(MeterTimeline.statusAt(st, "2024-09").getStatus()).isEqualTo("removed");
    }

    // R4 三段走查:改 A 只影响 2023-08~10,2023-11 起不动;改 B 穿不过 C;在两行之间插一行只影响到下一行前
    @Test
    void r4_threeSegments_editStopsAtNextRow() {
        assertThat(MeterTimeline.affectedMonths("2023-08", MeterTimeline.until(FROMS, "2023-08"), "2024-12"))
            .containsExactly("2023-08", "2023-09", "2023-10");
        assertThat(MeterTimeline.affectedMonths("2023-11", MeterTimeline.until(FROMS, "2023-11"), "2024-12"))
            .containsExactly("2023-11", "2023-12", "2024-01", "2024-02", "2024-03", "2024-04");
        assertThat(MeterTimeline.affectedMonths("2024-02", MeterTimeline.until(FROMS, "2024-02"), "2024-12"))
            .containsExactly("2024-02", "2024-03", "2024-04");
        assertThat(MeterTimeline.until(FROMS, "2024-05")).isNull();              // C 是链尾

        // 值层面:把 A 改掉,站在 2023-11 及以后看一格不变
        List<MeterAssign> edited = new ArrayList<>(ABC);
        edited.set(0, a("2023-08", "A改"));
        assertThat(MeterTimeline.assignAt(edited, "2023-10").getTenantName()).isEqualTo("A改");
        assertThat(MeterTimeline.assignAt(edited, "2023-11").getTenantName()).isEqualTo("B");
        assertThat(MeterTimeline.assignAt(edited, "2024-05").getTenantName()).isEqualTo("C");
    }

    // 链尾:取到库里最大已生成月,跨年照走;最大已生成月早于起始月 / 库里没数据 → 只有起始月本身
    @Test
    void tail_runsToMaxGeneratedMonth() {
        assertThat(MeterTimeline.affectedMonths("2024-05", null, "2024-08"))
            .containsExactly("2024-05", "2024-06", "2024-07", "2024-08");
        assertThat(MeterTimeline.affectedMonths("2023-11", null, "2024-02"))
            .containsExactly("2023-11", "2023-12", "2024-01", "2024-02");
        assertThat(MeterTimeline.affectedMonths("2024-05", null, "2024-02")).containsExactly("2024-05");
        assertThat(MeterTimeline.affectedMonths("2024-05", null, null)).containsExactly("2024-05");
    }

    // canonical:全角 / 半角、多余空白不算变
    @Test
    void diff_canonicalText_ignoresWidthAndWhitespace() {
        MeterAssign x = a("2023-08", "ＡＢＣ　科技  有限公司 ");
        x.setArea("Ａ座"); x.setSpot(" 四楼  西侧 "); x.setSubName("电表①");
        MeterAssign y = a("2024-02", "ABC 科技 有限公司");
        y.setArea("A座"); y.setSpot("四楼 西侧"); y.setSubName("电表①");
        assertThat(MeterTimeline.diff(x, y)).isEmpty();

        y.setArea("B座");
        y.setSubName(null);
        assertThat(MeterTimeline.diff(x, y)).containsExactly("area", "subName");
    }

    // 租户:两边都有 id 比 id,否则比规范化名
    @Test
    void diff_tenant_idWhenBothElseName() {
        MeterAssign x = a("2023-08", "甲公司"), y = a("2024-02", "甲公司（新名）");
        x.setTenantId(7); y.setTenantId(7);
        assertThat(MeterTimeline.diff(x, y)).isEmpty();                       // 同 id 改名不算换户
        y.setTenantId(8); y.setTenantName("甲公司");
        assertThat(MeterTimeline.diff(x, y)).containsExactly("tenant");      // 同名不同 id 是换户
        y.setTenantId(null);
        assertThat(MeterTimeline.diff(x, y)).isEmpty();                       // 一边没 id → 比名
        y.setTenantName("乙公司");
        assertThat(MeterTimeline.diff(x, y)).containsExactly("tenant");
    }

    // 推导列(楼栋 / 楼层 / 方位 / 房号)为空视为未知,不参与比较;两边都有且不同才算变。合同钉照常比
    @Test
    void diff_derivedColumns_emptyIsUnknown() {
        MeterAssign x = a("2023-08", "甲"), y = a("2024-02", "甲");
        x.setBuildingId(3); x.setFloorLabel("四楼"); x.setSide("西侧"); x.setRoomNo("401室");
        y.setBuildingId(null); y.setFloorLabel(" "); y.setSide(null); y.setRoomNo("");
        assertThat(MeterTimeline.diff(x, y)).isEmpty();

        y.setBuildingId(4); y.setRoomNo("402室");
        assertThat(MeterTimeline.diff(x, y)).containsExactly("buildingId", "roomNo");

        y.setBuildingId(3); y.setRoomNo("401室"); y.setContractId(12);
        assertThat(MeterTimeline.diff(x, y)).containsExactly("contractId");
    }
}
