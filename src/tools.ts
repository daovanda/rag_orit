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
      "Tìm trong Vector DB/KV docs các tài liệu Zilcode, App Builder guide, API contract, domain model và playbook tạo/sửa app. Dùng khi cần quy tắc hoặc thông tin tài liệu ngoài graph hiện tại và dùng khi user hỏi cách làm, hướng dẫn, quy tắc, API contract, logic Zilcode, hoặc cần kiến thức nền về zilcode.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tài liệu. Giữ các thuật ngữ Zilcode/App Builder quan trọng."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "app_builder_graph_overview",
    description:
      "Trả tổng quan App Builder thật ở dạng skeleton graph: root, app, site, service/appservice, table, column, window, tab, field, menu, domain, cache, workflow/wfstep, report, map/layer, archive, user/org/role/access và các cạnh liên kết. Dùng khi user hỏi toàn hệ thống, danh sách app, số lượng hoặc cần bản đồ ban đầu.",
    parameters: {
      type: "object",
      properties: {
        app_builder_appid: {
          type: "string",
          description: "Optional appid của App Builder, mặc định 1."
        },
        max_nodes: {
          type: "string",
          description: "Số node skeleton tối đa trả về, mặc định 250."
        },
        max_edges: {
          type: "string",
          description: "Số edge skeleton tối đa trả về, mặc định 500."
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 500."
        }
      }
    }
  },
  {
    name: "app_builder_graph_search",
    description:
      "Tìm node trong App Builder graph theo tên, id hoặc summary. Dùng để resolve appid/serviceid/tableid/windowid/tabid/fieldid/menuid/domainid/cacheid/role/access trước khi mở subgraph hoặc detail. Nếu user đã đưa node_id hoặc đã biết node_id chính xác, có thể dùng subgraph/detail trực tiếp.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Tên hoặc id cần tìm, ví dụ Order Management, n_table, Customer, window Role."
        },
        types: {
          type: "string",
          description: "Optional danh sách type lọc bằng dấu phẩy: app,table,column,window,tab,field,menu,domain,workflow,wfstep,report,map,layer,archive,user,org,role,access."
        },
        limit: {
          type: "string",
          description: "Số kết quả tối đa, mặc định 12."
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 500."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "app_builder_graph_subgraph",
    description:
      "Mở vùng graph liên quan quanh một hoặc nhiều node_id. Dùng khi user hỏi đi sâu, phân tích, cấu trúc, luồng hoặc liên kết quanh app/table/window/tab/field. Tool cũng nhận query nếu chưa biết node_id.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Một node id từ overview/search, ví dụ app:12 hoặc table:12:34."
        },
        node_ids: {
          type: "string",
          description: "Nhiều node id phân tách bằng dấu phẩy."
        },
        query: {
          type: "string",
          description: "Optional. Nếu không biết node_id, tool sẽ tìm node gần nhất theo query."
        },
        depth: {
          type: "string",
          description: "Độ sâu mở rộng graph, mặc định 1, tối đa 5."
        },
        max_nodes: {
          type: "string",
          description: "Số node tối đa trong subgraph, mặc định 120."
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 500."
        }
      }
    }
  },
  {
    name: "app_builder_node_detail",
    description:
      "Lấy detail của một node cụ thể trong App Builder graph: app/table/column/window/tab/field/menu/domain/workflow/wfstep/report/map/layer/archive/user/org/role/access. Dùng khi cần record chi tiết, columns/fields/neighbors hoặc khi subgraph chưa đủ để trả lời hoặc lập plan.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Node id cần lấy detail."
        },
        query: {
          type: "string",
          description: "Optional. Nếu không biết node_id, tool sẽ tìm node gần nhất theo query."
        },
        include_neighbors: {
          type: "string",
          description: "true/false. Mặc định true để trả inbound/outbound edges quanh node."
        },
        include_fields: {
          type: "string",
          description: "true/false. Mặc định true khi detail window/tab/table."
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 500."
        }
      }
    }
  },
  {
    name: "app_builder_creation_schema",
    description:
      "Trả quy tắc tạo/sửa App Builder ở dạng planning schema: app -> service/appservice -> table -> column và app -> window -> tab -> field/menu/domain/cache/role access. Có kèm ranh giới runtime ngoài App Builder như SQLCloud physical schema, source files, upload/proxy để agent không dùng nhầm App Builder tool cho các thao tác đó. Tool này không ghi dữ liệu.",
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
      "Chuẩn bị kế hoạch tạo/sửa/xóa App Builder để user xác nhận. Tool validate, lọc field không tồn tại theo metadata thật, resolve structured plan thành operations và lưu pending plan. Xóa app/window nên dùng cascade để dọn field/tab/menu/cache/role access trước. Chưa ghi dữ liệu.",
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
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 1000."
        }
      },
      required: ["operations"]
    }
  },
  {
    name: "app_builder_apply_change",
    description:
      "Thực thi pending plan đã tạo bởi app_builder_prepare_change. Chỉ dùng sau khi user xác nhận rõ ràng và có plan_id hợp lệ. Ghi vào Zilcode qua REST API và dừng ở bước lỗi đầu tiên.",
    parameters: {
      type: "object",
      properties: {
        plan_id: {
          type: "string",
          description: "Plan ID từ app_builder_prepare_change."
        }
      },
      required: ["plan_id"]
    }
  }
] as const;
