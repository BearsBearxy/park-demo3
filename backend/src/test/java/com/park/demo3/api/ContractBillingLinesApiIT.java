package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.entity.BillingTermUnit;
import com.park.demo3.entity.ContractBillingTerm;
import com.park.demo3.mapper.BillingTermUnitMapper;
import com.park.demo3.mapper.ContractBillingTermMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 扁平计费行 IT(BILL-FORWARD 刀1 三次返工 §1.7):多段读写 / 按间存取 / 系数 / 枚举校验 /
 * 反向同步五标量缓存(= V52 迁移「16 户租金恢复」同机制的运行期证) / 建筑面积重算 / kva 联动。
 * 共享单例容器:@Transactional 回滚不污染种子;2099 年槽 + 纳秒唯一合同号(禁顺序依赖断言)。
 * 注:V52 迁移的 157 留档行反拆/16 户接回是 dev 真实数据事实,测试容器仅种子(无计费行),故迁移
 *     数据结果在 dev 库核验;此处以运行期反向同步覆盖同一逻辑(rent 主行 → 宽表 unit_price)。
 */
@AutoConfigureMockMvc
@Transactional
class ContractBillingLinesApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired ContractBillingTermMapper lines;
    @Autowired BillingTermUnitMapper termUnits;
    private String token;
    private int tid, bid;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
        tid = ((List<Integer>) JsonPath.read(getBody("/api/tenants"), "$.data[*].id")).get(0);
        bid = ((List<Integer>) JsonPath.read(getBody("/api/buildings"), "$.data[*].id")).get(0);
    }

    private String getBody(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 自建 2099 槽合同;extra=追加 JSON 字段(如 "\"billingLines\":[...]"),返回 id */
    private int newContract(String extra) throws Exception {
        String body = mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-BL-" + System.nanoTime() + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + (extra == null || extra.isBlank() ? "" : extra + ",")
                        + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\",\"status\":\"active\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.id");
    }

    private org.springframework.test.web.servlet.ResultActions putContract(int id, String no, String extra) throws Exception {
        return mvc.perform(put("/api/contracts/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid + ",\"buildingId\":" + bid
                        + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + (extra == null || extra.isBlank() ? "" : extra + ",")
                        + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\",\"status\":\"active\"}"));
    }

    // ─── 多位置段读写(银纳同构:厂房+宿舍+门禁+网络四行,两位置) ─────

    @Test
    void multiSegmentLines_persistAndEchoSortedByLocationSeq() throws Exception {
        String bl = "\"billingLines\":["
                + "{\"location\":\"厂房\",\"feeKey\":\"rent_factory\",\"area\":256.52,\"unitPrice\":22.565,\"seq\":1},"
                + "{\"location\":\"厂房\",\"feeKey\":\"access\",\"unitPrice\":100,\"roomCount\":13,\"seq\":2},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19,\"seq\":1},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"network\",\"unitPrice\":50,\"roomCount\":13,\"seq\":2}]";
        int id = newContract(bl);
        String d = getBody("/api/contracts/" + id);
        // 按 location, seq 排序:厂房(access,rent_factory 按 seq)... 注 orderBy location 字典序:厂房 < 宿舍
        assertThat((List<String>) JsonPath.read(d, "$.data.billingLines[*].feeKey"))
                .containsExactly("rent_factory", "access", "rent_dorm", "network");
        // 按间行:billMode 默认派生 + roomCount 存取
        assertThat((String) JsonPath.read(d, "$.data.billingLines[1].billMode")).isEqualTo("per_room_year");
        assertThat((Integer) JsonPath.read(d, "$.data.billingLines[1].roomCount")).isEqualTo(13);
        assertThat((String) JsonPath.read(d, "$.data.billingLines[3].billMode")).isEqualTo("per_room_month");
        // 反向同步:主租金行(per_sqm_month rent_*,seq 最小)→ 宽表 unit_price = 厂房 22.565
        assertThat((Double) JsonPath.read(d, "$.data.contract.unitPrice")).isEqualTo(22.565);
    }

    // ─── 系数独立列(翔海/旭化成 1.56,不折入单价) ─────────────

    @Test
    void coeff_storedAsIndependentColumn() throws Exception {
        int id = newContract("\"billingLines\":[{\"location\":\"E座3-4层\",\"feeKey\":\"rent_factory\","
                + "\"area\":4708,\"unitPrice\":12.1,\"coeff\":1.56,\"seq\":1}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.billingLines[0].coeff")).isEqualTo(1.56);
        assertThat((Double) JsonPath.read(d, "$.data.billingLines[0].unitPrice")).isEqualTo(12.1);   // 未折入
    }

    // ─── 反向同步 = V52「16 户租金恢复」运行期证 ────────────────
    // 合同宽表 unit_price 初始空(无 billingLines),再 PUT 带 rent 行 → 缓存接回非空。

    @Test
    void reverseSync_nullUnitPriceRecoveredFromRentLine() throws Exception {
        int id = newContract(null);                       // 不带计费行,宽表 unitPrice 空
        String no = JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
        assertThat((Object) JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.unitPrice"))
                .isNull();
        // 多价并存(两 rent 行不同价)→ 主行 = seq 最小者 9.68
        putContract(id, no, "\"billingLines\":["
                + "{\"location\":\"二期13座二楼\",\"feeKey\":\"rent_factory\",\"area\":4551,\"unitPrice\":9.68,\"seq\":1},"
                + "{\"location\":\"宿舍楼四座\",\"feeKey\":\"rent_dorm\",\"area\":31.05,\"unitPrice\":19,\"seq\":2}]")
                .andExpect(jsonPath("$.code").value(0));
        assertThat((Double) JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.unitPrice"))
                .isEqualTo(9.68);
    }

    // ─── 枚举校验:非法 feeKey → 400 ───────────────────────────

    @Test
    void illegalFeeKey_rejected() throws Exception {
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-BL-" + System.nanoTime() + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + "\"billingLines\":[{\"feeKey\":\"bogus_fee\",\"unitPrice\":1}],"
                        + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\",\"status\":\"active\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("费项类型非法: bogus_fee"));
    }

    // ─── PUT 整组替换:同 id 行沿旧 source,manual 行不被后续导入覆盖 ─────

    @Test
    void putReplacesWholeGroup_manualPreservedFromImport() throws Exception {
        // 先导入两行(source=import)
        int id = newContract(null);
        String imp = "{\"rows\":[{\"contractId\":" + id + ",\"lines\":["
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785},"
                + "{\"location\":\"主\",\"feeKey\":\"mgmt\",\"area\":3200,\"unitPrice\":5.45}]}]}";
        mvc.perform(post("/api/contracts/billing-lines/import")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json").content(imp))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0));
        // 反向同步:rent 9.6785 / mgmt 5.45 进缓存
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.unitPrice")).isEqualTo(9.6785);
        assertThat((Double) JsonPath.read(d, "$.data.contract.mgmtFeePrice")).isEqualTo(5.45);
        assertThat(lines.selectList(new QueryWrapper<ContractBillingTerm>().eq("contract_id", id)))
                .allMatch(l -> "import".equals(l.getSource()));

        // 用户单一编辑改 rent → 11(新行 id=null → manual);再导 12 被保留(manual 不覆盖)
        String no = JsonPath.read(d, "$.data.contract.contractNo");
        putContract(id, no, "\"billingLines\":[{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":11}]")
                .andExpect(jsonPath("$.code").value(0));
        assertThat(lines.selectList(new QueryWrapper<ContractBillingTerm>().eq("contract_id", id)))
                .hasSize(1).allMatch(l -> "manual".equals(l.getSource()));
        // 再导入:manual 行保留,import 组替换(此处无 import 行残留)→ rent 仍 11
        mvc.perform(post("/api/contracts/billing-lines/import")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"rows\":[{\"contractId\":" + id + ",\"lines\":["
                        + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":12}]}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        // 现有 manual(11) + 新 import(12) 两行;主行 seq 最小 = manual 11(seq0) 先于 import(seq0)... 断言存在 manual 11
        assertThat(lines.selectList(new QueryWrapper<ContractBillingTerm>().eq("contract_id", id)))
                .anyMatch(l -> "manual".equals(l.getSource()) && l.getUnitPrice().doubleValue() == 11.0);
    }

    // ─── 导入行级错误跳过不整批拦 ──────────────────────────────

    @Test
    void import_rowErrors_skippedNotFatal() throws Exception {
        int id = newContract(null);
        String imp = "{\"rows\":["
                + "{\"contractId\":99999999,\"lines\":[]},"
                + "{\"contractId\":" + id + ",\"lines\":[{\"feeKey\":\"nope\",\"unitPrice\":1}]},"
                + "{\"contractId\":" + id + ",\"lines\":[{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":16.92}]}]}";
        mvc.perform(post("/api/contracts/billing-lines/import")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json").content(imp))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(2))
                .andExpect(jsonPath("$.data.errors[0].reason").value("合同不存在"))
                .andExpect(jsonPath("$.data.errors[1].reason").value("费项类型非法: nope"));
        assertThat((Double) JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.unitPrice"))
                .isEqualTo(16.92);
    }

    // ─── 长位置文本(真实月度册整段房号清单达 131 字)整组导入不截断、不整批回滚 ─────
    // 回归:location 曾为 VARCHAR(64),真实册「宿舍楼 30间宿舍(…528室)」触发 MysqlDataTruncation,
    // 因 @Transactional 逃出行级 try 回滚整批(115 户全废);V53 加宽到 255 治根。

    @Test
    void longLocation_importsWithoutTruncationOrBatchRollback() throws Exception {
        int id = newContract(null);
        String longLoc = "宿舍楼 30间宿舍（309、310、311、313、316、315、318、320、523、326、328、407、"
                + "411、413、415、417、421、506、511、513、515、516、517、423、520、521、522、524、526、528室）";
        assertThat(longLoc.length()).isGreaterThan(64);
        mvc.perform(post("/api/contracts/billing-lines/import")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"rows\":[{\"contractId\":" + id + ",\"lines\":["
                        + "{\"location\":\"" + longLoc + "\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19}]}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0));
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + id), "$.data.billingLines[0].location"))
                .isEqualTo(longLoc);
    }

    // ─── 建筑面积清空重算(裁定①) + kva 联动(裁定④),沿旧口径 ─────

    @Test
    void buildingArea_blankDerives_clearRecalcs() throws Exception {
        int id = newContract(null);
        String no = JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
        assertThat((Double) JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.buildingArea")).isEqualTo(80.0);
        putContract(id, no, "\"buildingArea\":1000").andExpect(jsonPath("$.data.buildingArea").value(1000.0));
        putContract(id, no, null).andExpect(jsonPath("$.data.buildingArea").value(80.0));
    }

    // ─── rentArea 派生缓存(裁定 2026-07-24):= 建筑类租金行面积之和,空地不计入 ─────

    @Test
    void rentArea_singleLine_equalsThatRentArea() throws Exception {
        // 金纳同构:单厂房行 3200 → rentArea=3200(压过 newContract 传的 100),buildingArea=2560
        int id = newContract("\"billingLines\":[{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(3200.0);
        assertThat((Double) JsonPath.read(d, "$.data.contract.buildingArea")).isEqualTo(2560.0);
    }

    @Test
    void rentArea_multiLocation_sumsNonDormRentAreas() throws Exception {
        // S15:宿舍行面积不入 rent_area(全库 unit.area=0 后面积口径改派生,宿舍间面积另走单元绑定口径)
        // 多位置:厂房 256.52 计入;宿舍 488.33 不计;门禁/网络无面积不计
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"厂房\",\"feeKey\":\"rent_factory\",\"area\":256.52,\"unitPrice\":22.565,\"seq\":1},"
                + "{\"location\":\"厂房\",\"feeKey\":\"access\",\"unitPrice\":100,\"roomCount\":13,\"seq\":2},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19,\"seq\":1}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(256.52);
        assertThat((Double) JsonPath.read(d, "$.data.contract.buildingArea")).isEqualTo(205.22);   // 256.52×0.8
    }

    @Test
    void rentArea_dormOnly_isZeroDormExcluded() throws Exception {
        // S15:纯宿舍户(rent_dorm 有面积但无建筑类非宿舍租金行)→ rentArea=0,buildingArea 清空;
        // 且不回退 infra(有租金行即不走 infra 回退,宿舍行只是不计面积)
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19,\"seq\":1},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"infra\",\"area\":488.33,\"unitPrice\":3,\"seq\":2}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(0.0);
        assertThat((Object) JsonPath.read(d, "$.data.contract.buildingArea")).isNull();
    }

    @Test
    void rentArea_pureLand_isZeroExcludingLandArea() throws Exception {
        // 纯空地户:rent_land 不计入租赁面积 → rentArea=0,buildingArea 清空
        int id = newContract("\"billingLines\":[{\"location\":\"空地一\",\"feeKey\":\"rent_land\",\"area\":5000,\"unitPrice\":2.5}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(0.0);
        assertThat((Object) JsonPath.read(d, "$.data.contract.buildingArea")).isNull();
    }

    @Test
    void rentArea_onlyInfraLines_fallbackToInfraArea() throws Exception {
        // 二期健明式:无任何租金行,只有 infra(基础设施维护费)带面积 5040 → 回退 rentArea=5040
        int id = newContract("\"billingLines\":[{\"location\":\"主\",\"feeKey\":\"infra\",\"area\":5040,\"unitPrice\":3}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(5040.0);
        assertThat((Double) JsonPath.read(d, "$.data.contract.buildingArea")).isEqualTo(4032.0);   // 5040×0.8
    }

    @Test
    void rentArea_duplicateRentLines_dedupedNotDoubled() throws Exception {
        // 碧沃丰式:两条完全相同 (主,rent_factory,3200) → 三元去重后 rentArea=3200 而非 6400
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785,\"seq\":1},"
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785,\"seq\":2}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(3200.0);
        assertThat((Double) JsonPath.read(d, "$.data.contract.buildingArea")).isEqualTo(2560.0);
    }

    @Test
    void rentArea_hasRentLine_infraExcluded() throws Exception {
        // 翔海式:2 租金行(9416+4708=14124)+ 1 大 infra(9416=整栋维护合计)
        // 有租金行 → infra 完全不参与,rentArea=14124(绝非 14124+9416=23540)
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"G座1-2层\",\"feeKey\":\"rent_factory\",\"area\":9416,\"unitPrice\":10,\"seq\":1},"
                + "{\"location\":\"G座3-4层\",\"feeKey\":\"rent_factory\",\"area\":4708,\"unitPrice\":10,\"seq\":2},"
                + "{\"location\":\"主\",\"feeKey\":\"infra\",\"area\":9416,\"unitPrice\":3,\"seq\":3}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(14124.0);
        assertThat((Double) JsonPath.read(d, "$.data.contract.buildingArea")).isEqualTo(11299.2);   // 14124×0.8
    }

    // ─── S15 孤儿雷:PUT 整组替换重建计费行,billing_term_unit 绑定按 (location|feeKey|area) 回挂 ─────
    // 背景:计费行 delete+insert 重建,行级绑定经 FK CASCADE 连带删除(dev 库 1708 行绑定孤儿雷)。

    /** 任取一个真实单元 id(绑定 FK 需要) */
    private int anyUnitId() throws Exception {
        return ((List<Integer>) JsonPath.read(getBody("/api/buildings/" + bid), "$.data.units[*].id")).get(0);
    }

    private void bind(int termId, int unitId, String source) {
        BillingTermUnit b = new BillingTermUnit();
        b.setTermId(termId); b.setUnitId(unitId); b.setSource(source);
        termUnits.insert(b);
    }

    @Test
    void putReplace_rehangsTermUnitBindings_bySameKey() throws Exception {
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"厂房\",\"feeKey\":\"rent_factory\",\"area\":300,\"unitPrice\":10,\"seq\":1},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19,\"seq\":2}]");
        List<ContractBillingTerm> before = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id).orderByAsc("seq", "id"));
        assertThat(before).hasSize(2);
        int u1 = anyUnitId();
        for (ContractBillingTerm t : before) bind(t.getId(), u1, "manual");

        // 单一编辑只改价,(location|feeKey|area) 键不变 → 绑定必须存活并挂到新 term id
        String no = JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
        putContract(id, no, "\"billingLines\":["
                + "{\"location\":\"厂房\",\"feeKey\":\"rent_factory\",\"area\":300,\"unitPrice\":11,\"seq\":1},"
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":20,\"seq\":2}]")
                .andExpect(jsonPath("$.code").value(0));
        List<ContractBillingTerm> after = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id).orderByAsc("seq", "id"));
        assertThat(after).hasSize(2);
        for (ContractBillingTerm t : after) {
            List<BillingTermUnit> bs = termUnits.selectList(
                    new QueryWrapper<BillingTermUnit>().eq("term_id", t.getId()));
            assertThat(bs).as("绑定回挂到新 term %s(%s)", t.getId(), t.getFeeKey()).hasSize(1);
            assertThat(bs.get(0).getUnitId()).isEqualTo(u1);
            assertThat(bs.get(0).getSource()).isEqualTo("manual");   // source 原样保留
        }
    }

    @Test
    void putReplace_sameKeyTwice_pairedInOrder() throws Exception {
        // 键撞多行(碧沃丰式两条同键行):按序配对,各自绑定各归各行
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9,\"seq\":1},"
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9,\"seq\":2}]");
        List<ContractBillingTerm> before = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id).orderByAsc("seq", "id"));
        List<Integer> uids = JsonPath.read(getBody("/api/buildings/" + bid), "$.data.units[*].id");
        bind(before.get(0).getId(), uids.get(0), "derived");
        bind(before.get(1).getId(), uids.get(1), "manual");

        String no = JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
        putContract(id, no, "\"billingLines\":["
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":10,\"seq\":1},"
                + "{\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":11,\"seq\":2}]")
                .andExpect(jsonPath("$.code").value(0));
        List<ContractBillingTerm> after = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id).orderByAsc("seq", "id"));
        List<BillingTermUnit> b0 = termUnits.selectList(
                new QueryWrapper<BillingTermUnit>().eq("term_id", after.get(0).getId()));
        List<BillingTermUnit> b1 = termUnits.selectList(
                new QueryWrapper<BillingTermUnit>().eq("term_id", after.get(1).getId()));
        assertThat(b0).hasSize(1);
        assertThat(b0.get(0).getUnitId()).isEqualTo(uids.get(0));
        assertThat(b1).hasSize(1);
        assertThat(b1.get(0).getUnitId()).isEqualTo(uids.get(1));
    }

    @Test
    void putReplace_unmatchedBindingDropped_andNamedInWarnings() throws Exception {
        int id = newContract("\"billingLines\":["
                + "{\"location\":\"宿舍\",\"feeKey\":\"rent_dorm\",\"area\":488.33,\"unitPrice\":19,\"seq\":1}]");
        ContractBillingTerm dorm = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id)).get(0);
        int u1 = anyUnitId();
        bind(dorm.getId(), u1, "manual");

        // 整行删除换新键 → 绑定无处可挂:随 CASCADE 删除,返回警告点名
        String no = JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
        putContract(id, no, "\"billingLines\":["
                + "{\"location\":\"厂房\",\"feeKey\":\"rent_factory\",\"area\":300,\"unitPrice\":10,\"seq\":1}]")
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.warnings[0]").value(
                        org.hamcrest.Matchers.containsString("宿舍|rent_dorm|488.33")));
        List<ContractBillingTerm> after = lines.selectList(new QueryWrapper<ContractBillingTerm>()
                .eq("contract_id", id));
        assertThat(after).hasSize(1);
        assertThat(termUnits.selectCount(
                new QueryWrapper<BillingTermUnit>().eq("term_id", after.get(0).getId()))).isZero();
    }

    /** 用电分类不锁配电容量(用户拍板 2026-07-27,推翻裁定④):商业户带 kVA 正常落库。 */
    @Test
    void kva_allowedForAnyPowerType() throws Exception {
        String no = "IT-BL-" + System.nanoTime();
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + "\"powerType\":\"commercial\",\"kva\":100,\"status\":\"active\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.kva").value(100.0))
                .andExpect(jsonPath("$.data.powerType").value("commercial"));
    }
}
