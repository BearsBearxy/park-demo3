package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.List;

/**
 * **业务层**的权限判定(含提权)。
 *
 * 绝大多数写端点在 {@link WriteAccessManager} 那一道就判完了,业务代码无感。
 * 这个类只给「URL 判不了、必须看请求体才知道要哪个权限」的几处用(RBAC-SPEC §15.6):计费参数按键分档、
 * 删读数 / 删表连带删草稿催缴单、抄表导入改倍率、账册模板按账册所属屏、分桩运营账按车型、目标与阈值按项。
 *
 * ⚠ 这一处曾经**只写在注释里没有实现**(2026-08-22 发现):PermissionRegistry 给 PUT /api/params
 *   登记的是「两档任一」,而 ParamService 里没有细分判定 ——
 *   于是只有月度录入权的财务专员,绕开前端直接调 API 就能改任何一个计费口径键。
 *   前端把按钮藏了,后端的门是开的。加新的「URL 判不了」的规则时,实现和注释必须一起落地。
 */
@Component
public class PermissionGuard {

    private final ElevationStore elevations;

    public PermissionGuard(ElevationStore elevations) { this.elevations = elevations; }

    /** 角色给的,或主管当场授权的。 */
    public boolean has(String perm) {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !a.isAuthenticated()) return false;
        for (GrantedAuthority g : a.getAuthorities()) if (perm.equals(g.getAuthority())) return true;

        ElevationStore.Grant grant = elevations.find(a.getName(), List.of(perm));
        if (grant == null) return false;
        // 与 WriteAccessManager 同款:记下授权人,本次请求的审计自动带上他
        RequestAttributes ra = RequestContextHolder.getRequestAttributes();
        if (ra != null) {
            ra.setAttribute(ElevationStore.REQ_ATTR_AUTHORIZER, grant.authorizer(), RequestAttributes.SCOPE_REQUEST);
        }
        return true;
    }

    /** 没有就 403。 */
    public void require(String perm) { requireAny(List.of(perm)); }

    /**
     * 任一(认提权),都没有就 403。文案与写规则表被拒同一句(RBAC-SPEC §15.6):v4 新加的判权点上,
     * 原来那句「可以查看、点编辑模式旁的授权按钮」常常不成立 —— 只有抄表编辑的人删本期时连带删草稿催缴单,
     * 他可能根本看不了催缴单。前端缺权时自己弹授权窗,这句只是兜底。
     */
    public void requireAny(List<String> anyOf) {
        for (String p : anyOf) if (has(p)) return;
        throw new BizException(ResultCode.FORBIDDEN, ReadAccessManager.writeDeniedMessage(anyOf));
    }
}
