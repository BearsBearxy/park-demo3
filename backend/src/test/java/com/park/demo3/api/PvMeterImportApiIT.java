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

// 光伏抄表导入:(站,日)幂等 upsert 重导覆盖、行级错误不整批拦、导入时 price_snap 快照当时站单价
// (重导=重新录入,重新快照;未重导的旧行不漂移)。@Transactional 回滚;写数据用 2099 远期槽。
@AutoConfigureMockMvc
@Transactional
class PvMeterImportApiIT extends AbstractMysqlIT {

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

    private int stationId(String name) throws Exception {
        String body = utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth())).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[?(@.name=='" + name + "')].id");
        return ids.get(0);
    }

    // ── 混合导入:合法行入库(source=import),未知站/非法日期/负量 = 行级错误跳过 ──
    @Test
    void import_mixed_rowErrorsSkipped_validRowsLand() throws Exception {
        String body = "{\"rows\":["
                + "{\"station\":\"B座\",\"readDate\":\"2099-01-05\",\"genTotal\":120,\"selfUse\":100,\"gridFeed\":20},"
                + "{\"station\":\"工业大厦\",\"readDate\":\"2099-01-06\",\"genTotal\":60,\"selfUse\":50,\"gridFeed\":10,\"note\":\"月抄\"},"
                + "{\"station\":\"幽灵座\",\"readDate\":\"2099-01-07\",\"selfUse\":1},"
                + "{\"station\":\"B座\",\"readDate\":\"01/07/2099\",\"selfUse\":1},"
                + "{\"station\":\"B座\",\"readDate\":\"2099-01-08\",\"selfUse\":-5}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(3))
                .andReturn());
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(2, 3, 4);

        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].stationName").value("B座"))
                .andExpect(jsonPath("$.data[0].source").value("import"))
                .andExpect(jsonPath("$.data[1].stationName").value("工业大厦"))
                .andExpect(jsonPath("$.data[1].note").value("月抄"));
    }

    // ── 幂等重导:同(站,日)重导覆盖仍单行;同批重复行后行覆盖前行 ──
    @Test
    void import_idempotent_reimportOverwrites() throws Exception {
        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"B座\",\"readDate\":\"2099-02-10\",\"genTotal\":120,\"selfUse\":100,\"gridFeed\":20}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        // 重导修正即覆盖:同(站,日)仍单行,取新值
        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"B座\",\"readDate\":\"2099-02-10\",\"genTotal\":1000,\"selfUse\":999,\"gridFeed\":1}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "2")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].selfUse").value(999.0));

        // 同批两行同(站,日):后行覆盖前行,库中仍单行
        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"station\":\"E座\",\"readDate\":\"2099-03-01\",\"selfUse\":1},"
                        + "{\"station\":\"E座\",\"readDate\":\"2099-03-01\",\"selfUse\":2}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "3")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].selfUse").value(2.0));
    }

    // ── 导入 price_snap 快照:导入时快照当时站单价;调价后旧行不漂移、新导入行用新价;重导=重新快照 ──
    @Test
    void import_priceSnap_snapshotAtImportTime() throws Exception {
        int bId = stationId("B座");
        mvc.perform(put("/api/pv-meter/stations/" + bId).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"B座\",\"phase\":1,\"priceYuan\":0.5}"))
                .andExpect(jsonPath("$.code").value(0));

        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"B座\",\"readDate\":\"2099-04-01\",\"selfUse\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "4")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0].priceSnap").value(0.5))
                .andExpect(jsonPath("$.data[0].revenue").value(50.0));

        // 调价 0.5 → 0.9,再导另一日:旧行 0.5 不漂移,新行 0.9
        mvc.perform(put("/api/pv-meter/stations/" + bId).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"B座\",\"phase\":1,\"priceYuan\":0.9}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"B座\",\"readDate\":\"2099-04-02\",\"selfUse\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "4")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].priceSnap").value(0.5))
                .andExpect(jsonPath("$.data[0].revenue").value(50.0))
                .andExpect(jsonPath("$.data[1].priceSnap").value(0.9))
                .andExpect(jsonPath("$.data[1].revenue").value(90.0));

        // 重导 04-01 = 重新录入,重新快照当时价 0.9
        mvc.perform(post("/api/pv-meter/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"station\":\"B座\",\"readDate\":\"2099-04-01\",\"selfUse\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "4")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].priceSnap").value(0.9));
    }

    // ── 鉴权门:无 token 401;viewer 导入 403 ──
    @Test
    void import_noToken401_viewer403() throws Exception {
        mvc.perform(post("/api/pv-meter/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andReturn().getResponse().getContentAsString();
        String viewer = JsonPath.read(body, "$.data.token");
        mvc.perform(post("/api/pv-meter/import").header("Authorization", "Bearer " + viewer)
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
    }
}
