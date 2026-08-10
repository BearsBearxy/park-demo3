package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.util.List; import java.util.Map; import java.util.Set;
import static org.assertj.core.api.Assertions.assertThat;

class BuildingServiceTest {
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    UnitMapper um = Mockito.mock(UnitMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    com.park.demo3.mapper.TenantMapper tm = Mockito.mock(com.park.demo3.mapper.TenantMapper.class);
    com.park.demo3.mapper.ContractUnitMapper cum = Mockito.mock(com.park.demo3.mapper.ContractUnitMapper.class);
    ContractBillingTermMapper btm = Mockito.mock(ContractBillingTermMapper.class);
    BillingTermUnitMapper btum = Mockito.mock(BillingTermUnitMapper.class);
    BuildingService svc = new BuildingService(bm, um, cm, tm, cum, btm, btum);

    Building b(int id,int phase,int status,double rentable){ Building x=new Building();
        x.setId(id);x.setName("B"+id);x.setPhase(phase);x.setFloorCount(1);
        x.setTotalArea(BigDecimal.valueOf(rentable));x.setRentableArea(BigDecimal.valueOf(rentable));
        x.setStatus(status);x.setPerFloor(2);return x; }
    Unit u(int id,int bid,double area){ Unit x=new Unit(); x.setId(id);x.setBuildingId(bid);
        x.setFloor(1);x.setUnitNo(""+id);x.setArea(BigDecimal.valueOf(area));return x; }
    Contract c(int id,int bid,int uid,int tid,String st,double rent){ Contract x=new Contract();
        x.setId(id);x.setBuildingId(bid);x.setUnitId(uid);x.setTenantId(tid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.ZERO);return x; }
    ContractBillingTerm line(int id,int cid,String feeKey,double area){ ContractBillingTerm t=new ContractBillingTerm();
        t.setId(id);t.setContractId(cid);t.setFeeKey(feeKey);t.setArea(BigDecimal.valueOf(area));
        t.setLocation("主");return t; }
    BillingTermUnit bind(int termId,int unitId){ BillingTermUnit b=new BillingTermUnit();
        b.setTermId(termId);b.setUnitId(unitId);b.setSource("derived");return b; }

    @Test void occRateAreaBased_includesReserved_capsAndZerosStopped() {
        // S15 面积改合同派生(unit.area 全库为 0 不再可用):
        // 楼栋1 rentable 1000,occupied(合同行300)+expiring(合同行200)+reserved(draft 无行=0)+vacant → leased=500 → 50.0%
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000), b(2,1,0,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(
            u(11,1,0), u(12,1,0), u(13,1,0), u(14,1,0), u(21,2,0)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(101,1,11,1,"active",8000), c(102,1,12,2,"expiring",5000), c(103,1,13,3,"draft",0),
            c(104,2,21,4,"active",4000))); // 楼栋2 停用 → occRate 0
        Mockito.when(btm.selectList(null)).thenReturn(List.of(
            line(1,101,"rent_factory",300), line(2,102,"rent_factory",200)));
        List<BuildingDTO> r = svc.list();
        BuildingDTO d1 = r.stream().filter(x->x.id()==1).findFirst().orElseThrow();
        assertThat(d1.leasedArea()).isEqualByComparingTo("500");
        assertThat(d1.occRate()).isEqualTo(50.0);
        assertThat(d1.occupiedCount()).isEqualTo(2);   // occupied + expiring
        assertThat(d1.vacantCount()).isEqualTo(1);
        assertThat(d1.reservedCount()).isEqualTo(1);
        assertThat(d1.monthlyRent()).isEqualByComparingTo("13000"); // active+expiring
        assertThat(d1.tenantIds()).containsExactlyInAnyOrder(1,2);
        BuildingDTO d2 = r.stream().filter(x->x.id()==2).findFirst().orElseThrow();
        assertThat(d2.occRate()).isEqualTo(0.0); // 停用
    }

