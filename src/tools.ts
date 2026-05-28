export const TOOLS = [
  {
    name: "general_chat",
    description:
      "Tra loi hoi thoai thong thuong khi khong can tai lieu RAG hoac du lieu Zilcode that.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Tin nhan nguoi dung can tra loi truc tiep."
        }
      },
      required: ["message"]
    }
  },
  {
    name: "rag_search",
    description:
      "Tim trong Vector DB/KV docs cac tai lieu Zilcode, App Builder guide, API contract, domain model, window/tab/field config va playbook tao/sua app.",
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
      "Doc App Builder that va tra skeleton graph toan he thong: root, apps, tables, columns, windows, tabs, fields, menus, domains va edges lien ket. Dung dau tien khi hoi ve App Builder hoac can tao/sua cau hinh.",
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
      "Tim node trong App Builder graph theo ten/id/summary. Dung de resolve appid, tableid, windowid, tabid, fieldid, domainid truoc khi mo subgraph/detail.",
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
      "Mo vung graph lien quan quanh mot hoac nhieu node_id. Dung sau overview/search khi can xem quan he lan can cua app/table/window/tab/field.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Mot node id tu overview/search, vi du app:12 hoac table:12:34."
        },
        node_ids: {
          type: "string",
          description: "Nhieu node id phan tach bang dau phay."
        },
        query: {
          type: "string",
          description: "Optional. Neu khong biet node_id, tool se tim node gan nhat theo query."
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
      "Lay detail cua mot node cu the trong App Builder graph: app/table/column/window/tab/field/menu/domain. Dung khi subgraph chua du de tra loi hoac can lap plan tao/sua.",
    parameters: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Node id can lay detail."
        },
        query: {
          type: "string",
          description: "Optional. Neu khong biet node_id, tool se tim node gan nhat theo query."
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
      "Tra quy tac tao/sua App Builder o dang planning schema: thu tu tao app/table/column/window/tab/field/menu, required edges va proposed plan format. Tool nay khong ghi du lieu.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "create_app, add_table, add_window, add_tab, add_field, update_node hoac general."
        }
      }
    }
  }
] as const;
