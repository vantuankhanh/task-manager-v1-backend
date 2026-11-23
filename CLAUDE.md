# CLAUDE.md – Task Manager v1 backend (task-manager-v1-backend)

Cập nhật lần cuối: 2026-11-23 (17.41 của VTK IAM, trong working tree, chưa commit: winston chỉ ghi tên lỗi và các dòng stack, không ghi message, `detail` hay `query`, kèm `error.code` đã lọc (17.48 (b)) (`src/loggers/errorLogFormat.js`, 10 test mới, 114 trên 114); trước đó: D49 (c) của VTK IAM xong trong working tree, chưa commit: nhật ký yêu cầu ghi mẫu route (ví dụ `/api/gettaskbyuser/:name`) thay cho đường dẫn thật khi có route khớp, thêm 3 test, sửa `fastify.log` thành `app.log` ở `src/server.js`; trước đó: ADR-020 của VTK IAM: `@vtk-iam/node` 0.7.0 trong `vendor/`, route `POST /api/iam/account-deleted` nhận thêm sự kiện rút lại đồng ý, thêm test cho sự kiện này và các trường hợp bị từ chối; chưa commit).

## 1. Quy tắc

- Theo quy tắc chung của chủ dự án (Van Tuan Khanh) trong `~/.claude/CLAUDE.md`: trả lời bằng tiếng Việt; mã, comment, lệnh và commit bằng tiếng Anh; không dùng em dash, dùng en dash "–"; tên biến đầy đủ, không viết tắt (trừ `id`, `url`, `http`, `json`, `db`, `ui`, `api`); comment là câu đầy đủ, nói vì sao và dẫn yêu cầu (ví dụ `FR-AUTHZ-10`, `ADR-020`).
- Git: chỉ commit, merge, push khi được yêu cầu trong lượt đó; "commit" là tạo nhánh từ `main`, commit bằng skill `git-commit`, fast-forward vào `main`, xóa nhánh local, không push. Conventional Commits, tiêu đề tối đa 72 ký tự, không có dòng co-author. Giữ nguyên thay đổi chưa commit của chủ dự án.
- Không log token, mã, cookie hay header `Authorization`; không bao giờ kết nối máy chủ production.
- `package.json`: không thêm trường `packageManager`; SDK của IAM nằm ở `vendor/vtk-iam-node-<phiên bản>.tgz`.
- Backend này không có script `dev:iam`. Không chạy `pnpm dev` / `npm run dev` với `.env` hiện có nếu chưa chắc `DB_*` trỏ tới database trên máy này; chạy local theo "Rehearsing locally" trong `docs/IAM-MIGRATION.md` (IAM `http://localhost:8007`, API cổng 8000, database nháp).
- Nội dung trang `/privacy` nằm ở repo frontend và phải đúng với mã ở đây (bảng, route, `src/utils/iamAccountDeletion.js`); đổi cách ẩn danh thì sửa trang đó cùng lúc.

## 2. Tổng quan

Fastify + PostgreSQL (`pg`), chạy dưới PM2. Đăng nhập chỉ qua VTK IAM bằng `@vtk-iam/node` (BFF, cookie httpOnly): `/api/auth/*`, `GET /api/me`; vai trò `admin` lấy từ access token của ứng dụng IAM `taskmanager-v1`. API: `https://api-taskmanager-v1.vantuankhanh.com`. Tài liệu: `Readme.md`, `docs/IAM-MIGRATION.md`.

Lệnh: `pnpm test` (hoặc `node --test "test/**/*.test.js"`; database giả và IAM giả, không cần mạng hay `.env`; hiện 104 test), `pnpm start` (production).

## 3. Tiến độ

- Xong: đăng nhập chỉ qua VTK IAM (2026-10-16), làm mới hồ sơ theo phiên IAM, ẩn danh người dùng khi IAM xóa tài khoản (2026-10-27, SDK 0.6.0).
- Đang làm (2026-11-22, chưa commit): ADR-020 của VTK IAM, phần ứng dụng: SDK 0.7.0; sự kiện `application-consent-withdrawn` ẩn danh giống khi xóa tài khoản; `docs/IAM-MIGRATION.md` và `Readme.md` đã cập nhật.
- Sau khi triển khai (backend rồi frontend): chủ dự án đặt URL `https://taskmanagerv1.vantuankhanh.com/privacy` và phiên bản `2026-11-22` cho ứng dụng `taskmanager-v1` ở console IAM.
