# Huong Dan Tich Hop Zilcode Agent API

Tai lieu nay mo ta cach he thong Zilcode goi Worker RAG Agent de tao nhieu doan chat, gui cau hoi nguoi dung, nhan cau tra loi, va cho phep agent doc/ghi App Builder bang token Zilcode hien co.

## 1. Kien Truc Tich Hop

```txt
Zilcode App
  |
  | goi API + gui token/context moi request
  v
Worker RAG Backend
  |
  | quan ly conversation/history/pending action
  | chay agent loop
  | goi Zilcode API that
  v
Zilcode API / App Builder
```

Frontend Zilcode chi can:

- Goi API Worker.
- Gui message nguoi dung.
- Gui kem token/context Zilcode moi request.
- Hien thi danh sach doan chat.
- Hien thi lich su chat.
- Hien thi cau tra loi, loading, loi, debug neu can.

Worker se tu lam:

- Tao/xoa/lay danh sach doan chat.
- Luu lich su chat tren server.
- Tu lay vai tin nhan gan nhat de dua vao agent.
- Tu lay pending action theo `conversation_id`.
- Goi agent loop va cac tool App Builder/Zilcode.
- Luu user message, assistant answer, pending action, action log.

## 2. Base URL

Vi du:

```txt
https://ragorit.daovanda2405.workers.dev
```

Moi endpoint ben duoi duoc ghep sau base URL nay.

## 3. Header Bat Buoc

Moi request can gui kem token/context Zilcode hien tai.

```http
Authorization: Bearer <zilcode-token>
X-Zilcode-Base: https://demo.zilcode.com
X-Zilcode-UserId: 1580
X-Zilcode-Username: Demo Admin
X-Zilcode-SiteCode: demo
X-Zilcode-RoleId: 1
X-Zilcode-OrgId: 0
Content-Type: application/json
```

Ghi chu:

- `Authorization` la token Zilcode that da co san trong app Zilcode.
- Neu khong dung duoc `Authorization`, co the gui token qua `X-Zilcode-Token`.
- `X-Zilcode-UserId` va `X-Zilcode-SiteCode` duoc dung de phan vung conversation tren server.
- `X-Zilcode-RoleId` va `X-Zilcode-OrgId` duoc dung lam role/org context khi agent goi Zilcode API.

## 4. API Tong Quan

```txt
POST   /conversations
GET    /conversations
GET    /conversations/{conversation_id}
POST   /conversations/{conversation_id}/messages
DELETE /conversations/{conversation_id}
```

## 5. Tao Doan Chat Moi

```http
POST /conversations
```

Request body:

```json
{
  "title": "Chat quan ly don hang"
}
```

Response thanh cong:

```json
{
  "success": true,
  "conversation": {
    "conversation_id": "conv_abc",
    "title": "Chat quan ly don hang",
    "userid": "1580",
    "sitecode": "demo",
    "created_at": "2026-06-11T00:00:00.000Z",
    "updated_at": "2026-06-11T00:00:00.000Z",
    "messages_count": 0
  }
}
```

Frontend can luu `conversation_id` de gui tin nhan tiep theo.

## 6. Lay Danh Sach Doan Chat

```http
GET /conversations
```

Response thanh cong:

```json
{
  "success": true,
  "conversations": [
    {
      "conversation_id": "conv_abc",
      "title": "Chat quan ly don hang",
      "userid": "1580",
      "sitecode": "demo",
      "created_at": "2026-06-11T00:00:00.000Z",
      "updated_at": "2026-06-11T00:10:00.000Z",
      "messages_count": 4,
      "pending_action": {
        "kind": "prepare_change",
        "plan_id": "plan_123",
        "status": "ready_for_confirmation",
        "requires_confirmation": true
      }
    }
  ]
}
```

Danh sach duoc loc theo `X-Zilcode-UserId` va `X-Zilcode-SiteCode`.

## 7. Mo Lai Mot Doan Chat

```http
GET /conversations/{conversation_id}
```

Response thanh cong:

```json
{
  "success": true,
  "conversation": {
    "conversation_id": "conv_abc",
    "title": "Chat quan ly don hang",
    "userid": "1580",
    "sitecode": "demo",
    "created_at": "2026-06-11T00:00:00.000Z",
    "updated_at": "2026-06-11T00:10:00.000Z",
    "messages": [
      {
        "message_id": "msg_1",
        "role": "user",
        "content": "Tao app quan ly don hang",
        "created_at": "2026-06-11T00:01:00.000Z"
      },
      {
        "message_id": "msg_2",
        "role": "assistant",
        "content": "Toi da chuan bi ke hoach App Builder...",
        "created_at": "2026-06-11T00:01:05.000Z",
        "tools_called": ["app_builder_prepare_change"],
        "action_state": {
          "kind": "prepare_change",
          "plan_id": "plan_123",
          "status": "ready_for_confirmation",
          "requires_confirmation": true
        }
      }
    ],
    "pending_action": {
      "kind": "prepare_change",
      "plan_id": "plan_123",
      "status": "ready_for_confirmation",
      "requires_confirmation": true
    },
    "action_logs": []
  }
}
```

Frontend dung `messages` de render lai lich su chat. Khong can tu luu history o client.

## 8. Gui Tin Nhan Vao Doan Chat

```http
POST /conversations/{conversation_id}/messages
```

Request body:

