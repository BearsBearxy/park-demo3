package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.entity.Contract;
import com.park.demo3.entity.ContractBillingTerm;
import com.park.demo3.mapper.ContractBillingTermMapper;
import com.park.demo3.mapper.ContractMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 合同全量导入 IT(V55 POST /api/contracts/import-full):期限原文三字段读写 / 无合同自动新建 /
 * 多合同取最新期 / 类型钉死越界行级跳过 / 幂等重导。
 * 共享单例容器 + @Transactional 回滚;自建纳秒唯一租户与 2098-2099 槽合同,不依赖种子顺序。
 */
@AutoConfigureMockMvc
@Transactional
class ContractFullImportApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired ContractBillingTermMapper lines;
    @Autowired ContractMapper contracts;
    private String token;
    private int bid;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
        bid = ((List<Integer>) JsonPath.read(getBody("/api/buildings"), "$.data[*].id")).get(0);
    }

    private String getBody(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String postJson(String url, String json) throws Exception {
        return mvc.perform(post(url).header("Authorization", "Bearer " + token)
                        .contentType("application/json").content(json.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /** 新建纳秒唯一租户(一期),返回其企业全称 */
    private String newTenant() throws Exception {
        String name = "IT导入户-" + System.nanoTime();
        postJson("/api/tenants", "{\"companyName\":\"" + name + "\",\"businessType\":\"制造\",\"phase\":1}");
        return name;
    }

    private int tenantId(String tenantName) throws Exception {
        return ((List<Integer>) JsonPath.read(getBody("/api/tenants"),
                "$.data[?(@.companyName=='" + tenantName + "')].id")).get(0);
    }

    private List<Contract> ofTenant(String tenantName) throws Exception {
        return contracts.selectList(new QueryWrapper<Contract>().eq("tenant_id", tenantId(tenantName)));
    }

    private int newContract(String tenantName, String start, String end) throws Exception {
        int tid = tenantId(tenantName);
        String body = postJson("/api/contracts", "{\"contractNo\":\"IT-FI-" + System.nanoTime() + "\",\"tenantId\":" + tid
                + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                + "\"startDate\":\"" + start + "\",\"endDate\":\"" + end + "\",\"status\":\"active\"}");
        return JsonPath.read(body, "$.data.id");
    }

    private String importFull(String rows) throws Exception {
        return postJson("/api/contracts/import-full", "{\"rows\":[" + rows + "]}");
    }

    private static String row(String fullName, String extra) {
        return "{\"tenantFullName\":\"" + fullName + "\",\"tenantName\":\"" + fullName + "\",\"phase\":1,"
                + "\"buildingHint\":\"E座3-4层\"," + (extra == null || extra.isBlank() ? "" : extra + ",")
                + "\"lines\":[{\"propertyType\":\"factory\",\"location\":\"E座3-4层\",\"feeKey\":\"rent_factory\","
                + "\"area\":3200,\"unitPrice\":9.6785}]}";
    }

    // ─── 期限原文三字段 + 自动建合同 ───────────────────────────

    @Test
    void termText_written_andContractAutoCreated() throws Exception {
        String name = newTenant();
        String res = importFull(row(name,
                "\"startDate\":\"2098-07-14\",\"endDate\":\"2099-07-13\","
                + "\"termText\":\"2098年7月14日起至2099年7月13日\",\"termType\":\"explicit\","
                + "\"tierPriceNote\":\"第一年9.6785元、第二年10.2元\",\"remark\":\"导入建档\""));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.created")).isEqualTo(1);
        assertThat((int) (Integer) JsonPath.read(res, "$.data.matched")).isZero();
        assertThat((int) (Integer) JsonPath.read(res, "$.data.result.imported")).isEqualTo(1);
        assertThat((String) JsonPath.read(res, "$.data.report[0].action")).isEqualTo("created");
        assertThat((String) JsonPath.read(res, "$.data.report[0].contractNo")).startsWith("C2024M-");

        int cid = JsonPath.read(res, "$.data.report[0].contractId");
        String d = getBody("/api/contracts/" + cid);
        assertThat((String) JsonPath.read(d, "$.data.contract.termText"))
                .isEqualTo("2098年7月14日起至2099年7月13日");
        assertThat((String) JsonPath.read(d, "$.data.contract.termType")).isEqualTo("explicit");
        assertThat((String) JsonPath.read(d, "$.data.contract.tierPriceNote")).contains("第二年10.2元");
        assertThat((String) JsonPath.read(d, "$.data.contract.startDate")).isEqualTo("2098-07-14");
        // 计费行落地 + 反向同步五标量缓存
        assertThat((Double) JsonPath.read(d, "$.data.contract.unitPrice")).isEqualTo(9.6785);
        assertThat((Double) JsonPath.read(d, "$.data.contract.rentArea")).isEqualTo(3200.0);
        assertThat((String) JsonPath.read(d, "$.data.billingLines[0].propertyType")).isEqualTo("factory");
    }

    // ─── 多合同取最新期 ────────────────────────────────────────

    @Test
    void multipleContracts_pickLatestTerm() throws Exception {
        String name = newTenant();
        newContract(name, "2097-01-01", "2097-12-31");
        int latest = newContract(name, "2098-01-01", "2098-12-31");

        String res = importFull(row(name, "\"termText\":\"以最新期为准\",\"termType\":\"relative\""));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.matched")).isEqualTo(1);
        assertThat((int) (Integer) JsonPath.read(res, "$.data.created")).isZero();
        assertThat((int) (Integer) JsonPath.read(res, "$.data.report[0].contractId")).isEqualTo(latest);
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + latest), "$.data.contract.termText"))
                .isEqualTo("以最新期为准");
    }

    // ─── 类型钉死越界:行级跳过,不整批拦 ────────────────────────

    @Test
    void typeNail_outOfRange_rowSkipped() throws Exception {
        String bad = newTenant(), good = newTenant();
        String badRow = "{\"tenantFullName\":\"" + bad + "\",\"phase\":1,\"buildingHint\":\"E座\","
                + "\"lines\":[{\"propertyType\":\"factory\",\"feeKey\":\"access\",\"roomCount\":13}]}";
        String res = importFull(badRow + "," + row(good, "\"termText\":\"正常行\""));

        assertThat((int) (Integer) JsonPath.read(res, "$.data.result.imported")).isEqualTo(1);
        assertThat((int) (Integer) JsonPath.read(res, "$.data.result.skipped")).isEqualTo(1);
        assertThat((String) JsonPath.read(res, "$.data.result.errors[0].reason"))
                .isEqualTo("费项 access 不属于「factory」段类型");
        assertThat((String) JsonPath.read(res, "$.data.report[0].action")).isEqualTo("skipped");
        assertThat((String) JsonPath.read(res, "$.data.report[1].action")).isEqualTo("created");
    }

    // ─── 未匹配租户:行级错误 ──────────────────────────────────

    @Test
    void unknownTenant_rowError() throws Exception {
        String res = importFull(row("查无此户-" + System.nanoTime(), null));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.result.skipped")).isEqualTo(1);
        assertThat((String) JsonPath.read(res, "$.data.result.errors[0].reason")).contains("未找到匹配租户");
    }

    // ─── 幂等重导:第二次匹配到首次自建的合同,计费行不翻倍 ──────

    @Test
    void reimport_isIdempotent() throws Exception {
        String name = newTenant();
        String first = importFull(row(name, "\"termText\":\"第一次\",\"termType\":\"explicit\""));
        int cid = JsonPath.read(first, "$.data.report[0].contractId");
        String no = JsonPath.read(first, "$.data.report[0].contractNo");

        String second = importFull(row(name, "\"termText\":\"第二次\",\"termType\":\"explicit\""));
        assertThat((int) (Integer) JsonPath.read(second, "$.data.created")).isZero();
        assertThat((int) (Integer) JsonPath.read(second, "$.data.matched")).isEqualTo(1);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[0].contractId")).isEqualTo(cid);
        assertThat((String) JsonPath.read(second, "$.data.report[0].contractNo")).isEqualTo(no);

        assertThat(lines.selectList(new QueryWrapper<ContractBillingTerm>().eq("contract_id", cid)))
                .hasSize(1).allMatch(l -> "import".equals(l.getSource()));
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + cid), "$.data.contract.termText"))
                .isEqualTo("第二次");
    }

    // ─── 多租期 A 类:terms[] 拆续签链 ──────────────────────────

    /** terms 片段:各期起止 + 该段原文 + 段后金额 */
    private static String terms(String... startEndTextNote) {
        StringBuilder sb = new StringBuilder("\"terms\":[");
        for (int k = 0; k + 3 < startEndTextNote.length; k += 4) {
            if (k > 0) sb.append(',');
            sb.append("{\"startDate\":\"").append(startEndTextNote[k])
              .append("\",\"endDate\":\"").append(startEndTextNote[k + 1])
              .append("\",\"text\":\"").append(startEndTextNote[k + 2])
              .append("\",\"amountNote\":").append(startEndTextNote[k + 3] == null
                  ? "null" : "\"" + startEndTextNote[k + 3] + "\"").append('}');
        }
        return sb.append(']').toString();
    }

    @Test
    void twoTerms_buildRenewalChain() throws Exception {
        String name = newTenant();
        String res = importFull(row(name, "\"startDate\":\"2094-05-17\",\"endDate\":\"2097-05-16\","
                + "\"termType\":\"multiple\",\"termText\":\"全段原文\","
                + terms("2094-05-17", "2097-05-16", "第一期原文", null,
                        "2097-05-17", "2100-05-16", "第二期原文", "（合计13750元/月）")));

        assertThat((int) (Integer) JsonPath.read(res, "$.data.created")).isEqualTo(2);
        assertThat((int) (Integer) JsonPath.read(res, "$.data.report.length()")).isEqualTo(2);

        int c1 = JsonPath.read(res, "$.data.report[0].contractId");
        int c2 = JsonPath.read(res, "$.data.report[1].contractId");
        String d1 = getBody("/api/contracts/" + c1), d2 = getBody("/api/contracts/" + c2);
        // 第 1 期 = 表里明细期:挂计费行、标 renewed、留全段原文
        assertThat((String) JsonPath.read(d1, "$.data.contract.status")).isEqualTo("renewed");
        assertThat((String) JsonPath.read(d1, "$.data.contract.termText")).isEqualTo("全段原文");
        assertThat((Double) JsonPath.read(d1, "$.data.contract.rentArea")).isEqualTo(3200.0);
        assertThat((List<?>) JsonPath.read(d1, "$.data.billingLines")).hasSize(1);
        // 第 2 期 = 新建叶子:串 parentContractId、存该段原文、金额落 remark 待补、无计费行
        assertThat((int) (Integer) JsonPath.read(d2, "$.data.contract.parentContractId")).isEqualTo(c1);
        assertThat((String) JsonPath.read(d2, "$.data.contract.startDate")).isEqualTo("2097-05-17");
        assertThat((String) JsonPath.read(d2, "$.data.contract.termText")).isEqualTo("第二期原文");
        assertThat((String) JsonPath.read(d2, "$.data.contract.remark")).contains("13750");
        assertThat((List<?>) JsonPath.read(d2, "$.data.billingLines")).isEmpty();
        assertThat((String) JsonPath.read(d2, "$.data.contract.status")).isEqualTo("active");
    }

    @Test
    void threeTerms_middlePeriodRenewed_chainLinked() throws Exception {
        String name = newTenant();
        String res = importFull(row(name, "\"startDate\":\"2094-01-01\",\"endDate\":\"2096-12-31\","
                + "\"termType\":\"multiple\","
                + terms("2094-01-01", "2096-12-31", "一", null,
                        "2097-01-01", "2098-12-31", "二", null,
                        "2099-01-01", "2100-12-31", "三", null)));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.created")).isEqualTo(3);

        int c1 = JsonPath.read(res, "$.data.report[0].contractId");
        int c2 = JsonPath.read(res, "$.data.report[1].contractId");
        int c3 = JsonPath.read(res, "$.data.report[2].contractId");
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + c2), "$.data.contract.status"))
                .isEqualTo("renewed");
        assertThat((int) (Integer) JsonPath.read(getBody("/api/contracts/" + c2),
                "$.data.contract.parentContractId")).isEqualTo(c1);
        assertThat((int) (Integer) JsonPath.read(getBody("/api/contracts/" + c3),
                "$.data.contract.parentContractId")).isEqualTo(c2);
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + c3), "$.data.contract.status"))
                .isEqualTo("active");
    }

    @Test
    void reimportChain_isIdempotent_noDuplicateLink() throws Exception {
        String name = newTenant();
        String chain = terms("2094-05-17", "2097-05-16", "一", null, "2097-05-17", "2100-05-16", "二", null);
        String first = importFull(row(name, "\"startDate\":\"2094-05-17\",\"endDate\":\"2097-05-16\","
                + "\"termType\":\"multiple\"," + chain));
        int c1 = JsonPath.read(first, "$.data.report[0].contractId");
        int c2 = JsonPath.read(first, "$.data.report[1].contractId");

        String second = importFull(row(name, "\"startDate\":\"2094-05-17\",\"endDate\":\"2097-05-16\","
                + "\"termType\":\"multiple\"," + chain));
        assertThat((int) (Integer) JsonPath.read(second, "$.data.created")).isZero();
        assertThat((int) (Integer) JsonPath.read(second, "$.data.matched")).isEqualTo(2);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[0].contractId")).isEqualTo(c1);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[1].contractId")).isEqualTo(c2);
        // 计费行不翻倍
        assertThat(lines.selectList(new QueryWrapper<ContractBillingTerm>().eq("contract_id", c1))).hasSize(1);
    }

    // ─── P0 回归:同租户多行 + 重复导入不得污染续签链 ─────────────

    /** 广联一期/二期同名落同一户:带 terms 的行建链,无 terms 的行不得认领链上子期。
     *  连导两次:合同总数不变、链不分叉、无重复 C2024M-*。 */
    @Test
    void reimport_twoRowsSameTenant_chainNotForked() throws Exception {
        String name = newTenant();
        // 子期起租日(2097)晚于第二行起租日(2093):无保护时 owned 按 start_date 降序必选中子期
        String rowWithChain = row(name, "\"startDate\":\"2094-05-17\",\"endDate\":\"2097-05-16\","
                + "\"termType\":\"multiple\","
                + terms("2094-05-17", "2097-05-16", "一", null, "2097-05-17", "2100-05-16", "二", null));
        String rowNoTerms = row(name, "\"startDate\":\"2093-01-01\",\"endDate\":\"2095-12-31\","
                + "\"termText\":\"二期行\"");

        String first = importFull(rowWithChain + "," + rowNoTerms);
        assertThat((int) (Integer) JsonPath.read(first, "$.data.created")).isEqualTo(3);
        int head = JsonPath.read(first, "$.data.report[0].contractId");
        int child = JsonPath.read(first, "$.data.report[1].contractId");
        int plain = JsonPath.read(first, "$.data.report[2].contractId");
        assertThat(plain).isNotIn(head, child);

        String second = importFull(rowWithChain + "," + rowNoTerms);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.created")).isZero();
        assertThat((int) (Integer) JsonPath.read(second, "$.data.matched")).isEqualTo(3);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[0].contractId")).isEqualTo(head);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[1].contractId")).isEqualTo(child);
        assertThat((int) (Integer) JsonPath.read(second, "$.data.report[2].contractId")).isEqualTo(plain);

        List<Contract> all = ofTenant(name);
        assertThat(all).hasSize(3);
        assertThat(all).extracting(Contract::getContractNo).doesNotHaveDuplicates();
        // 子期起止未被无 terms 的行覆写,链仍挂在首期上
        String d = getBody("/api/contracts/" + child);
        assertThat((String) JsonPath.read(d, "$.data.contract.startDate")).isEqualTo("2097-05-17");
        assertThat((int) (Integer) JsonPath.read(d, "$.data.contract.parentContractId")).isEqualTo(head);
    }

    /** 同租户两行都无 terms:批内一份合同只被认领一次,第二行新建,起止互不覆盖。 */
    @Test
    void twoRowsSameTenant_noTerms_doNotOverwriteEachOther() throws Exception {
        String name = newTenant();
        int existing = newContract(name, "2092-01-01", "2092-12-31");

        String res = importFull(
                row(name, "\"startDate\":\"2093-01-01\",\"endDate\":\"2095-12-31\",\"termText\":\"甲段\"") + ","
              + row(name, "\"startDate\":\"2096-01-01\",\"endDate\":\"2098-12-31\",\"termText\":\"乙段\""));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.matched")).isEqualTo(1);
        assertThat((int) (Integer) JsonPath.read(res, "$.data.created")).isEqualTo(1);

        int c1 = JsonPath.read(res, "$.data.report[0].contractId");
        int c2 = JsonPath.read(res, "$.data.report[1].contractId");
        assertThat(c1).isEqualTo(existing).isNotEqualTo(c2);
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + c1), "$.data.contract.startDate"))
                .isEqualTo("2093-01-01");
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + c2), "$.data.contract.startDate"))
                .isEqualTo("2096-01-01");
        assertThat((String) JsonPath.read(getBody("/api/contracts/" + c2), "$.data.contract.termText"))
                .isEqualTo("乙段");
    }

    /** 子期孤儿计费行自愈:旧版导入误落在子期上的 import 行,重导时被清、manual 行保留、标量归零。 */
    @Test
    void reimportChain_clearsOrphanImportLinesOnChildTerm() throws Exception {
        String name = newTenant();
        String chain = terms("2094-05-17", "2097-05-16", "一", null, "2097-05-17", "2100-05-16", "二", null);
        String rowChain = row(name, "\"startDate\":\"2094-05-17\",\"endDate\":\"2097-05-16\","
                + "\"termType\":\"multiple\"," + chain);
        int child = JsonPath.read(importFull(rowChain), "$.data.report[1].contractId");

        // 模拟旧版遗留:子期上一条 import 孤儿行 + 一条 manual 行,并污染标量缓存
        lines.insert(orphanLine(child, "rent_shop", "宿舍区二号楼首层2115等", "500.56", "import"));
        lines.insert(orphanLine(child, "mgmt", "手录", "10", "manual"));
        Contract dirty = contracts.selectById(child);
        dirty.setRentArea(new BigDecimal("500.56"));
        dirty.setBuildingArea(new BigDecimal("400.45"));
        contracts.updateById(dirty);

        importFull(rowChain);   // 重导 → 子期自愈

        List<ContractBillingTerm> after = lines.selectList(
                new QueryWrapper<ContractBillingTerm>().eq("contract_id", child));
        assertThat(after).hasSize(1);
        assertThat(after.get(0).getFeeKey()).isEqualTo("mgmt");
        assertThat(after.get(0).getSource()).isEqualTo("manual");
        Contract healed = contracts.selectById(child);
        assertThat(healed.getRentArea()).isEqualByComparingTo("0");
        assertThat(healed.getBuildingArea()).isNull();
        assertThat(healed.getMonthlyRent()).isEqualByComparingTo("0");
    }

    private static ContractBillingTerm orphanLine(int cid, String feeKey, String loc, String area, String source) {
        ContractBillingTerm t = new ContractBillingTerm();
        t.setContractId(cid); t.setPropertyType("shop"); t.setLocation(loc);
        t.setFeeKey(feeKey); t.setFeeName(feeKey); t.setBillMode("per_sqm_month");
        t.setArea(new BigDecimal(area)); t.setUnitPrice(new BigDecimal("17"));
        t.setCoeff(BigDecimal.ONE); t.setSeq(0); t.setSource(source);
        return t;
    }

    /** B 类(非连续多标的)不传 terms → 单份合同,不建链 */
    @Test
    void noTerms_singleContract_noChain() throws Exception {
        String name = newTenant();
        String res = importFull(row(name, "\"startDate\":\"2094-09-01\",\"endDate\":\"2097-08-31\","
                + "\"termType\":\"multiple\",\"termText\":\"办公室部分…;厂房部分…\","
                + "\"remark\":\"本标的租期 2094-09-10→2097-09-09\""));
        assertThat((int) (Integer) JsonPath.read(res, "$.data.report.length()")).isEqualTo(1);
        int cid = JsonPath.read(res, "$.data.report[0].contractId");
        String d = getBody("/api/contracts/" + cid);
        assertThat((String) JsonPath.read(d, "$.data.contract.status")).isNotEqualTo("renewed");
        assertThat((String) JsonPath.read(d, "$.data.contract.remark")).contains("本标的租期");
        assertThat((Object) JsonPath.read(d, "$.data.contract.parentContractId")).isNull();
    }
}
