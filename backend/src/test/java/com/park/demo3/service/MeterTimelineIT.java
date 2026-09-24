package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.BillNoticeLine;
import com.park.demo3.entity.DataChangeLog;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterArchiveLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.BillNoticeLineMapper;
import com.park.demo3.mapper.BillNoticeMapper;
import com.park.demo3.mapper.DataChangeLogMapper;
import com.park.demo3.mapper.MeterArchiveLogMapper;
import com.park.demo3.mapper.MeterAssignMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.park.demo3.mapper.ReviewStateMapper;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.security.ReviewKey;
import com.park.demo3.security.ReviewKind;
import com.park.demo3.service.MeterTimelineService.Ctx;
import com.park.demo3.service.MeterTimelineService.Frozen;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// METER-TIMELINE-SPEC §3.1 §4 的落库面:写一行不碰别行、前后像、需重算月份、冻结两个来源。
// @Transactional 回滚;独占 2086 年(全仓测试无人用)。setUp 给自建表落 2086-01 / 2086-12 两条读数,
// 保证「库里最早已生成月 ≤ 2086-01」「最大已生成月 ≥ 2086-12」,需重算月份不被裁、链尾不退化。
@org.springframework.transaction.annotation.Transactional
class MeterTimelineIT extends AbstractMysqlIT {

    @Autowired MeterTimelineService svc;
    @Autowired MeterMapper meters;
    @Autowired MeterReadingMapper readings;
    @Autowired MeterAssignMapper assigns;
    @Autowired MeterArchiveLogMapper archive;
    @Autowired DataChangeLogMapper changes;
    @Autowired ReviewStateMapper reviewStates;
    @Autowired TenantMapper tenants;
    @Autowired BillNoticeMapper notices;
    @Autowired BillNoticeLineMapper lines;
    @Autowired ObjectMapper json;

    private static final Ctx MANUAL = Ctx.of("manual");
    private int meterId;

    @BeforeEach
    void setUp() {
        meterId = newMeter();
        for (String ym : List.of("2086-01", "2086-12")) {
            MeterReading r = new MeterReading();
            r.setMeterId(meterId); r.setYm(ym); r.setPrevTotal(BigDecimal.ZERO); r.setCurrTotal(BigDecimal.TEN);
            readings.insert(r);
        }
    }

    private int newMeter() {
        Meter m = new Meter();
        m.setKind("elec"); m.setZone("p1"); m.setName("IT时间线" + System.nanoTime()); m.setFactor(BigDecimal.ONE);
        meters.insert(m);
        return m.getId();
    }

    private MeterAssign row(String from, String tenant) {
        MeterAssign a = new MeterAssign();
        a.setMeterId(meterId); a.setFromYm(from); a.setTenantName(tenant); a.setOwnership("tenant");
        return a;
    }

    private long lastChangeId() {
        DataChangeLog l = changes.selectOne(new QueryWrapper<DataChangeLog>().orderByDesc("id").last("limit 1"));
        return l == null ? 0 : l.getId();
    }

    private List<String> changedSince(long id) {
        return changes.selectList(new QueryWrapper<DataChangeLog>().gt("id", id).orderByAsc("ym"))
            .stream().map(DataChangeLog::getYm).toList();
    }

    private List<MeterArchiveLog> logs() {
        return archive.selectList(new QueryWrapper<MeterArchiveLog>().eq("meter_id", meterId).orderByAsc("id"));
    }

    private String field(String j, String name) throws Exception {
        return json.readTree(j).get(name).asText();
    }

    // §3.1 写一行不碰别行 + R4:A@2086-02 B@2086-05 C@2086-09,改 B 穿不过 C,改 A 不影响 2086-05 起
    @Test
    void writeOneRow_leavesOtherRows_andStopsAtNextRow() {
        svc.writeAssign(row("2086-02", "甲"), MANUAL);
        svc.writeAssign(row("2086-05", "乙"), MANUAL);
        svc.writeAssign(row("2086-09", "丙"), MANUAL);
        List<MeterAssign> before = svc.rows(meterId).assign();

        long mark = lastChangeId();
        svc.writeAssign(row("2086-05", "乙改"), MANUAL);
        List<MeterAssign> after = svc.rows(meterId).assign();
        assertThat(after).hasSize(3);
        assertThat(after.get(0)).isEqualTo(before.get(0));
        assertThat(after.get(2)).isEqualTo(before.get(2));
        assertThat(after.get(1).getTenantName()).isEqualTo("乙改");
        assertThat(changedSince(mark)).containsExactly("2086-05", "2086-06", "2086-07", "2086-08");

        mark = lastChangeId();
        svc.writeAssign(row("2086-02", "甲改"), MANUAL);
        assertThat(changedSince(mark)).containsExactly("2086-02", "2086-03", "2086-04");

        assertThat(svc.viewAt("2086-04").assign(meterId).getTenantName()).isEqualTo("甲改");
        assertThat(svc.viewAt("2086-05").assign(meterId).getTenantName()).isEqualTo("乙改");
        assertThat(svc.viewAt("2086-08").assign(meterId).getTenantName()).isEqualTo("乙改");
        assertThat(svc.viewAt("2086-09").assign(meterId).getTenantName()).isEqualTo("丙");
        assertThat(svc.latest().assign(meterId).getTenantName()).isEqualTo("丙");
        assertThat(svc.viewAt("2086-08").status(meterId)).isNull();          // 没有状态行 = 不在册
    }

