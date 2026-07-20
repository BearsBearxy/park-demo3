package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 充电桩明细导入:(桩,日)幂等 upsert 重导覆盖、行级错误(未知桩/非法日期/负金额)不整批拦。
// 风格同 PvMeterImportApiIT。@Transactional 回滚;写数据用 2099 远期槽。
@AutoConfigureMockMvc
@Transactional
class CpMeterImportApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ── 混合导入:合法行入库(source=import),未知桩/非法日期/负金额 = 行级错误跳过 ──
    @Test
    void import_mixed_rowErrorsSkipped_validRowsLand() throws Exception {
        String body = "{\"rows\":["
                + "{\"station\":\"快充1\",\"readDate\":\"2099-01-05\",\"chargeKwh\":120,\"fee\":6,\"revenue\":110},"
                + "{\"station\":\"万城万\",\"readDate\":\"2099-01-06\",\"chargeKwh\":60,\"fee\":3,\"revenue\":55,\"note\":\"平台对账\"},"
                + "{\"station\":\"幽灵桩\",\"readDate\":\"2099-01-07\",\"chargeKwh\":1},"
                + "{\"station\":\"快充1\",\"readDate\":\"01/07/2099\",\"chargeKwh\":1},"
                + "{\"station\":\"快充1\",\"readDate\":\"2099-01-08\",\"fee\":-5}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/cp-meter/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(3))
                .andReturn());
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(2, 3, 4);

        mvc.perform(get("/api/cp-meter/readings").param("year", "2099").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].stationName").value("快充1"))
                .andExpect(jsonPath("$.data[0].source").value("import"))
                .andExpect(jsonPath("$.data[0].revenue").value(110.0))
                .andExpect(jsonPath("$.data[1].stationName").value("万城万"))
                .andExpect(jsonPath("$.data[1].note").value("平台对账"));
    }

    // ── 幂等重导:同(桩,日)重导覆盖仍单行;同批重复行后行覆盖前行 ──
    @Test
    void import_idempotent_reimportOverwrites() throws Exception {
        mvc.perform(post("/api/cp-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"快充1\",\"readDate\":\"2099-02-10\",\"chargeKwh\":120,\"fee\":6,\"revenue\":110}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        // 重导修正即覆盖:同(桩,日)仍单行,取新值
        mvc.perform(post("/api/cp-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"快充1\",\"readDate\":\"2099-02-10\",\"chargeKwh\":999,\"fee\":50,\"revenue\":900}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/cp-meter/readings").param("year", "2099").param("month", "2")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].chargeKwh").value(999.0))
                .andExpect(jsonPath("$.data[0].revenue").value(900.0));

        // 同批两行同(桩,日):后行覆盖前行,库中仍单行
        mvc.perform(post("/api/cp-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"station\":\"慢充1\",\"readDate\":\"2099-03-01\",\"chargeKwh\":1},"
                        + "{\"station\":\"慢充1\",\"readDate\":\"2099-03-01\",\"chargeKwh\":2}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/cp-meter/readings").param("year", "2099").param("month", "3")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].chargeKwh").value(2.0));
    }

    // ── 鉴权门:无 token 401;viewer 导入 403 ──
    @Test
    void import_noToken401_viewer403() throws Exception {
        mvc.perform(post("/api/cp-meter/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andReturn().getResponse().getContentAsString();
        String viewer = JsonPath.read(body, "$.data.token");
        mvc.perform(post("/api/cp-meter/import").header("Authorization", "Bearer " + viewer)
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
    }
}
