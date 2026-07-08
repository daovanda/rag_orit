# App Builder Agent Create Guide

Tai lieu nay danh cho agent khi ho tro Role System phan tich, tao, sua hoac xoa cau hinh trong App Builder.

Trang thai tool hien tai:

- Read tools: doc/RAG va App Builder graph.
- Planning tool: `app_builder_prepare_change` de validate va luu pending plan.
- Apply tool: `app_builder_apply_change` de ghi vao Zilcode sau khi user xac nhan ro rang.
- Agent khong duoc noi "da tao/da sua/da xoa" tru khi `app_builder_apply_change` tra thanh cong.

## 1. Tool flow bat buoc

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
  |     -> skeleton cap root/app: danh sach app, appid/node_id, counts
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
  |     -> quy tac tao/sua/xoa
  |
  |-- app_builder_prepare_change
  |     -> validate + pending plan
  |
  |-- app_builder_apply_change
        -> chi apply sau user xac nhan
  |
  v
Final answer / Proposed plan / Apply result
```

## 2. Nguyen tac chung

- Dung `app_builder_graph_overview` khi user hoi tong quan he thong, danh sach app, so luong app, hoac khi da mat ngu can ban. Overview chi la skeleton cap root/app; khong du de ket luan chi tiet table/window/tab/field/menu/domain.
- Dung `app_builder_graph_search` de resolve ten tu nhien/id thanh node id khi user hoi mot app/table/window/tab/field/menu/domain cu the.
- Dung `app_builder_graph_subgraph` de hieu quan he quanh node, nhat la cau hoi ve "co nhung gi", "hoat dong ra sao", dependency, impact, table/window/menu lien quan.
- Dung `app_builder_node_detail` khi can chi tiet app/table/window/tab/field/menu/domain sau khi da resolve dung node.
- Dung `app_builder_creation_schema` khi user yeu cau tao/sua/xoa.
- Dung `app_builder_prepare_change` de tao pending plan co plan id.
- Chi dung `app_builder_apply_change` khi user vua xac nhan ro rang, vi du: "co, thuc hien ke hoach".
- Khong lap plan dua tren tri nho neu chua doc graph.
- Khong tao trung app/table/window/menu/field neu graph cho thay node da ton tai.
- Neu user noi mo ho, search truoc; neu co nhieu ket qua, hoi lai.

## 3. Mo hinh graph App Builder

Graph day du cua App Builder co cac nhanh sau, nhung `app_builder_graph_overview` khong tra day du nhanh nay. Overview chi tra root/app skeleton; muon mo nhanh sau thi dung search/subgraph/detail.

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

Khi tao nhanh moi, agent can tao du cac node va edge can thiet:

```text
app -> table -> column
app -> window -> tab -> field
tab -> table
field -> column
app -> menu -> window
```

## 4. Khi nao dung API/RAG

Dung `rag_search` khi:

- Can API contract.
- Can giai thich runtime Zilcode.
- Can quy tac window/tab/field.
- Can huong dan physical table/column.

Khong dung RAG thay cho graph khi can du lieu that hien tai. Graph la source of truth cho app/table/window/tab/field hien co.

## 5. Tao app moi

Khi user yeu cau tao app moi:

1. `app_builder_graph_overview` neu can danh sach app hien co hoac can tranh trung ten app.
2. `app_builder_creation_schema` voi intent `create_app`
3. Search ten app/app code de tranh trung.
4. Neu du thong tin, goi `app_builder_prepare_change`.
5. Tra plan id va tom tat buoc se ghi.
6. Sau khi user xac nhan, goi `app_builder_apply_change`.
7. Sau apply, goi graph/search/detail de verify neu user yeu cau hoac neu can bao cao day du.

Thu tu branch tao app:

```text
1. Create app
2. Create physical tables if write tool ho tro
3. Create App Builder table metadata
4. Create columns
5. Create domains if needed
6. Create windows
7. Create tabs
8. Create fields
9. Create menus
10. Re-read graph to verify
```

Plan operation mau:

```json
{
  "id": "create_app_1",
  "op": "create_app",
  "record": {
    "appname": "<ten ung dung>",
    "description": "<mo ta muc dich ung dung>"
  }
}
```

```json
{
  "id": "create_table_1",
  "op": "create_table",
  "record": {
    "appid": "$create_app_1.appid",
    "tablename": "<ten_bang_nghiep_vu>",
    "alias": "<nhan hien thi bang>",
    "tabletype": "table"
  }
}
```

Neu operation sau can ID sinh ra tu operation truoc, dung reference:

```text
$operation_id.field
```

Vi du:

```json
{
  "id": "create_column_1",
  "op": "create_column",
  "record": {
    "tableid": "$create_table_1.tableid",
    "columnname": "<ten_cot>",
    "datatype": "int"
  }
}
```

`app_builder_prepare_change` co the nhan plan co `operations`, hoac structured plan co `app`, `tables`, `windows`, `menus`.
Khi nhan structured plan, tool se chuyen thanh operations va tu noi app/table/window id neu du thong tin.

## 6. Sua app/table/window hien co

Quy trinh:

1. Overview chi khi can danh sach app/root hoac mat ngu can ban.
2. Search target.
3. Subgraph quanh target.
4. Node detail target.
5. Lap operation update/delete/create lien quan.
6. `app_builder_prepare_change`
7. Doi user xac nhan.
8. `app_builder_apply_change`
9. Verify bang graph.

Vi du them field vao window:

```text
1. Search app
2. Search table
3. Search window
4. Detail table de xem column da co chua
5. Detail window/tab de biet tabid
6. Neu column chua co, prepare plan tao column truoc
7. Prepare plan tao field map toi column
8. Apply sau xac nhan
9. Verify bang node detail/subgraph
```

## 7. Xoa

Xoa la thao tac rui ro cao. Mac dinh agent phai:

- Mo subgraph cua node can xoa.
- Liet ke dependency truc tiep.
- De xuat disable/hide neu phu hop thay vi delete.
- Chi prepare delete khi user yeu cau ro.
- Chi apply delete sau xac nhan ro rang.

Khong xoa:

- App con table/window/menu.
- Table con tab/field hoac record du lieu that.
- Column con field dang dung.
- Window con menu tro toi.
- Tab con field/tab con.
- Domain con field dang dung.

## 8. Cach tra loi nguoi dung

Neu user hoi thong tin:

- Tra loi dung cau hoi, khong ke lai JSON.
- Neu hoi tong quan he thong, chi tom tat cac app va diem dang chu y o cap app/root.
- Neu hoi mot app/table/window/tab/field/menu cu the, phai dung search/subgraph/detail de noi ve node do va quan he truc tiep; khong suy chi tiet tu overview.

Neu user yeu cau tao/sua/xoa:

- Noi ro ban hieu yeu cau nao.
- Neu thieu thong tin, hoi lai ngan gon.
- Neu du thong tin, prepare plan va tra plan id.
- Sau apply, bao thanh cong/that bai va buoc verify.

Noi dung bat buoc khi da prepare plan:

- Noi ro day moi la pending plan, chua ghi du lieu vao Zilcode.
- Dua `plan_id` dung nhu tool tra ve.
- Tom tat cac operation chinh va canh bao neu co.
- Yeu cau user xac nhan ro rang truoc khi apply.
- Khong them cau van co dinh neu no khong phu hop voi ngu canh hoi dap.

## 9. Quy tac an toan

- Khong doi ID chinh nhu appid/tableid/windowid/tabid/fieldid/columnid.
- Khong tao field neu chua biet tab va column.
- Khong tao menu neu chua biet window.
- Khong tao tab con neu chua biet parent tab va link fields.
- Khong gan domain neu domain chua ton tai hoac chua co plan tao domain.
- Khong su dung session apps lam danh sach app nghiep vu. Danh sach app phai lay tu graph/inventory App Builder.