```json
{
  "message": "Tao app quan ly don hang",
  "debug": false
}
```

Response thanh cong:

```json
{
  "success": true,
  "conversation_id": "conv_abc",
  "answer": "Toi da chuan bi ke hoach App Builder va chua ghi du lieu vao he thong...",
  "status": "needs_confirmation",
  "message": {
    "message_id": "msg_2",
    "role": "assistant",
    "content": "Toi da chuan bi ke hoach App Builder va chua ghi du lieu vao he thong...",
    "created_at": "2026-06-11T00:01:05.000Z",
    "tools_called": ["app_builder_prepare_change"]
  },
  "pending_action": {
    "kind": "prepare_change",
    "plan_id": "plan_123",
    "status": "ready_for_confirmation",
    "requires_confirmation": true
  },
  "action_state": {
    "kind": "prepare_change",
    "plan_id": "plan_123",
    "status": "ready_for_confirmation",
    "requires_confirmation": true
  },
  "tools_called": ["app_builder_prepare_change"]
}
```

Worker se tu:

1. Load conversation theo `conversation_id`.
2. Lay vai tin nhan gan nhat da luu tren server.
3. Lay `pending_action` neu co.
4. Build Zilcode context tu headers.
5. Goi agent loop.
6. Luu user message va assistant answer.
7. Cap nhat pending action/action log.

Frontend khong gui history.

## 9. Xac Nhan Thuc Hien Hanh Dong

Khi agent da tao pending plan va tra `status = "needs_confirmation"`, frontend chi can gui tin nhan xac nhan cua user vao cung conversation.

Request:

```http
POST /conversations/conv_abc/messages
```

```json
{
  "message": "co, thuc hien ke hoach",
  "debug": false
}
```

Neu agent apply thanh cong, response co the la:

```json
{
  "success": true,
  "conversation_id": "conv_abc",
  "answer": "Da thuc hien xong ke hoach App Builder...",
  "status": "completed",
  "pending_action": null,
  "action_state": {
    "kind": "apply_change",
    "plan_id": "plan_123",
    "status": "success",
    "ok": true,
    "applied_count": 8,
    "failed_count": 0,
    "skipped_count": 0
  },
  "tools_called": ["app_builder_apply_change"]
}
```

Neu apply loi, `status` se la `action_failed` va `answer` se noi ro loi chinh.

## 10. Xoa Doan Chat

```http
DELETE /conversations/{conversation_id}
```

Response thanh cong:

```json
{
  "success": true,
  "conversation_id": "conv_abc"
}
```

## 11. Status Co The Gap

Endpoint gui message co the tra cac `status` chinh:

```txt
ok
needs_confirmation
completed
action_failed
invalid_plan
```

Y nghia:

- `ok`: cau tra loi thong thuong, khong co action dang cho.
- `needs_confirmation`: agent da chuan bi plan ghi App Builder, can user xac nhan.
- `completed`: action da duoc apply thanh cong.
- `action_failed`: apply that bai hoac partial failure.
- `invalid_plan`: plan chua hop le, chua ghi du lieu.

## 12. Xu Ly Loi

Response loi co dang:

```json
{
  "success": false,
  "error": "Thong bao loi"
}
```

Mot so loi thuong gap:

- Thieu `Authorization` hoac `X-Zilcode-Token`.
- Thieu `X-Zilcode-UserId`.
- Thieu `X-Zilcode-SiteCode`.
- `conversation_id` khong ton tai.
- Token Zilcode het han hoac khong co quyen goi API Zilcode.

## 13. Vi Du Goi Bang JavaScript

```js
const baseUrl = "https://ragorit.daovanda2405.workers.dev";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${zilcodeToken}`,
  "X-Zilcode-Base": "https://demo.zilcode.com",
  "X-Zilcode-UserId": "1580",
  "X-Zilcode-Username": "Demo Admin",
  "X-Zilcode-SiteCode": "demo",
  "X-Zilcode-RoleId": "1",
  "X-Zilcode-OrgId": "0"
};

async function createConversation() {
  const res = await fetch(`${baseUrl}/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Chat App Builder" })
  });
  return await res.json();
}

async function sendMessage(conversationId, message) {
  const res = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, debug: false })
  });
  return await res.json();
}
```

## 14. Yeu Cau Bao Mat

- Khong dua token Zilcode vao query string.
- Nen gui token qua `Authorization: Bearer`.
- Khong log token o frontend.
- Neu bat `debug = true`, response co the co debug flow; chi nen bat trong moi truong dev/admin.
- Worker hien luu conversation trong KV binding `CHUNKS`. Neu can production-grade query/retention, co the doi implementation sang D1 ma giu nguyen API contract.

## 15. Checklist Tich Hop

- Lay duoc token Zilcode hien tai tu app Zilcode.
- Lay duoc `userid`, `sitecode`, `roleid`, `orgid`.
- Goi `POST /conversations` de tao chat.
- Goi `GET /conversations` de hien danh sach chat.
- Goi `GET /conversations/{conversation_id}` de mo lai chat.
- Goi `POST /conversations/{conversation_id}/messages` de gui message.
- Goi `DELETE /conversations/{conversation_id}` de xoa chat.
- Khi response co `status = "needs_confirmation"`, hien thi cau tra loi cho user va cho user gui tin nhan xac nhan.
- Khong tu gui history tu frontend; Worker da tu quan ly history server-side.