    // 同一事务里:rows() / viewAt() 拿到的行改了再交给 writeAssign,必须真落库。
    // MyBatis 一级缓存对同一句查询回同一批对象 —— 给的若不是副本,writeAssign 查出的「旧行」就是被改过的
    // 同一个对象,判成一格没变直接返回(A2 实测:绑定合同整个没落库,接口照样回 0)。
    @Test
    void rowsHandedOutAreCopies_mutateThenWritePersists() {
        svc.writeAssign(row("2086-02", "甲"), MANUAL);
        MeterAssign a = svc.rows(meterId).assign().get(0);
        a.setTenantName("甲改");
        svc.writeAssign(a, MANUAL);
        assertThat(assigns.selectById(a.getId()).getTenantName()).isEqualTo("甲改");

        // 一个调用方改了自己拿到的 View,同一事务里下一次 viewAt 不许看见这个没落库的改动
        svc.viewAt("2086-03").assign(meterId).setTenantName("没落库的改动");
        assertThat(svc.viewAt("2086-03").assign(meterId).getTenantName()).isEqualTo("甲改");
    }

    // §1.4 前后像:插入无前像,更新前后各一份;ctx 的来源 / 批次 / 文件 / 行 / 操作人全落;值没变的写不留底
    @Test
    void archiveLog_keepsBeforeAndAfter() throws Exception {
        Ctx ctx = new Ctx("import", "batch-it-1", "2086年3月抄表.xlsx", "一期电!12", "it-user");
        svc.writeAssign(row("2086-03", "甲"), ctx);
        svc.writeAssign(row("2086-03", "乙"), ctx);
        svc.writeAssign(row("2086-03", "乙"), ctx);   // 一格没变

        List<MeterArchiveLog> ls = logs();
        assertThat(ls).hasSize(2);
        MeterArchiveLog ins = ls.get(0), upd = ls.get(1);
        assertThat(ins.getAction()).isEqualTo("insert");
        assertThat(ins.getTbl()).isEqualTo("assign");
        assertThat(ins.getFromYm()).isEqualTo("2086-03");
        assertThat(ins.getBeforeJson()).isNull();
        assertThat(field(ins.getAfterJson(), "tenantName")).isEqualTo("甲");
        assertThat(upd.getAction()).isEqualTo("update");
        assertThat(field(upd.getBeforeJson(), "tenantName")).isEqualTo("甲");
        assertThat(field(upd.getAfterJson(), "tenantName")).isEqualTo("乙");
        assertThat(field(upd.getAfterJson(), "src")).isEqualTo("import");
        assertThat(upd.getSrc()).isEqualTo("import");
        assertThat(upd.getBatchId()).isEqualTo("batch-it-1");
        assertThat(upd.getFileName()).isEqualTo("2086年3月抄表.xlsx");
        assertThat(upd.getRowRef()).isEqualTo("一期电!12");
        assertThat(upd.getOperator()).isEqualTo("it-user");
        assertThat(upd.getAt()).isNotNull();
    }

