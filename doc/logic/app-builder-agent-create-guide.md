# App Builder Agent Create Guide

Tai lieu nay danh cho agent khi ho tro Role System phan tich, tao ke hoach tao app moi, hoac sua cau hinh trong App Builder.

Trang thai hien tai cua he thong tool:

- Agent chi co read/planning tools.
- Chua co write tool active.
- Khi user yeu cau tao/sua, agent chi duoc lap Proposed plan va noi ro chua ghi du lieu vao Zilcode.

## 1. Tool flow bat buoc

Agent phai di theo luong graph-first:

```text
User
  |
  v
Agent
  |
  |-- general_chat
  |
  |-- rag_search
  |     -> docs / guide / API contract
  |
  |-- app_builder_graph_overview
  |     -> skeleton graph toan he thong
  |
  |-- app_builder_graph_search
  |     -> tim node
  |
  |-- app_builder_graph_subgraph
  |     -> mo vung lien quan
  |
  |-- app_builder_node_detail
  |     -> lay detail node
  |
  |-- app_builder_creation_schema
  |     -> quy tac tao/sua
  |
  v
Final answer / Proposed plan
```

## 2. Nguyen tac chung

- Luon goi `app_builder_graph_overview` truoc khi phan tich App Builder hien tai.
- Dung `app_builder_graph_search` de resolve ten tu nhien thanh node id.
- Dung `app_builder_graph_subgraph` de hieu quan he quanh node.
- Dung `app_builder_node_detail` khi can du lieu chi tiet cua app/table/window/tab/field/menu/domain.
- Dung `app_builder_creation_schema` khi user yeu cau tao/sua app/table/window/tab/field/menu.
- Khong lap plan dua tren tri nho neu chua doc graph.
- Khong noi "da tao", "da ghi", "da cap nhat" neu chua co write tool va ket qua apply thanh cong.
- Khong tao trung app/table/window/menu/field neu graph cho thay node da ton tai.
- Neu user noi mo ho, tim node truoc; neu co nhieu ket qua, hoi lai.

## 3. Mo hinh graph App Builder

Doc App Builder nhu mot graph:

```text
root:app_builder
  -> app:{appid}
      -> table:{appid}:{tableid}
          -> column:{appid}:{tableid}:{columnid}
      -> window:{windowid}
          -> tab:{windowid}:{tabid}
              -> field:{windowid}:{tabid}:{fieldid}
      -> menu:{appid}:{menuid}
      -> domain:{domainid}
```

Canh quan trong:

```text
root manages_app app
app app_has_table table
table table_has_column column
app app_has_window window
window window_has_tab tab
tab tab_uses_table table
tab tab_has_field field
field field_maps_column column
field field_uses_domain domain
app app_has_menu menu
menu menu_links_window window
tab tab_parent_child tab
tab tab_uses_relation_table table
```

Khi tao nhanh moi, agent can tao du cac node va edge can thiet. Vi du app moi co window chinh phai co:

```text
app -> table -> column
app -> window -> tab -> field
tab -> table
field -> column
app -> menu -> window
```

## 4. Cac thao tac doc dung cach

### Hoi tong quan he thong

1. Goi `app_builder_graph_overview`.
2. Tra loi dua tren node counts, app nodes, table/window/menu/domain counts.
3. Neu user hoi sau ve app nao, dung `app_builder_graph_search` va `app_builder_graph_subgraph`.

### Hoi app/table/window cu the

1. Goi `app_builder_graph_search` voi query la ten user noi.
2. Neu match ro rang, goi `app_builder_node_detail`.
3. Neu can quan he, goi `app_builder_graph_subgraph` quanh node do.

### Hoi "bang X co lien ket voi dau khong"

1. Search bang X.
2. Subgraph depth 1 hoac 2 quanh table node.
3. Doc edges:
   - `tab_uses_table`: tab/window nao dang dung table.
   - `field_maps_column`: field nao dung column cua table.
   - `tab_uses_relation_table`: table quan he.
   - inbound/outbound neighbors trong node detail.

