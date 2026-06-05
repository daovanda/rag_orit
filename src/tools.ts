export const TOOLS = [
  {
    name: "general_chat",
    description:
      "Trả lời hội thoại thông thường khi không cần tài liệu RAG hoặc dữ liệu Zilcode thật.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Tin nhắn người dùng cần trả lời trực tiếp."
        }
      },
      required: ["message"]
    }
  },
  {
    name: "rag_search",
    description:
      "Tìm trong Vector DB/KV docs các tài liệu Zilcode, App Builder guide, API contract, domain model, window/tab/field config và playbook tạo/sửa app.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Cau truy van tai lieu. Nen giu thuat ngu Zilcode/App Builder quan trong."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "app_builder_graph_overview",
    description:
      "Đọc App Builder thật và trả skeleton graph toàn hệ thống: root, apps, services/appservices, tables, columns, windows, tabs, fields, menus, domains, caches, role/app/menu/table access và edges liên kết. Dùng đầu tiên khi hỏi về App Builder hoặc cần tạo/sửa cấu hình.",
    parameters: {
      type: "object",
      properties: {
        app_builder_appid: {
          type: "string",
          description: "Optional appid cua App Builder, mac dinh 1."
        },
        max_nodes: {
          type: "string",
          description: "So node skeleton toi da tra ve, mac dinh 250."
        },
        max_edges: {
          type: "string",
          description: "So edge skeleton toi da tra ve, mac dinh 500."
        },
        max_records_per_table: {
          type: "string",
          description: "So record toi da doc tu moi bang App Builder metadata, mac dinh 500."
        }
      }
    }
  },
  {
    name: "app_builder_graph_search",
    description:
      "Tìm node trong App Builder graph theo tên/id/summary. Dùng để resolve appid, serviceid, tableid, windowid, tabid, fieldid, menuid, domainid, cacheid hoặc role/access node trước khi mở subgraph/detail.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Ten/id can tim, vi du Order Management, n_table, Customer, window Role."
        },
        types: {
          type: "string",
          description: "Optional danh sach type loc bang dau phay: app,table,column,window,tab,field,menu,domain."
        },
        limit: {
          type: "string",
          description: "So ket qua toi da, mac dinh 12."
        },
        max_records_per_table: {
          type: "string",
          description: "So record toi da doc tu moi bang App Builder metadata, mac dinh 500."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "app_builder_graph_subgraph",
    description:
      "Mở vùng graph liên quan quanh một hoặc nhiều node_id. Dùng sau overview/search khi cần xem quan hệ lân cận của app/table/window/tab/field.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Một node id từ overview/search, ví dụ app:12 hoặc table:12:34."
        },
        node_ids: {
          type: "string",
          description: "Nhieu node id phan tach bang dau phay."
        },
        query: {
          type: "string",
          description: "Optional. Nếu không biết node_id, tool sẽ tìm node gần nhất theo query."
        },
        depth: {
          type: "string",
          description: "Do sau mo rong graph, mac dinh 1, toi da 5."
        },
        max_nodes: {
          type: "string",
          description: "So node toi da trong subgraph, mac dinh 120."
        },
        max_records_per_table: {
          type: "string",
          description: "So record toi da doc tu moi bang App Builder metadata, mac dinh 500."
        }
      }
    }
  },
  {
    name: "app_builder_node_detail",
    description:
      "Lấy detail của một node cụ thể trong App Builder graph: app/table/column/window/tab/field/menu/domain. Dùng khi subgraph chưa đủ để trả lời hoặc cần lập plan tạo/sửa.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Node id can lay detail."
        },
        query: {
          type: "string",
          description: "Optional. Nếu không biết node_id, tool sẽ tìm node gần nhất theo query."
        },
        include_neighbors: {
          type: "string",
          description: "true/false. Mac dinh true de tra inbound/outbound edges quanh node."
        },
        include_fields: {
          type: "string",
          description: "true/false. Mac dinh true khi detail window/tab/table."
        },
        max_records_per_table: {
          type: "string",
          description: "So record toi da doc tu moi bang App Builder metadata, mac dinh 500."
        }
      }
    }
  },
  {
    name: "app_builder_creation_schema",
    description:
      "Trả quy tắc tạo/sửa App Builder ở dạng planning schema: app -> appservice/service -> table -> column và app -> window -> tab -> field/menu/domain/cache/role access. Tool này không ghi dữ liệu.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "create_app, add_table, add_window, add_tab, add_field, update_node hoặc general."
        }
      }
    }
  },
  {
    name: "app_builder_prepare_change",
    description:
      "Chuẩn bị kế hoạch tạo/sửa/xóa App Builder để user xác nhận. Tool validate, lọc field không tồn tại theo metadata thật, resolve structured plan thành operations và lưu pending plan. Xóa app/window phải dùng cascade để dọn field/tab/menu/cache/role access trước. Chưa ghi dữ liệu.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "create_app, add_table, add_window, add_field, update_node, delete_node..."
        },
        summary: {
          type: "string",
          description: "Tóm tắt yêu cầu người dùng."
        },
        operations: {
          type: "array",
          description: "Danh sách operation. Mỗi operation có op/action và record/id_value/where. Có thể dùng reference như $create_app_1.appid để nối output bước trước.",
          items: {
            type: "object",
            additionalProperties: true
          }
        },
        max_records_per_table: {
          type: "string",
          description: "So record toi da doc tu moi bang App Builder metadata, mac dinh 1000."
        }
      },
      required: ["operations"]
    }
  },
  {
    name: "app_builder_apply_change",
    description:
      "Sau khi user xác nhận rõ ràng, thực thi pending plan đã tạo bởi app_builder_prepare_change. Ghi vào Zilcode qua REST API và dừng ở bước lỗi đầu tiên.",
    parameters: {
      type: "object",
      properties: {
        plan_id: {
          type: "string",
          description: "Plan ID tu app_builder_prepare_change."
        }
      },
      required: ["plan_id"]
    }
  }
] as const;
