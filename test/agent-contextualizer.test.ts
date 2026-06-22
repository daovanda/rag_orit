import { describe, expect, it } from "vitest";
import {
  isExplicitWriteRequest,
  isWriteRequestAllowed,
  parseContextualizedRequest
} from "../src/agent";

describe("parseContextualizedRequest", () => {
  it("parses a rewritten request and resolved references", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Đổi tên app có appid 107 từ Quản lý nhà trọ thành Quản lý phòng trọ.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [
        {
          type: "app",
          id: 107,
          name: "Quản lý nhà trọ",
          source: "Lịch sử hội thoại gần nhất"
        }
      ]
    }));

    expect(result).toEqual({
      valid: true,
      rewritten_message: "Đổi tên app có appid 107 từ Quản lý nhà trọ thành Quản lý phòng trọ.",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: [
        {
          type: "app",
          id: "107",
          name: "Quản lý nhà trọ",
          source: "Lịch sử hội thoại gần nhất"
        }
      ]
    });
  });

  it("requires a non-empty rewritten message", () => {
    expect(parseContextualizedRequest(JSON.stringify({
      rewritten_message: "",
      needs_clarification: false,
      clarification_question: null,
      resolved_references: []
    }))).toBeNull();
  });

  it("supplies a safe clarification question when the model omits one", () => {
    const result = parseContextualizedRequest(JSON.stringify({
      rewritten_message: "Người dùng muốn xóa một đối tượng đã nhắc trước đó.",
      needs_clarification: true,
      clarification_question: null,
      resolved_references: []
    }));

    expect(result?.needs_clarification).toBe(true);
    expect(result?.clarification_question).toContain("nói rõ");
  });
});

describe("isExplicitWriteRequest", () => {
  it.each([
    "Hãy tạo app Quản lý kho",
    "Hãy giúp tôi tạo app Quản lý kho",
    "Bạn có thể tạo app Quản lý kho",
    "Đổi tên app 107 thành Quản lý phòng trọ",
    "Tôi muốn xóa window 1150",
    "Vui lòng cập nhật tên app này"
  ])("accepts an explicit write command: %s", message => {
    expect(isExplicitWriteRequest(message)).toBe(true);
  });

  it.each([
    "Hướng dẫn tôi tạo app Quản lý kho",
    "Làm thế nào để xóa window?",
    "Đừng xóa app 38",
    "Chưa cần sửa window này",
    "Tôi test tạo app và bị lỗi"
  ])("rejects non-action or negated text: %s", message => {
    expect(isExplicitWriteRequest(message)).toBe(false);
  });

  it("allows a clarified write continuation only when history contains an explicit write request", () => {
    const clarified = "Đổi tên app có appid 107 thành Quản lý phòng trọ.";
    const history = [
      { role: "user" as const, content: "Đổi tên app 107" },
      { role: "assistant" as const, content: "Bạn muốn đổi app 107 thành tên mới nào?" }
    ];
    const references = [{ type: "app", id: "107", source: "Lịch sử hội thoại gần nhất" }];

    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, history, references)).toBe(true);
    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, history)).toBe(false);
    expect(isWriteRequestAllowed("Quản lý phòng trọ", clarified, [], references)).toBe(false);
  });
});