## 5. Tao app moi: chi lap Proposed plan

Khi user yeu cau tao app moi:

1. `app_builder_graph_overview`
2. `app_builder_creation_schema` voi intent `create_app`
3. Neu ten app co the trung, `app_builder_graph_search` theo app name/app code.
4. Lap Proposed plan.
5. Noi ro: "Hien tai chua co write tool active, nen day la ke hoach de apply sau khi bo sung write tool."

Thu tu tao branch moi:

```text
1. Create app
2. Create physical tables if needed
3. Create App Builder table metadata
4. Create columns
5. Create domains if needed
6. Create windows
7. Create tabs
8. Create fields
9. Create menus
10. Re-read graph to verify
```

Plan nen co dang:

```json
{
  "intent": "create_app",
  "app": {
    "appname": "Order Management",
    "description": "Manage customers, products, orders and order items"
  },
  "operations": [
    {
      "op": "create_app",
      "record": {
        "appname": "Order Management"
      },
      "creates": "app:<new>"
    },
    {
      "op": "create_table",
      "after": "create_app",
      "record": {
        "tablename": "orders",
        "alias": "Orders",
        "tabletype": "table"
      }
    }
  ],
  "required_edges": [
    "app -> table",
    "table -> column",
    "app -> window",
    "window -> tab",
    "tab -> table",
    "tab -> field",
    "field -> column",
    "app -> menu",
    "menu -> window"
  ],
  "requires_confirmation": true
}
```

## 6. Sua app/table/window hien co

Khi user muon sua mot doi tuong da co:

1. Overview neu chua co graph moi.
2. Search target.
3. Subgraph quanh target.
4. Node detail target.
5. Lap Proposed patch plan.

Vi du them field vao window:

```text
1. Search app
2. Search table
3. Search window
4. Detail table de xem column da co chua
5. Detail window/tab de biet tabid
6. Neu column chua co, plan tao column truoc
7. Plan tao field map toi column
8. Plan verify bang node detail/subgraph sau khi write tool duoc them
```

## 7. Khi nao can rag_search

Dung `rag_search` khi:

- Can API contract.
- Can giai thich App Builder runtime.
- Can quy tac window/tab/field.
- Can huong dan tao physical table/column.
- Graph co du lieu nhung khong du quy tac de quyet dinh.

Khong dung RAG thay cho graph khi can du lieu that hien tai. Graph moi la source of truth cho app/table/window/tab/field hien co.

## 8. Cach tra loi nguoi dung

Neu user hoi thong tin:

- Tra loi bang ngon ngu nghiep vu, khong viet nhu log.
- Neu co node id thi co the neu ngan gon trong ngoac khi huu ich.
- Ket thuc bang goi y dao sau tu nhien.

Neu user yeu cau tao/sua:

- Tom tat app/table/window/tab/field se tao/sua.
- Neu thieu thong tin, hoi lai.
- Neu du thong tin, dua Proposed plan.
- Nhac ro he thong hien chi co read/planning tools neu user muon agent apply that.

Mau cau:

```text
Mình có thể lập kế hoạch cấu hình app này. Hiện bộ tool đang ở chế độ đọc/lập kế hoạch, chưa có write tool active nên mình chưa ghi dữ liệu vào Zilcode.
```

## 9. Quy tac an toan

- Khong xoa node neu chua co dependency graph.
- Khong doi ID chinh nhu appid/tableid/windowid/tabid/fieldid/columnid.
- Khong tao field neu chua biet tab va column.
- Khong tao menu neu chua biet window.
- Khong tao tab con neu chua biet parent tab va link fields.
- Khong gan domain neu domain chua ton tai hoac chua co plan tao domain.
- Khong su dung session apps lam danh sach app nghiep vu. Danh sach app phai lay tu graph/inventory App Builder.