    @Test void summaryRollsUp() {
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(u(11,1,0), u(12,1,0)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(c(101,1,11,1,"active",8000)));
        Mockito.when(btm.selectList(null)).thenReturn(List.of(line(1,101,"rent_factory",500)));
        BuildingSummaryDTO s = svc.summary();
        assertThat(s.buildingCount()).isEqualTo(1);
        assertThat(s.occRate()).isEqualTo(50.0);
        assertThat(s.vacantCount()).isEqualTo(1);
        assertThat(s.stoppedCount()).isEqualTo(0);
        assertThat(s.rentableArea()).isEqualByComparingTo("1000");
        assertThat(s.unitCount()).isEqualTo(2);
    }

    // ─── S15 单元派生面积口径 ─────────────────────────────────

    @Test void derivedUnitAreas_boundPath_splitsAcrossBoundUnits_skipsStaleContracts() {
        // 绑定优先:600 面积行绑 2 单元 → 各 300;renewed 旧链合同的绑定不计(防续签链翻倍)
        Contract active = c(101,1,11,1,"active",0);
        Contract renewed = c(102,1,11,1,"renewed",0);
        Mockito.when(btm.selectList(null)).thenReturn(List.of(
            line(1,101,"rent_factory",600), line(2,102,"rent_factory",600)));
        Mockito.when(btum.selectList(null)).thenReturn(List.of(bind(1,11), bind(1,12), bind(2,11)));
        Map<Integer,BigDecimal> area = svc.derivedUnitAreas(List.of(active, renewed), Map.of());
        assertThat(area.get(11)).isEqualByComparingTo("300");
        assertThat(area.get(12)).isEqualByComparingTo("300");
    }

    @Test void derivedUnitAreas_fallback_nonDormSplit_dormExcluded() {
        // 无绑定回退:非宿舍行 321.5 ÷ 2 单元(主11+附加12)=160.75;宿舍行 488.33 不入
        Contract ct = c(201,1,11,1,"active",0);
        Mockito.when(btm.selectList(null)).thenReturn(List.of(
            line(11,201,"rent_factory",321.5), line(12,201,"rent_dorm",488.33)));
        Map<Integer,BigDecimal> area = svc.derivedUnitAreas(List.of(ct), Map.of(12, Set.of(201)));
        assertThat(area.get(11)).isEqualByComparingTo("160.75");
        assertThat(area.get(12)).isEqualByComparingTo("160.75");
    }

    @Test void derivedUnitAreas_dormOnlyContract_zero() {
        // 纯宿舍合同无绑定 → 回退口径非宿舍行为 0 → 不产生面积
        Contract ct = c(301,1,31,1,"active",0);
        Mockito.when(btm.selectList(null)).thenReturn(List.of(line(21,301,"rent_dorm",488.33)));
        Map<Integer,BigDecimal> area = svc.derivedUnitAreas(List.of(ct), Map.of());
        assertThat(area).isEmpty();
    }

    @Test void crossBuildingExtraUnit_showsOccupiedInTargetBuilding() {
        // S15:宿舍527式——主栋1合同经 contract_unit 挂到楼栋2的单元22 → 楼栋2 该单元 occupied
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000), b(2,4,1,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(u(11,1,0), u(22,2,0)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(c(101,1,11,1,"active",8000)));
        ContractUnit cu = new ContractUnit(); cu.setContractId(101); cu.setUnitId(22);
        Mockito.when(cum.selectList(null)).thenReturn(List.of(cu));
        Mockito.when(btm.selectList(null)).thenReturn(List.of(line(1,101,"rent_factory",400)));
        List<BuildingDTO> r = svc.list();
        BuildingDTO d2 = r.stream().filter(x->x.id()==2).findFirst().orElseThrow();
        assertThat(d2.occupiedCount()).isEqualTo(1);            // 跨栋占用显示
        assertThat(d2.monthlyRent()).isEqualByComparingTo("0"); // 金额仍按主栋,不双算
        assertThat(d2.leasedArea()).isEqualByComparingTo("200"); // 400÷2 单元均摊
        BuildingDTO d1 = r.stream().filter(x->x.id()==1).findFirst().orElseThrow();
        assertThat(d1.monthlyRent()).isEqualByComparingTo("8000");
        assertThat(d1.leasedArea()).isEqualByComparingTo("200");
    }
}
