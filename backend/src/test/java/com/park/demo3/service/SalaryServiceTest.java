package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.SalaryOverviewDTO;
import com.park.demo3.dto.SalaryRecordDTO;
import com.park.demo3.dto.SalaryYearMonthDTO;
import com.park.demo3.entity.SalaryRecord;
import com.park.demo3.mapper.SalaryRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SalaryServiceTest {
    SalaryRecordMapper records = Mockito.mock(SalaryRecordMapper.class);
    SalaryService svc = new SalaryService(records);

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

    @Test void delete_seedRow_conflicts() {
        Mockito.when(records.selectById(7)).thenReturn(zhouming(7)); // source=seed
        assertThatThrownBy(() -> svc.delete(7)).isInstanceOf(BizException.class);
        Mockito.verify(records, Mockito.never()).deleteById(Mockito.anyInt());
    }

    @Test void delete_manualRow_ok() {
        SalaryRecord m = zhouming(8); m.setSource("manual");
        Mockito.when(records.selectById(8)).thenReturn(m);
        svc.delete(8);
        Mockito.verify(records).deleteById(8);
    }
}
