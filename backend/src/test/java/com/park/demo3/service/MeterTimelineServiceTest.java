package com.park.demo3.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.entity.DataChangeLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;
import com.park.demo3.mapper.DataChangeLogMapper;
import com.park.demo3.mapper.MeterArchiveLogMapper;
import com.park.demo3.mapper.MeterAssignMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterStatusMapper;
import com.park.demo3.mapper.ReviewStateMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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

    // 整册导入攒批写的「最早已生成月」(MeterTimelineService.Batch,用户 2026-10-05「两个都按你建议」:提速,结果一格不变)。
    // 空库起步的新园区:开批时库里没有已生成月(minGeneratedYm 回 '9999-12'),这时的档案改动永远不会「需重算」,不记;
    // 批中途冲了第一批读数,最早已生成月就是那批里最早的月,之后的改动从它起记 —— 与逐条查库的 recordChange 一样。
    // MeterImportEquivalenceIT 的共享库早有 2076-12 的读数,这一半在那里一直不动,这里不起 Spring 单钉(对抗复查 IMP-T2-harness-mingen)。
    // 破坏验证:readingsWritten 里去掉 minGen 那一行 → 红;Batch.record 的 >= 改成 > → 红
    @Test
    void importBatch_minGeneratedMonth_followsReadingsWrittenInTheBatch() {
        MeterAssignMapper assigns = mock(MeterAssignMapper.class);
        DataChangeLogMapper changes = mock(DataChangeLogMapper.class);
        when(assigns.maxGeneratedYm()).thenReturn("");
        when(assigns.minGeneratedYm()).thenReturn("9999-12");
        List<String> logged = new ArrayList<>();
        when(changes.insertAll(any())).thenAnswer(inv -> {   // flush 传的是攒批列表的视图、随后清空:当场抄下
            List<DataChangeLog> rows = inv.getArgument(0);
            rows.forEach(r -> logged.add(r.getYm()));
            return rows.size();
        });
        MeterTimelineService svc = new MeterTimelineService(assigns, mock(MeterStatusMapper.class), mock(MeterArchiveLogMapper.class),
            changes, mock(ReviewStateMapper.class), new ObjectMapper(), mock(MeterMapper.class));
        MeterTimelineService.Batch b = svc.batch(new MeterTimelineService.Ctx("import", "b1", "册.xlsx", null, "it"));

        b.writeStatus(1, "2024-01", "active", List.of());
        b.flush();
        assertThat(logged).as("库里还没有已生成月就记了需重算").isEmpty();

        b.readingsWritten(List.of("2024-02", "2024-01"));
        b.writeStatus(2, "2023-12", "active", List.of());   // 早于最早已生成月的 2023-12 不记;正好是它的 2024-01 要记
        b.flush();
        assertThat(logged).containsExactly("2024-01", "2024-02");
    }
}
