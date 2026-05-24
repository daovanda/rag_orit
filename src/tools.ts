const writeTargets = [
  ["app", "ứng dụng/NApplication"],
  ["table", "bảng metadata/NTable"],
  ["column", "cột metadata/NColumn"],
  ["window", "màn hình/NWindow"],
  ["tab", "tab/NTab"],
  ["field", "field/NField"],
  ["menu", "menu/NMenu"],
  ["domain", "domain/NDomain"]
] as const;

function createTool(target: string, label: string): Record<string, unknown> {
  return {
    name: `app_builder_create_${target}`,
    description:
      `Ghi dữ liệu App Builder: tạo mới ${label}. Chỉ dùng sau khi đã đọc zilcode_get_app_builder_blueprint, đã validate bằng app_builder_validate_plan và người dùng đã xác nhận rõ ràng. Tool bị chặn nếu thiếu confirmed=true.`,
    parameters: {
      type: "object",
      properties: {
        record: {
          type: "object",
          description: `Record cần tạo trong ${label}. Chỉ truyền các field chắc chắn đúng theo blueprint/plan đã validate.`
        },
        confirmed: {
          type: "boolean",
          description: "Bắt buộc true khi người dùng đã xác nhận plan. Nếu chưa xác nhận, không gọi tool này."
        },
        confirmation_note: {
          type: "string",
          description: "Tóm tắt ngắn câu xác nhận của người dùng hoặc lý do được phép ghi."
        }
      },
      required: ["record", "confirmed"]
    }
  };
}

function updateTool(target: string, label: string): Record<string, unknown> {
  return {
    name: `app_builder_update_${target}`,
    description:
      `Ghi dữ liệu App Builder: cập nhật ${label}. Phải resolve ID thật từ blueprint trước, validate plan và chỉ chạy khi người dùng đã xác nhận rõ ràng. Tool bị chặn nếu thiếu confirmed=true.`,
    parameters: {
      type: "object",
      properties: {
        key_value: {
          type: "string",
          description: "Giá trị khóa chính của record cần cập nhật, ví dụ appid/tableid/windowid/tabid/fieldid/menuid/domainid."
        },
        where: {
          type: "string",
          description: "Điều kiện where rõ ràng nếu không dùng key_value. Chỉ dùng khi đã chắc chắn không cập nhật nhầm nhiều record."
        },
        patch: {
          type: "object",
          description: `Các field cần cập nhật cho ${label}. Không truyền field không đổi hoặc field chưa chắc chắn.`
        },
        confirmed: {
          type: "boolean",
          description: "Bắt buộc true khi người dùng đã xác nhận plan. Nếu chưa xác nhận, không gọi tool này."
        },
        confirmation_note: {
          type: "string",
          description: "Tóm tắt ngắn câu xác nhận của người dùng hoặc lý do được phép ghi."
        }
      },
      required: ["patch", "confirmed"]
    }
  };
}

