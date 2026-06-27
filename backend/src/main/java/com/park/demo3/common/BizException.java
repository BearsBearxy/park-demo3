package com.park.demo3.common;
import lombok.Getter;
@Getter
public class BizException extends RuntimeException {
    private final int code;
    public BizException(ResultCode rc) { super(rc.message); this.code = rc.code; }
    public BizException(ResultCode rc, String message) { super(message); this.code = rc.code; }
}
