package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.SalaryImportRequest;
import com.park.demo3.dto.SalaryOverviewDTO;
import com.park.demo3.dto.SalaryRecordDTO;
import com.park.demo3.dto.SalaryYearMonthDTO;
import com.park.demo3.entity.SalaryRecord;
import com.park.demo3.mapper.SalaryRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SalaryServiceTest {
    SalaryRecordMapper records = Mockito.mock(SalaryRecordMapper.class);
        // 审核闸(R1 T7)在这一层不是被测对象:桩掉,让这些用例继续只钉派生/归一口径
    com.park.demo3.security.ReviewGuard rg = Mockito.mock(com.park.demo3.security.ReviewGuard.class);
SalaryService svc = new SalaryService(records, rg);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    // 周明 2026-01 种子行:base12000 post6000 perf3800 attend300 skill1200 edu800 other0
    //   lunch400 heat0 commission0 should21 leave0 social1860 tax1040 otherDeduct0
    SalaryRecord zhouming(int id) {
        SalaryRecord r = new SalaryRecord();
        r.setId(id); r.setAcctMonth("2026-01"); r.setEmpIdx(1); r.setName("周明"); r.setRole("总经理");
        r.setBase(bd(12000)); r.setPost(bd(6000)); r.setPerf(bd(3800)); r.setAttend(bd(300));
        r.setSkill(bd(1200)); r.setEdu(bd(800)); r.setOther(bd(0));
        r.setLunch(bd(400)); r.setHeat(bd(0)); r.setCommission(bd(0));
        r.setShouldDays(21); r.setLeaveDays(0);
        r.setSocial(bd(1860)); r.setTax(bd(1040)); r.setOtherDeduct(bd(0));
        r.setSign(true); r.setSource("seed");
        return r;
    }
    // 赵丽娜 2026-05:leave2 → attend0,fullAttend false,actualDays 21-2=19,sign false
    SalaryRecord zhaolina(int id) {
        SalaryRecord r = new SalaryRecord();
        r.setId(id); r.setAcctMonth("2026-05"); r.setEmpIdx(6); r.setName("赵丽娜"); r.setRole("物业主管");
        r.setBase(bd(6500)); r.setPost(bd(2600)); r.setPerf(bd(2500)); r.setAttend(bd(0));
        r.setSkill(bd(700)); r.setEdu(bd(600)); r.setOther(bd(0));
        r.setLunch(bd(400)); r.setHeat(bd(0)); r.setCommission(bd(0));
        r.setShouldDays(21); r.setLeaveDays(2);
        r.setSocial(bd(1040)); r.setTax(bd(330)); r.setOtherDeduct(bd(0));
        r.setSign(false); r.setSource("seed");
        return r;
    }

    @Test void records_derivesPerRowAndTotals() {
        // 该月两行(选不同月份无碍,records 只回放 selectByMonth)
        Mockito.when(records.selectByMonth("2026-01")).thenReturn(List.of(zhouming(1), zhaolina(2)));

        SalaryYearMonthDTO y = svc.records(2026, 1);
        assertThat(y.year()).isEqualTo(2026);
        assertThat(y.month()).isEqualTo(1);
        assertThat(y.rows()).hasSize(2);

        // 周明派生:wage = 12000+6000+3800+300+1200+800+0 = 24100
        //          gross = 24100+400+0+0 = 24500;deduct = 1860+1040+0 = 2900;net = 21600
        //          actualDays = 21-0 = 21;fullAttend = true
        SalaryRecordDTO zm = y.rows().get(0);
        assertThat(zm.name()).isEqualTo("周明");
        assertThat(zm.wageTotal()).isEqualByComparingTo("24100.00");
        assertThat(zm.gross()).isEqualByComparingTo("24500.00");
        assertThat(zm.deduct()).isEqualByComparingTo("2900.00");
        assertThat(zm.net()).isEqualByComparingTo("21600.00");
        assertThat(zm.actualDays()).isEqualTo(21);
        assertThat(zm.fullAttend()).isTrue();

        // 赵丽娜:wage = 6500+2600+2500+0+700+600 = 12900;gross = 13300;deduct = 1370;net = 11930
        //        actualDays = 19;fullAttend = false(leave 2)
        SalaryRecordDTO zl = y.rows().get(1);
        assertThat(zl.wageTotal()).isEqualByComparingTo("12900.00");
        assertThat(zl.gross()).isEqualByComparingTo("13300.00");
        assertThat(zl.deduct()).isEqualByComparingTo("1370.00");
        assertThat(zl.net()).isEqualByComparingTo("11930.00");
        assertThat(zl.actualDays()).isEqualTo(19);
        assertThat(zl.fullAttend()).isFalse();

        // 合计 = 两行之和
        SalaryYearMonthDTO.Total t = y.total();
        assertThat(t.wageTotal()).isEqualByComparingTo("37000.00"); // 24100+12900
        assertThat(t.gross()).isEqualByComparingTo("37800.00");     // 24500+13300
        assertThat(t.deduct()).isEqualByComparingTo("4270.00");     // 2900+1370
        assertThat(t.net()).isEqualByComparingTo("33530.00");       // 21600+11930
        assertThat(t.base()).isEqualByComparingTo("18500.00");      // 12000+6500
        assertThat(t.commission()).isEqualByComparingTo("0.00");
    }

    @Test void overview_yearRangeBaseToMaxPlusOne_currentYearIsMaxData() {
        // 数据跨 2025..2026 → 范围 [2024..2027],currentYear = 2026
        Mockito.when(records.selectList(null)).thenReturn(List.of(
            zhouming(1),          // 2026-01
            zhaolina(2),          // 2026-05
            rec25Dec(3)));        // 2025-12

        SalaryOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.years()).extracting(SalaryOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025, 2026, 2027);

        SalaryOverviewDTO.YearMeta y24 = ov.years().get(0);
        assertThat(y24.hasData()).isFalse();
        assertThat(y24.count()).isEqualTo(0);
        assertThat(y24.netTotal()).isEqualByComparingTo("0.00");
        assertThat(y24.months()).isEmpty();

        SalaryOverviewDTO.YearMeta y25 = ov.years().get(1);
        assertThat(y25.hasData()).isTrue();
        assertThat(y25.count()).isEqualTo(1);
        assertThat(y25.months()).containsExactly(12);

        // 2026 两行,月份去重升序 [1,5]
        SalaryOverviewDTO.YearMeta y26 = ov.years().get(2);
        assertThat(y26.hasData()).isTrue();
        assertThat(y26.count()).isEqualTo(2);
        assertThat(y26.months()).containsExactly(1, 5);
        assertThat(y26.netTotal()).isEqualByComparingTo("33530.00"); // 21600 + 11930

        SalaryOverviewDTO.YearMeta y27 = ov.years().get(3);
        assertThat(y27.hasData()).isFalse();
        assertThat(y27.count()).isEqualTo(0);
    }

    // 一条 2025-12 行(周明 12月:perf4200,tax1040),仅供 overview 年份测试
    SalaryRecord rec25Dec(int id) {
        SalaryRecord r = zhouming(id);
        r.setAcctMonth("2025-12"); r.setPerf(bd(4200)); r.setShouldDays(23);
        return r;
    }

    // seed 不再锁删:种子行与手动行同等可删(WI-4 去保护)。
    @Test void delete_seedRow_succeeds() {
        Mockito.when(records.selectById(7)).thenReturn(zhouming(7)); // source=seed
        svc.delete(7);
        Mockito.verify(records).deleteById(7);
    }

    @Test void delete_manualRow_ok() {
        SalaryRecord m = zhouming(8); m.setSource("manual");
        Mockito.when(records.selectById(8)).thenReturn(m);
        svc.delete(8);
        Mockito.verify(records).deleteById(8);
    }

    // 导入:role 文本透传入库;考勤含小数 → 四舍五入取整(请假 2.125→2、0.5→1);姓名空 → errors 跳过。
    @Test void importRows_passesRoleText_andRoundsDays() {
        SalaryImportRequest.Row huangqi = new SalaryImportRequest.Row(
            "黄琦", "见习经理（03）",
            bd(1900), bd(3000), bd(1600), bd(200), bd(300), null, null,
            bd(180), null, null,
            bd(18), bd(2.125),                 // 应出勤18、请假2.125
            bd(487.05), bd(78.61), null);
        SalaryImportRequest.Row fu = new SalaryImportRequest.Row(
            "符俊熙", "见习经理（03）",
            bd(2080), bd(3000), bd(1120), bd(200), bd(300), bd(300), null,
            bd(168), null, null,
            bd(20), bd(0.5),                   // 请假0.5 → 1
            bd(487.05), bd(46.96), null);
        SalaryImportRequest.Row blank = new SalaryImportRequest.Row(
            "  ", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);

        Mockito.when(records.deleteImported("2025-01")).thenReturn(0);
        ImportResultDTO res = svc.importRows(2025, 1, new SalaryImportRequest(List.of(huangqi, fu, blank)));

        assertThat(res.imported()).isEqualTo(2);
        assertThat(res.skipped()).isEqualTo(1);  // 姓名空跳过

        ArgumentCaptor<SalaryRecord> cap = ArgumentCaptor.forClass(SalaryRecord.class);
        Mockito.verify(records, Mockito.times(2)).insert(cap.capture());
        List<SalaryRecord> ins = cap.getAllValues();

        SalaryRecord r0 = ins.get(0);
        assertThat(r0.getName()).isEqualTo("黄琦");
        assertThat(r0.getRole()).isEqualTo("见习经理（03）");  // role 文本入库,非 null/非数字化
        assertThat(r0.getSource()).isEqualTo("import");
        assertThat(r0.getShouldDays()).isEqualTo(18);
        assertThat(r0.getLeaveDays()).isEqualTo(2);            // 2.125 → 2(HALF_UP)

        SalaryRecord r1 = ins.get(1);
        assertThat(r1.getName()).isEqualTo("符俊熙");
        assertThat(r1.getRole()).isEqualTo("见习经理（03）");
        assertThat(r1.getLeaveDays()).isEqualTo(1);            // 0.5 → 1(HALF_UP)
    }
}