export const TOOLS = [
  {
    name: "general_chat",
    description:
      "Trả lời hội thoại thông thường bằng kiến thức sẵn có của trợ lý. Dùng cho chào hỏi, cảm ơn, hỏi trợ lý là ai/có thể làm gì, câu hỏi ngoài Zilcode, hoặc câu hỏi kiến thức chung không cần tra cứu tài liệu Zilcode.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Tin nhắn người dùng cần trả lời trực tiếp"
        }
      },
      required: ["message"]
    }
  },
  {
    name: "rag_search",
    description:
      "Tra cứu kho tài liệu Zilcode đã ingest, gồm tài liệu hướng dẫn sử dụng, quản trị và doc/logic về cách Zilcode/App Builder hoạt động. Dùng khi cần giải thích tính năng, hướng dẫn thao tác, kiến trúc, API contract, domain model, window/tab/field config, hoặc cần playbook để lập plan tạo/sửa App Builder.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tìm kiếm tài liệu. Giữ thuật ngữ Zilcode quan trọng và thêm ngữ cảnh nếu có."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "draw_chart",
    description:
      "Tạo ảnh biểu đồ, sơ đồ, flowchart, timeline, mindmap, dashboard mockup hoặc infographic bằng model ảnh Flux. Dùng khi người dùng yêu cầu vẽ hoặc tạo hình minh họa trực quan.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Mô tả ảnh biểu đồ/sơ đồ cần tạo: loại biểu đồ, dữ liệu chính, bố cục, phong cách, màu sắc và ngôn ngữ nhãn nếu có."
        },
        width: {
          type: "string",
          description: "Chiều rộng ảnh, mặc định 1024. Giá trị hợp lệ từ 256 đến 1920."
        },
        height: {
          type: "string",
          description: "Chiều cao ảnh, mặc định 768. Giá trị hợp lệ từ 256 đến 1920."
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "zilcode_get_app_builder_blueprint",
    description:
      "Read-only tool dành cho Role System dùng App Builder. Lấy blueprint của chính App Builder: App Builder có gì, đang quản lý những app nào, mỗi app có bảng/cột/window/tab/field/menu/domain/relation nào và graph quan hệ ra sao. Mặc định chỉ đọc App Builder, không quét toàn bộ app trong phiên. Nếu graph chưa đủ, gọi lại mode=subgraph hoặc mode=detail với node_id/node_ids.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "graph | subgraph | detail. Mặc định graph. graph trả bản đồ compact; subgraph trả vùng liên quan quanh node_id; detail trả dữ liệu chi tiết của node_id/node_ids."
        },
        appid: {
          type: "string",
          description: "Optional appid của App Builder, mặc định 1. Chỉ đổi khi App Builder ở môi trường khác có appid khác."
        },
        node_id: {
          type: "string",
          description: "Optional graph node id cần đào sâu, ví dụ app:1, window:101, table:1:Customer, tab:101:5. Lấy node_id từ kết quả mode=graph."
        },
        node_ids: {
          type: "string",
          description: "Optional danh sách node id, phân tách bằng dấu phẩy, dùng cho subgraph/detail khi cần nhiều node."
        },
        depth: {
          type: "string",
          description: "Độ sâu mở rộng quanh node_id cho mode=subgraph, mặc định 1, tối đa 4."
        },
        include_fields: {
          type: "string",
          description: "true/false. Mặc định false với graph/subgraph và true với detail. Chỉ bật true khi cần field trong tab/window liên quan."
        },
        include_raw: {
          type: "string",
          description: "true/false. Mặc định false. Chỉ bật true khi debug vì raw payload có thể lớn."
        },
        include_records: {
          type: "string",
          description: "true/false. Mặc định true. Đọc record cấu hình hiện có trong các bảng App Builder như NApplication, NTable, NColumn, NWindow, NTab, NField, NMenu."
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc cho mỗi bảng cấu hình App Builder, mặc định 500."
        },
        max_windows_per_app: {
          type: "string",
          description: "Số window/cache tối đa của App Builder cần đọc, mặc định 50."
        }
      }
    }
  },
  {
    name: "app_builder_prepare_plan",
    description:
      "Chuẩn bị kế hoạch tạo/sửa App Builder theo cơ chế Plan -> Resolve -> Validate -> Confirm. Tool đọc blueprint, resolve appid/tableid/windowid/tabid/columnid nếu có, chuẩn hóa operation, kiểm tra trùng/thiếu thông tin và lưu pending plan khi hợp lệ. Dùng tool này cho mọi yêu cầu tạo app, thêm/sửa table, column, window, tab, field, menu hoặc domain trước khi apply.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "Ý định tổng quát, ví dụ create_app, add_table, add_column, update_table, create_window."
        },
        plan: {
          type: "object",
          description: "Plan cấp nghiệp vụ. Nên có app, tables, windows, menus hoặc operations/steps. Không cần tự truyền ID nếu có thể resolve từ blueprint."
        },
        operations: {
          type: "array",
          description: "Danh sách operation nếu không truyền trong plan.operations."
        }
      }
    }
  },
  {
    name: "app_builder_apply_plan",
    description:
      "Thực thi pending plan đã được app_builder_prepare_plan lưu và người dùng đã xác nhận. Tool chạy tuần tự ở backend, tự map ID sau mỗi bước, apply các create/update metadata App Builder và đọc lại blueprint để verify. Chỉ gọi khi confirmed=true; plan_id có thể bỏ trống nếu dùng pending plan mới nhất của phiên.",
    parameters: {
      type: "object",
      properties: {
        plan_id: {
          type: "string",
          description: "ID pending plan do app_builder_prepare_plan trả về. Có thể bỏ trống để dùng pending plan mới nhất trong phiên."
        },
        confirmed: {
          type: "boolean",
          description: "Bắt buộc true khi người dùng đã xác nhận rõ ràng."
        },
        confirmation_note: {
          type: "string",
          description: "Tóm tắt câu xác nhận của người dùng."
        }
      },
      required: ["confirmed"]
    }
  },
  {
    name: "app_builder_validate_plan",
    description:
      "Validate kế hoạch tạo/sửa App Builder trước khi ghi. Tool chỉ đọc blueprint, kiểm tra thiếu field bắt buộc, trùng app/table/window/menu/domain, thiếu quan hệ app/table/window/tab/column và trả blocking_errors/warnings. Luôn gọi trước các create/update tool.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "Ý định tổng quát, ví dụ create_app, add_window, update_field."
        },
        plan: {
          type: "object",
          description: "Plan có cấu trúc, nên có steps/actions. Mỗi step có action, target, record hoặc patch."
        },
        actions: {
          type: "array",
          description: "Danh sách thao tác nếu không truyền plan.steps."
        }
      }
    }
  },
  ...writeTargets.flatMap(([target, label]) => [
    createTool(target, label),
    updateTool(target, label)
  ])
];
