package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 部署配置 GET /api/app/config,不设任何变量 = 我园生产(2026-10-05 用户拍板「按你建议修改」:我园零配置改动)。
// 关掉的那一面见 AppConfigParkToolsOffIT。三处 simulate 打 2099 远期槽,@Transactional 回滚。
// 破坏验证:application.yml 的 ${PARK_TOOLS_ENABLED:true} 改成 false → parkTools 那格与三条 simulate 红;
//          ${RELEASE_BASELINE:0.0.0} 改成 0.29.0 → releaseBaseline 那格红;PermissionRegistry 删掉 /api/app/config 读规则 → viewer 那条 403 红。
@AutoConfigureMockMvc
@Transactional
class AppConfigApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;

    private String token(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return "Bearer " + JsonPath.read(body, "$.data.token");
    }

    @Test
    void defaults_areOurPark_toolsOn_baselineZero() throws Exception {
        mvc.perform(get("/api/app/config").header("Authorization", token("admin", "admin123")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.parkTools").value(true))
                .andExpect(jsonPath("$.data.releaseBaseline").value("0.0.0"));
    }

    @Test
    void anyLoggedInAccountReadsIt_anonymousDoesNot() throws Exception {
        // 只读账号也要拿得到:外壳一登录就取,拿不到 = 那个账号的更新记录一条都不显
        mvc.perform(get("/api/app/config").header("Authorization", token("viewer", "viewer123")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.parkTools").value(true));
        mvc.perform(get("/api/app/config")).andExpect(status().isUnauthorized());
    }

    @Test
    void defaults_threeSimulatesStillRun() throws Exception {
        String admin = token("admin", "admin123");
        for (String p : new String[]{"/api/pv-meter/simulate", "/api/elec-cost/simulate", "/api/cp-meter/simulate"}) {
            mvc.perform(post(p).param("year", "2099").header("Authorization", admin))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));
        }
    }

    @Test
    void defaults_missingHintStillPointsAtSimulate() throws Exception {
        // 2094-05 全空月(同 ElecCostApiIT 的空月锚),四处缺源提示我园照旧带「(可模拟填充)」
        String body = mvc.perform(get("/api/elec-cost/metrics").param("year", "2094").param("month", "5")
                .header("Authorization", token("admin", "admin123")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        java.util.List<String> missing = JsonPath.read(body, "$.data[*].missing[*]");
        org.assertj.core.api.Assertions.assertThat(missing).contains("总表电费支出未录(可模拟填充)",
                "光伏上网收益未录(可模拟填充)", "总表基本电费未录(可模拟填充)", "运营性电表费用未录(可模拟填充)");
    }
}
