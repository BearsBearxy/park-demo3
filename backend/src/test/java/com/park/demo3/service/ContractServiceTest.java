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
}
