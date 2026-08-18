package com.park.demo3.service;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.dto.BuildingDTO;
import com.park.demo3.mapper.ContractMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.assertj.core.api.Assertions.assertThat;

/** METRIC-SOURCE-SPEC §2 的落地:跨屏同名指标必须同源。新增跨屏指标就往这里加一条断言。
 *  三条门禁全绿却在页面上抓到 4 处互相矛盾的数,就是因为没有任何测试校验「两个屏说的是不是同一件事」。
 *  只读断言(不造数,故不加 @Transactional):跑在共享容器的种子库上,只比两个接口的口径,不锚绝对值。 */
class MetricConsistencyIT extends AbstractMysqlIT {
    @Autowired TenantService tenantService;
    @Autowired ContractService contractService;
    @Autowired BuildingService buildingService;
    @Autowired ContractMapper contracts;

    @Test void 租户屏与合同屏的月租金必须同源() {
        assertThat(tenantService.summary().monthlyRent())
            .isEqualByComparingTo(contractService.summary().monthlyRent());
    }

    /** 户数(租户屏)与份数(合同屏)是两个指标,一户可有多份将到期合同 —— 不能直接比相等。
     *  但两者必须**同源**,所以断言各自等于权威函数 rentRollMetrics 同一次调用的对应产出:
     *  任何一屏改回自己算,这条立刻红。
     *  注意别在测试里手写 `"expiring".equals(...)` 重算期望值 —— 那正是规范 §1 禁止的绕过写法,
     *  测试自己犯规就等于没测(本条上一版即如此)。 */
    @Test void 将到期的户数与份数必须同源于_rentRollMetrics() {
        ContractService.RentRoll roll = ContractService.rentRollMetrics(contracts.selectList(null));
        assertThat(tenantService.summary().expiringTenants()).isEqualTo(roll.expiringTenantIds().size());
        assertThat(contractService.summary().contractExpiring()).isEqualTo(roll.expiring());
        assertThat(contractService.summary().monthlyRent()).isEqualByComparingTo(roll.monthlyRent());
    }

    @Test void 租户屏与楼栋屏的出租率必须同源() {
        assertThat(tenantService.summary().occRate()).isEqualTo(buildingService.summary().occRate());
    }

    @Test void 每栋出租率必须由唯一判据算出_不得有钳位假值() {
        // 拿楼栋卡自己给出的分子分母回代权威函数:谁再把公式抄一遍或加回 Math.min 钳位,这条就红
        for (BuildingDTO d : buildingService.list()) {
            if (d.status() == 0) { assertThat(d.occRate()).isNull(); continue; }   // 停用栋前端渲染「停用」
            assertThat(d.occRate()).isEqualTo(BuildingService.occRateOf(d.leasedArea(), d.rentableArea()));
        }
    }
}
