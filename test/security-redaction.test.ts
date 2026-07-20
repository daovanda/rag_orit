import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  redactSensitiveData,
  redactSensitiveString
} from "../src/security-redaction";

describe("security redaction", () => {
  it("redacts nested credentials without hiding harmless token counters", () => {
    expect(redactSensitiveData({
      token: "session-token",
      service: { credential: "service-password", max_tokens: 2048 },
      nvidia_api_key: "nvapi-real-value",
      token_count: 42
    })).toEqual({
      token: "<redacted>",
      service: { credential: "<redacted>", max_tokens: 2048 },
      nvidia_api_key: "<redacted>",
      token_count: 42
    });
  });

  it("redacts secrets embedded in error and URL strings", () => {
    const output = redactSensitiveString(
      "Authorization: Bearer abcdefghijklmnop; url=?access_token=token-value&siteid=1; key nvapi-abcdefghijk"
    );
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("token-value");
    expect(output).not.toContain("nvapi-abcdefghijk");
    expect(output).toContain("<redacted>");
  });

  it("supports a preserve placeholder for model-assisted payload repair", () => {
    expect(redactSensitiveData(
      { record: { client_secret: "must-not-leave-runtime" } },
      "",
      { replacement: "<redacted:preserve>" }
    )).toEqual({ record: { client_secret: "<redacted:preserve>" } });
  });

  it("recognizes credential fields but not model token settings", () => {
    expect(isSensitiveKey("serviceCredential")).toBe(true);
    expect(isSensitiveKey("NVIDIA_API_KEY")).toBe(true);
    expect(isSensitiveKey("max_tokens")).toBe(false);
    expect(isSensitiveKey("token_count")).toBe(false);
  });
});
