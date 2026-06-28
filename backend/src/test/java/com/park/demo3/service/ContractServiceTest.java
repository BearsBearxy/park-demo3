package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.time.LocalDate; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class ContractServiceTest {
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    TenantMapper   tm = Mockito.mock(TenantMapper.class);
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    UnitMapper     um = Mockito.mock(UnitMapper.class);
    ContractService svc = new ContractService(cm, tm, bm, um);

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
        Mockito.when(tm.selectList(null)).thenReturn(List.of(tenant(1)));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(building(7, "一期A栋")));
        Mockito.when(um.selectList(null)).thenReturn(List.of(unit(3, 3, "301")));

        List<ContractDTO> result = svc.list();
        assertThat(result).hasSize(1);
        ContractDTO d = result.get(0);
        assertThat(d.tenantName()).isEqualTo("T1");
        assertThat(d.buildingName()).isEqualTo("一期A栋");
        assertThat(d.floorInfo()).isEqualTo("3F-301");
        assertThat(d.termMonths()).isEqualTo(24);
        assertThat(d.startDate()).isEqualTo("2023-01-01");
        assertThat(d.endDate()).isEqualTo("2025-01-01");
        assertThat(d.status()).isEqualTo("active");
        // daysToEnd: relative to today; just assert it is non-null and a meaningful past value
        assertThat(d.daysToEnd()).isNotNull();
    }

    @Test void list_draftContractHasNullDaysToEndWhenNoDates() {
        Contract ct = contract(2, 1, 7, null, "draft", null, null, 0);
        Mockito.when(cm.selectList(null)).thenReturn(List.of(ct));
        Mockito.when(tm.selectList(null)).thenReturn(List.of(tenant(1)));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(building(7, "A")));
        Mockito.when(um.selectList(null)).thenReturn(List.of());

        ContractDTO d = svc.list().get(0);
        assertThat(d.termMonths()).isEqualTo(0);
        assertThat(d.daysToEnd()).isNull();
        assertThat(d.floorInfo()).isEmpty();
    }

    @Test void summary_aggregatesCorrectly() {
        LocalDate s = LocalDate.of(2024,1,1), e = LocalDate.of(2026,1,1);
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            contract(1,1,7,null,"active",   s,e,8000),
            contract(2,2,7,null,"expiring", s,e,5000),
            contract(3,3,7,null,"draft",    null,null,0),
            contract(4,4,7,null,"expired",  s,e,9999)
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
        Mockito.when(bm.selectList(null)).thenReturn(List.of(building(7,"一期A栋")));
        Mockito.when(um.selectList(null)).thenReturn(List.of(unit(3,3,"301")));

        ContractDetailDTO d = svc.detail(1);
        assertThat(d.contract().tenantName()).isEqualTo("T1");
        assertThat(d.contract().buildingName()).isEqualTo("一期A栋");
        assertThat(d.tenant().companyName()).isEqualTo("T1");
        assertThat(d.tenant().status()).isEqualTo(1);
        assertThat(d.tenant().businessType()).isEqualTo("精密机械");
    }
}
