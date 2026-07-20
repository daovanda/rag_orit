export const RAG_KNOWLEDGE_SCOPE = [
  "tài liệu giới thiệu, quản trị và sử dụng Zilcode/App Builder",
  "hướng dẫn sử dụng Phần mềm Quản lý Sản xuất Nhựa Đại Việt, gồm quy trình vận hành theo bộ phận, nhập liệu, kế hoạch, sản xuất, kho, báo cáo và phân quyền"
].join("; ");

export const RAG_TOOL_ROUTING_GUIDANCE =
  `Phạm vi RAG hiện có: ${RAG_KNOWLEDGE_SCOPE}. ` +
  "Khi câu hỏi cần nội dung hướng dẫn, cách sử dụng, quy trình nghiệp vụ hoặc chức năng được mô tả trong các tài liệu này, phải dùng rag_search làm nguồn bằng chứng. " +
  "Không dùng general_chat để trả lời từ trí nhớ và không dùng graph App Builder thay cho tài liệu, trừ khi người dùng hỏi metadata/cấu hình hiện tại của hệ thống.";