    // §3.1 需重算月份:链尾取到最大已生成月;中间段只到下一行前;删一行记它原来那段;src=migrate 留底但不记
    @Test
    void statusWrites_recordAffectedMonths() throws Exception {
        String maxGen = svc.maxGeneratedYm();
        assertThat(maxGen).isGreaterThanOrEqualTo("2086-12");

        long mark = lastChangeId();
        svc.writeStatus(meterId, "2086-02", "active", MANUAL);
        List<String> tail = changedSince(mark);
        assertThat(tail).first().isEqualTo("2086-02");
        assertThat(tail).last().isEqualTo(maxGen);
        assertThat(tail).contains("2086-12").hasSize(MeterTimeline.affectedMonths("2086-02", null, maxGen).size());

        svc.writeStatus(meterId, "2086-07", "removed", MANUAL);
        mark = lastChangeId();
        svc.writeStatus(meterId, "2086-02", "retired", MANUAL);
        assertThat(changedSince(mark)).containsExactly("2086-02", "2086-03", "2086-04", "2086-05", "2086-06");
        assertThat(svc.viewAt("2086-06").status(meterId).getStatus()).isEqualTo("retired");
        assertThat(svc.viewAt("2086-07").status(meterId).getStatus()).isEqualTo("removed");
        assertThat(svc.viewAt("2086-01").status(meterId)).isNull();

        mark = lastChangeId();
        svc.deleteStatus(meterId, "2086-07", MANUAL);
        assertThat(changedSince(mark)).first().isEqualTo("2086-07");
        assertThat(changedSince(mark)).last().isEqualTo(maxGen);
        MeterArchiveLog del = logs().get(logs().size() - 1);
        assertThat(del.getAction()).isEqualTo("delete");
        assertThat(field(del.getBeforeJson(), "status")).isEqualTo("removed");
        assertThat(del.getAfterJson()).isNull();
        assertThat(svc.viewAt("2086-08").status(meterId).getStatus()).isEqualTo("retired");

        int logged = logs().size();
        mark = lastChangeId();
        svc.writeStatus(meterId, "2086-10", "active", Ctx.of("migrate"));
        assertThat(logs()).hasSize(logged + 1);
        assertThat(changedSince(mark)).isEmpty();
    }

    // 需重算只记库里最早已生成月起的月份:从 1900-01 起生效的一行不落上千条早于任何数据的行
    @Test
    void recordChange_skipsMonthsBeforeAnyData() {
        svc.writeAssign(row("2086-02", "甲"), MANUAL);
        long mark = lastChangeId();
        svc.writeAssign(row("1900-01", "甲"), MANUAL);
        List<String> months = changedSince(mark);
        assertThat(months).first().isEqualTo(assigns.minGeneratedYm());
        assertThat(months).last().isEqualTo("2086-01");
        assertThat(months).doesNotContain("1900-01");
    }

    // §4 冻结两个来源:抄表审核锁(submitted / approved;returned 不锁)∪ 明细含这块表的已确认 / 已导出催缴单
    @Test
    void frozenMonths_reviewLockAndLockedNotices() {
        review("2086-03", "approved");
        review("2086-04", "submitted");
        review("2086-05", "returned");
        int tenantId = newTenant();
        notice(tenantId, "2086-06", "exported", meterId);
        notice(tenantId, "2086-07", "confirmed", meterId);
        notice(tenantId, "2086-08", "draft", meterId);
        notice(tenantId, "2086-09", "exported", newMeter());   // 单里是别的表

        List<String> year = MeterTimeline.affectedMonths("2086-01", null, "2086-12");
        assertThat(svc.frozenMonths(meterId, year)).containsExactly(
            new Frozen("2086-03", "园区抄表已审核"),
            new Frozen("2086-04", "园区抄表待审核"),
            new Frozen("2086-06", "含这块表的催缴单已导出"),
            new Frozen("2086-07", "含这块表的催缴单已确认"));
        assertThat(svc.frozenMonths(meterId, List.of("2086-05", "2086-06"))).extracting(Frozen::ym)
            .containsExactly("2086-06");
    }

    private void review(String ym, String status) {
        ReviewState s = new ReviewState();
        s.setReviewKey(ReviewKey.of(ReviewKind.METERS, null, ym).raw());
        s.setKind(ReviewKind.METERS.code()); s.setPeriod(ym); s.setStatus(status);
        reviewStates.insert(s);
    }

    private int newTenant() {
        Tenant t = new Tenant();
        t.setCompanyName("IT时间线户" + System.nanoTime()); t.setBusinessType("factory");
        tenants.insert(t);
        return t.getId();
    }

    private void notice(int tenantId, String ym, String status, int lineMeterId) {
        BillNotice n = new BillNotice();
        n.setYm(ym); n.setTenantId(tenantId); n.setNoticeKind("combined"); n.setStatus(status);
        n.setTotalAmount(BigDecimal.ZERO); n.setGeneratedAt(LocalDateTime.now());
        notices.insert(n);
        BillNoticeLine l = new BillNoticeLine();
        l.setNoticeId(n.getId()); l.setLineNo(1); l.setFeeKey("elec"); l.setMeterId(lineMeterId); l.setAmount(BigDecimal.ZERO);
        lines.insert(l);
    }
}
