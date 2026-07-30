import { RAG_TOOL_ROUTING_GUIDANCE } from "./rag-knowledge";

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
      `Tìm trong Vector DB/KV các tài liệu đã được quản lý trong corpus. ${RAG_TOOL_ROUTING_GUIDANCE}`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn tài liệu độc lập. Giữ nguyên tên sản phẩm, phân hệ, bộ phận, chức năng và thuật ngữ Zilcode/App Builder/Đại Việt quan trọng."
        },
        queries: {
          type: "array",
          items: { type: "string" },
          maxItems: 2,
          description: "Các truy vấn bổ sung chỉ khi chúng bao phủ những khía cạnh khác nhau của cùng mục tiêu. Backend sẽ fusion kết quả, khử trùng chunk và rerank một lần."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "app_builder_graph_overview",
    description:
      "Trả tổng quan App Builder thật ở dạng skeleton cấp root/app: danh sách app, node_id/appid, counts/tóm tắt theo app và graph_counts toàn hệ thống. Tool này KHÔNG trả detail đầy đủ table/window/tab/field/menu/domain. Dùng khi user hỏi toàn hệ thống, danh sách app, số lượng app hoặc cần bản đồ ban đầu; sau đó dùng search/subgraph/node_detail để mở vùng chi tiết.",
    parameters: {
      type: "object",
      properties: {
        app_builder_appid: {
          type: "string",
          description: "Optional appid của App Builder, mặc định 1."
        },
        max_apps: {
          type: "string",
          description: "Số app tối đa trả trong overview, mặc định 100."
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
          description: "Tên, id hoặc node hint cần tìm, ví dụ app <appid>, window <windowid>, n_table, table metadata, role system."
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
          description: "Một node id từ overview/search, ví dụ app:<appid> hoặc table:<appid>:<tableid>."
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
      "Chuẩn bị kế hoạch tạo/sửa/xóa App Builder để user xác nhận. Tool đọc live metadata schema, materialize default đã chứng minh, resolve reference, validate dependency/semantic và compile application_specification thành operation DAG. Field không tồn tại hoặc field bắt buộc không suy ra được sẽ tạo structured blocking_errors, không bị âm thầm bỏ. Update/delete phải dùng metadata ID chính xác; xóa dependency dùng chung chỉ hợp lệ khi operation có allow_shared_dependency_delete=true theo xác nhận rõ ràng. Tool lưu pending plan nhưng chưa ghi Zilcode.",
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
          description: "Danh sách operation mức thấp. Mỗi operation cần id duy nhất, op như create_window/update_window/delete_window, record hoặc id_value chính xác, depends_on nếu có. Có thể dùng reference như $create_app_1.appid. Không dùng where hàng loạt cho update/delete. allow_shared_dependency_delete chỉ được đặt true khi user đã xác nhận xóa dependency dùng chung.",
          items: {
            type: "object",
            additionalProperties: true
          }
        },
        application_specification: {
          type: "object",
          description: "Specification khai báo app metadata đích. Ưu tiên dạng này khi tạo app nhiều thành phần; backend validate và compile deterministic theo phase.",
          properties: {
            app: { type: "object", additionalProperties: true },
            services: { type: "array", items: { type: "object", additionalProperties: true } },
            appservices: { type: "array", items: { type: "object", additionalProperties: true } },
            service_bindings: { type: "array", items: { type: "object", additionalProperties: true } },
            tables: {
              type: "array",
              description: "Table metadata; mỗi table có thể chứa columns[]. Dùng service_ref để nối service trong cùng specification.",
              items: { type: "object", additionalProperties: true }
            },
            domains: { type: "array", items: { type: "object", additionalProperties: true } },
            relations: {
              type: "array",
              description: "Patch relation có target=column hoặc target=tab và *_ref tới entity đã khai báo.",
              items: { type: "object", additionalProperties: true }
            },
            windows: {
              type: "array",
              description: "Window metadata; mỗi window có thể chứa tabs[], mỗi tab có fields[]. Dùng table_ref, column_ref, parenttab_ref, domain_ref và lookup_table để nối theo tên/ref.",
              items: { type: "object", additionalProperties: true }
            },
            menus: { type: "array", items: { type: "object", additionalProperties: true } },
            roleapps: { type: "array", items: { type: "object", additionalProperties: true } },
            rolemenus: { type: "array", items: { type: "object", additionalProperties: true } },
            accesses: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          additionalProperties: false
        },
        max_records_per_table: {
          type: "string",
          description: "Số record tối đa đọc từ mỗi bảng App Builder metadata, mặc định 1000."
        }
      }
    }
  }
] as const;
