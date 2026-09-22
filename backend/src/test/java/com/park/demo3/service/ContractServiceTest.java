package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.time.LocalDate; import java.util.List;
import com.park.demo3.common.BizException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ContractServiceTest {
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    TenantMapper   tm = Mockito.mock(TenantMapper.class);
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    UnitMapper     um = Mockito.mock(UnitMapper.class);
    ContractBillingTermMapper btm = Mockito.mock(ContractBillingTermMapper.class);
    ContractUnitMapper cum = Mockito.mock(ContractUnitMapper.class);
    BillingTermUnitMapper btum = Mockito.mock(BillingTermUnitMapper.class);
    ContractService svc = new ContractService(cm, tm, bm, um, btm, cum, btum);

    // --- helpers ---
    Tenant tenant(int id) {
        Tenant t = new Tenant(); t.setId(id); t.setCompanyName("T"+id);
        t.setContactName("联系人"); t.setContactPhone("13800000000");
        t.setBusinessType("精密机械"); t.setStatus(1); return t;
    }
    Building building(int id, String name) {
        Building b = new Building(); b.setId(id); b.setName(name); return b;
    }
    Unit unit(int id, int floor, String no) {
        Unit u = new Unit(); u.setId(id); u.setFloor(floor); u.setUnitNo(no); return u;
    }
    Contract contract(int id, int tid, int bid, Integer uid, String status,
                      LocalDate start, LocalDate end, double rent) {
        Contract c = new Contract();
        c.setId(id); c.setContractNo("C-"+id); c.setTenantId(tid); c.setBuildingId(bid);
        c.setUnitId(uid); c.setStatus(status); c.setStartDate(start); c.setEndDate(end);
        c.setMonthlyRent(BigDecimal.valueOf(rent)); c.setDeposit(BigDecimal.valueOf(rent*3));
        c.setRentArea(BigDecimal.valueOf(200)); return c;
    }

    @Test void list_derivesTenantNameBuildingNameFloorInfoTermMonthsDaysToEnd() {
        LocalDate start = LocalDate.of(2023, 1, 1);
        LocalDate end   = LocalDate.of(2025, 1, 1);  // 24 months
        Contract ct = contract(1, 1, 7, 3, "active", start, end, 8000);
        Mockito.when(cm.selectList(null)).thenReturn(List.of(ct));
        // 三个名字字典已按 all 里出现的 id 收敛(in 查),不再是 selectList(null) → 用 any() 匹配
        Mockito.when(tm.selectList(Mockito.any())).thenReturn(List.of(tenant(1)));
        Mockito.when(bm.selectList(Mockito.any())).thenReturn(List.of(building(7, "一期A栋")));
        Mockito.when(um.selectList(Mockito.any())).thenReturn(List.of(unit(3, 3, "301")));

        List<ContractDTO> result = svc.list(null);
        assertThat(result).hasSize(1);
        ContractDTO d = result.get(0);
        assertThat(d.tenantName()).isEqualTo("T1");
        assertThat(d.buildingName()).isEqualTo("一期A栋");
        assertThat(d.floorInfo()).isEqualTo("3F-301");
        assertThat(d.termMonths()).isEqualTo(24);
        assertThat(d.startDate()).isEqualTo("2023-01-01");
        assertThat(d.endDate()).isEqualTo("2025-01-01");
        assertThat(d.status()).isEqualTo("expired");   // V54:存储 active + endDate 2025(已过)→ 派生 expired(§5.1)
        // daysToEnd: relative to today; just assert it is non-null and a meaningful past value
        assertThat(d.daysToEnd()).isNotNull();
    }

    @Test void list_draftContractHasNullDaysToEndWhenNoDates() {
        Contract ct = contract(2, 1, 7, null, "draft", null, null, 0);
        Mockito.when(cm.selectList(null)).thenReturn(List.of(ct));
        Mockito.when(tm.selectList(null)).thenReturn(List.of(tenant(1)));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(building(7, "A")));
        Mockito.when(um.selectList(null)).thenReturn(List.of());

        ContractDTO d = svc.list(null).get(0);
        assertThat(d.termMonths()).isEqualTo(0);
        assertThat(d.daysToEnd()).isNull();
        assertThat(d.floorInfo()).isEmpty();
    }

    @Test void summary_aggregatesCorrectly() {
        // V54:计数改用 endDate 派生桶(§5.1)。存储态全 active,由 endDate 派生 active/expiring/expired。
        LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
        LocalDate s = today.minusYears(1);
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            contract(1,1,7,null,"active", s, today.plusYears(2),  8000),  // 远期 → active
            contract(2,2,7,null,"active", s, today.plusDays(30),  5000),  // ≤90天 → expiring
            contract(3,3,7,null,"draft",  null, null,             0),      // draft
            contract(4,4,7,null,"active", s, today.minusDays(1),  9999)    // 已过 → expired,不计
        ));
        ContractSummaryDTO sum = svc.summary();
        assertThat(sum.total()).isEqualTo(4);
        assertThat(sum.contractActive()).isEqualTo(1);
        assertThat(sum.contractExpiring()).isEqualTo(1);
        assertThat(sum.contractDraft()).isEqualTo(1);
        // monthlyRent = active+expiring only
        assertThat(sum.monthlyRent()).isEqualByComparingTo("13000");
    }

    @Test void detail_returnsTenantSnap() {
        LocalDate s = LocalDate.of(2024,1,1), e = LocalDate.of(2026,1,1);
        Contract ct = contract(1,1,7,3,"active",s,e,8000);
        Mockito.when(cm.selectById(1)).thenReturn(ct);
        Mockito.when(tm.selectById(1)).thenReturn(tenant(1));
        // detail 单合同路径改按 id 点查楼栋/单元(同 dtoOf),故 stub 也从全表改点查
        Mockito.when(bm.selectById(7)).thenReturn(building(7,"一期A栋"));
        Mockito.when(um.selectById(3)).thenReturn(unit(3,3,"301"));

        ContractDetailDTO d = svc.detail(1);
        assertThat(d.contract().tenantName()).isEqualTo("T1");
        assertThat(d.contract().buildingName()).isEqualTo("一期A栋");
        assertThat(d.tenant().companyName()).isEqualTo("T1");
        assertThat(d.tenant().status()).isEqualTo(1);
        assertThat(d.tenant().businessType()).isEqualTo("精密机械");
    }

    // --- 附加单元校验(多场地合同录入通道) ---
    ContractCreateReq reqWithExtras(Integer unitId, List<Integer> extraUnitIds) {
        return new ContractCreateReq("C-NEW", 1, 13, unitId, extraUnitIds,
            null, null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, "active", null, null, null, null, null, null);
    }

    @Test void create_rejectsExtraUnitEqualToMainUnit() {
        Mockito.when(tm.selectById(1)).thenReturn(tenant(1));
        Mockito.when(bm.selectById(13)).thenReturn(building(13, "一期A座"));
        Unit u = unit(390, 2, "203"); u.setBuildingId(13);
        Mockito.when(um.selectById(390)).thenReturn(u);
        assertThatThrownBy(() -> svc.create(reqWithExtras(390, List.of(390))))
            .isInstanceOf(BizException.class).hasMessageContaining("附加单元不能与主单元重复");
    }

    @Test void create_allowsCrossBuildingExtraUnit() {
        // S15:附加单元放开跨栋(宿舍527式),单元存在即可保存
        Mockito.when(tm.selectById(1)).thenReturn(tenant(1));
        Mockito.when(bm.selectById(13)).thenReturn(building(13, "一期A座"));
        Unit other = unit(555, 6, "61"); other.setBuildingId(31);   // 二期栋的单元(跨栋)
        Mockito.when(um.selectById(555)).thenReturn(other);
        Contract[] saved = new Contract[1];
        Mockito.when(cm.insert(Mockito.any(Contract.class))).thenAnswer(inv -> {
            saved[0] = inv.getArgument(0); saved[0].setId(99); return 1;
        });
        Mockito.when(cm.selectById(99)).thenAnswer(inv -> saved[0]);

        ContractDTO d = svc.create(reqWithExtras(null, List.of(555)));
        assertThat(d.id()).isEqualTo(99);
        Mockito.verify(cum).insert(Mockito.argThat((ContractUnit x) -> x.getUnitId() == 555));
    }

    @Test void create_rejectsExtraUnitNotExists() {
        // 放开的只是跨栋;不存在的单元仍拒绝
        Mockito.when(tm.selectById(1)).thenReturn(tenant(1));
        Mockito.when(bm.selectById(13)).thenReturn(building(13, "一期A座"));
        assertThatThrownBy(() -> svc.create(reqWithExtras(null, List.of(777))))
            .isInstanceOf(BizException.class).hasMessageContaining("附加单元不存在");
    }

    // ── 终止:解约日收进 end_date(2026-09-23) ───────────────────────────────
    // ⚠ 这几条钉的不是「哪一列被写了」,是「终止之后出账还认不认这个月」。
    //   出账那一侧唯一的判据是 MeterBindingService.covers(非草稿 + 起止齐全 + 月区间重叠),
    //   它不看 status —— 所以只写 status 的终止在出账链上等于没发生。断言直接调 covers 本人。
    private Contract terminateAndCapture(Contract c, LocalDate on) {
        Mockito.when(cm.selectById(c.getId())).thenReturn(c);
        svc.terminate(c.getId(), on);
        Mockito.verify(cm).updateById(c);
        return c;
    }

    @Test void terminate_解约日收进到期日_解约当月还算这个月之后不算() {
        Contract c = contract(1, 1, 7, null, "active",
            LocalDate.of(2026, 1, 1), LocalDate.of(2028, 12, 31), 8000);
        terminateAndCapture(c, LocalDate.of(2026, 6, 15));

        assertThat(c.getStatus()).isEqualTo("terminated");
        assertThat(c.getEndDate()).isEqualTo(LocalDate.of(2026, 6, 15));
        // 解约当月:人确实在租过半个月,照出(金额由 prorate 按天折)
        assertThat(MeterBindingService.covers(c, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30))).isTrue();
        // 次月起:不再命中 —— 这就是原来那个「终止了还出满月租金」的口子
        assertThat(MeterBindingService.covers(c, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31))).isFalse();
        // 解约之前的月份一个字不变(所以修法不是去 covers 里排 terminated)
        assertThat(MeterBindingService.covers(c, LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28))).isTrue();
    }

    @Test void terminate_解约日晚于到期日_不把到期日往后推() {
        Contract c = contract(2, 1, 7, null, "active",
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31), 8000);
        terminateAndCapture(c, LocalDate.of(2026, 9, 9));   // 已自然到期后才来补状态
        assertThat(c.getEndDate()).isEqualTo(LocalDate.of(2026, 3, 31));
    }

    @Test void terminate_不传解约日_取今天() {
        Contract c = contract(3, 1, 7, null, "active",
            LocalDate.of(2000, 1, 1), LocalDate.of(2099, 12, 31), 8000);
        terminateAndCapture(c, null);
        assertThat(c.getEndDate()).isEqualTo(LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")));
    }

    @Test void terminate_解约日早于起租_拒绝() {
        Contract c = contract(4, 1, 7, null, "active",
            LocalDate.of(2026, 1, 1), LocalDate.of(2028, 12, 31), 8000);
        Mockito.when(cm.selectById(4)).thenReturn(c);
        assertThatThrownBy(() -> svc.terminate(4, LocalDate.of(2025, 12, 31)))
            .isInstanceOf(BizException.class).hasMessageContaining("终止日期不能早于起租日期");
        Mockito.verify(cm, Mockito.never()).updateById(Mockito.any(Contract.class));
    }

    // ── 续签继承合同性质(2026-09-23) ──────────────────────────────────────
    // ⚠ 「整租」这一列页面上改不了(V59 起只有一条 SQL 写过它),所以续签漏抄 = 永久丢失。
    //   丢了之后六处「排除整租防双算」同时失效:KPI 月租金合计、楼栋卡三项、租金行、容量费、分析屏两处。
    //   破坏验证:把 renew 里的 setKind 删掉 → 本行红。
    @Test void renew_继承整租标记() {
        Contract old = contract(5, 1, 7, null, "active",
            LocalDate.of(2023, 5, 1), LocalDate.of(2024, 2, 29), 1808871.63);
        old.setKind("master_lease");
        Mockito.when(cm.selectById(5)).thenReturn(old);
        Mockito.when(cm.selectList(Mockito.any())).thenReturn(List.of());   // 合同号查重
        Mockito.when(btm.selectList(Mockito.any())).thenReturn(List.of());  // 无计费行可复制
        Contract[] saved = new Contract[1];
        Mockito.when(cm.insert(Mockito.any(Contract.class))).thenAnswer(inv -> {
            saved[0] = inv.getArgument(0); saved[0].setId(77); return 1;
        });
        Mockito.when(cm.selectById(77)).thenAnswer(inv -> saved[0]);

        svc.renew(5, new ContractRenewReq("IT-RENEW-KIND", LocalDate.of(2024, 3, 1),
            LocalDate.of(2025, 2, 28), null, null, null, null));

        assertThat(saved[0].getKind()).isEqualTo("master_lease");
        assertThat(saved[0].getParentContractId()).isEqualTo(5);
        assertThat(old.getStatus()).isEqualTo("renewed");
    }
}
