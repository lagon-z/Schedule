# Support Team Schedule - Local Setup Guide

Hướng dẫn này giúp bạn setup và chạy project local ngay, không cần đoán thêm bước nào.

## 1) Yêu cầu môi trường

- `git` >= 2.40
- `node` >= 20 (khuyến nghị: Node 22 LTS)
- `npm` >= 10
- Hệ điều hành: Linux / macOS / Windows (PowerShell hoặc Git Bash)

Kiểm tra nhanh:

```bash
git --version
node -v
npm -v
```

## 2) Lấy source code

Nếu bạn đã có thư mục project sẵn thì bỏ qua bước này.

```bash
git clone <YOUR_REPO_URL>
cd project_suport
```

## 3) Cài dependencies

```bash
npm install
```

## 4) Chạy local (development)

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Mở trình duyệt:

- `http://localhost:5173`
- hoặc IP LAN do Vite in ra trong terminal

## 5) Build và lint (để chắc chắn code sạch)

```bash
npm run lint
npm run build
```

## 6) Các tính năng chính đã có

- Weekly 24/7 schedule (Mon-Sun, 24h)
- Drag shift theo chiều dọc/ngang (đổi giờ/ngày)
- Resize shift theo cạnh dưới (snap 30 phút)
- Split shifts (nhiều block/người/ngày, tối đa 3)
- Coverage gaps + Coverage Summary
- Manage Team: add/edit/delete member
- Week navigation: Prev / Next / Today + date range
- Import/Export JSON theo schema mở rộng
- **Delete operations (đã bổ sung):**
  - Xóa 1 block shift (`×`)
  - Cắt/xóa 1 đoạn trong shift (`✂`)
  - Xóa toàn bộ ca của 1 người trong 1 ngày (trong Add Shift modal)

## 7) Cách dùng nhanh phần xóa ca

### 7.1 Xóa cả ca làm (1 block)

- Hover vào block shift
- Bấm nút `×`
- Confirm để xóa

### 7.2 Xóa một phần trong ca (cut)

- Hover block shift, bấm `✂`
- Chọn `Remove From` và `Remove To`
- Bấm `Apply Remove Range`

Lưu ý:
- Nếu cắt giữa ca, hệ thống tự tách thành 2 block
- Các block còn lại phải >= 30 phút
- Không vượt quá 3 block/người/ngày

### 7.3 Xóa toàn bộ ca của một người trong ngày

- Bấm `+ Add Shift`
- Chọn đúng member + day
- Bấm `Delete all shifts for this member/day`

## 8) JSON Import/Export

### 8.1 Export

Nút `⬇️ Export JSON` tạo file có format:

```json
{
  "meta": {
    "weekNumber": 16,
    "weekStart": "2026-04-13",
    "weekEnd": "2026-04-19",
    "exportedAt": "2026-04-16T21:00:00+07:00"
  },
  "agents": [
    { "id": "tommy", "name": "Tommy", "color": "#7C3AED" }
  ],
  "schedule": [
    {
      "agentId": "tommy",
      "day": "Monday",
      "date": "2026-04-13",
      "shifts": [
        { "start": "09:00", "end": "18:00" },
        { "start": "21:00", "end": "23:00" }
      ]
    }
  ]
}
```

### 8.2 Import

- Bấm `⬆️ Import JSON`
- Chọn file `.json`
- Nếu hợp lệ: load tuần + merge agents + chỉnh sửa tiếp được
- Nếu lỗi: hệ thống hiển thị lỗi chi tiết ngay dưới toolbar

## 9) Cấu trúc thư mục chính

```text
src/
  App.tsx
  constants.ts
  types.ts
  data/
    seedWeek.ts
  store/
    scheduleStore.ts
  utils/
    date.ts
    importExport.ts
    schedule.ts
    time.ts
```

## 10) Troubleshooting

### Port 5173 đã bị chiếm

```bash
npm run dev -- --host 0.0.0.0 --port 5174
```

### Xóa cache rồi cài lại

```bash
rm -rf node_modules package-lock.json
npm install
```

### Build fail do version Node cũ

- Nâng Node lên >= 20
- Chạy lại:

```bash
npm install
npm run build
```

## 11) Bảo mật khi import file

- Chỉ chấp nhận `.json`
- Parse và validate schema chặt
- Kiểm tra id/name/color/date/time/day
- Kiểm tra overlap và giới hạn shifts/day
- Không dùng `eval`, không inject script, không lưu localStorage

## 12) Lệnh đầy đủ từ đầu đến chạy app

```bash
git clone <YOUR_REPO_URL>
cd project_suport
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Done. Mở `http://localhost:5173` là dùng được ngay.
