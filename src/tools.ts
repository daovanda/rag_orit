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
      "Tra cứu kho tài liệu Zilcode đã ingest, gồm tài liệu hướng dẫn sử dụng, quản trị và doc/logic về cách Zilcode hoạt động. Dùng khi cần giải thích tính năng, hướng dẫn thao tác, kiến trúc, API contract, domain model, window/tab/field config, hoặc cần kiến thức logic để gọi tool Zilcode đúng hơn.",
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
          description: "Chieu rong anh, mac dinh 1024. Gia tri hop le tu 256 den 1920."
        },
        height: {
          type: "string",
          description: "Chieu cao anh, mac dinh 768. Gia tri hop le tu 256 den 1920."
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
  }
];
