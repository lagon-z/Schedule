# Windows EXE Guide

File chạy Windows đã build sẵn:

- `release/SupportTeamSchedule.exe`

## 1) Cách chạy trên Windows

1. Copy file `.exe` sang máy Windows.
2. Double-click `SupportTeamSchedule.exe`.
3. App chạy trực tiếp, không cần cài thêm Node/npm.

## 2) Kiểm tra hash (khuyến nghị)

Trên Windows (PowerShell):

```powershell
Get-FileHash .\SupportTeamSchedule.exe -Algorithm SHA256
```

Bạn tự lưu kết quả hash nội bộ để đối chiếu khi cần.

## 3) Các cấu hình bảo mật đã bật trong bản desktop

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- Chặn `window.open` vào webview mới
- Chặn điều hướng ngoài app, chỉ mở link ngoài bằng trình duyệt hệ thống
- Từ chối mọi permission request mặc định
- Preload API tối thiểu, không expose API nguy hiểm

## 4) Audit dependencies

- `npm audit` hiện tại: `0 vulnerabilities`
- Bản Electron đã nâng lên dòng đã vá advisory cũ (`^41.2.1`)

## 5) Lưu ý vận hành

- Đây là bản `portable` (1 file `.exe`), chạy độc lập.
- File chưa ký code-signing certificate thương mại, nên Windows SmartScreen có thể cảnh báo lần đầu.

## 6) Rebuild lại EXE nếu cần

```bash
npm install
npm run desktop:build:win
```

Output mới sẽ nằm trong thư mục `release/`.
