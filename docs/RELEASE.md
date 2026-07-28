# Aether · 发布说明

**当前冻结版本：1.0.7**
升号规则：见 [`ROADMAP.md`](ROADMAP.md)。

## 本地门禁

```bash
cd apps/desktop
npm run check          # tsc + test + vite build
# 或
node scripts/release.mjs
```

## Windows 安装包

```bash
cd apps/desktop
npx tauri build --bundles nsis,msi
```

产物：

- `src-tauri/target/release/bundle/nsis/Aether_*_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Aether_*_x64_en-US.msi`

GitHub Release 示例：`https://github.com/zhiyang66/Aether/releases`

## 版本号同步清单（仅当你决定升号时）

- [ ] `apps/desktop/package.json` → `version`
- [ ] `apps/desktop/src-tauri/tauri.conf.json` → `version`
- [ ] 设置 → 关于页文案 / 更新检查 current
- [ ] `docs/CHANGELOG.md` 新增章节
- [ ] `docs/ROADMAP.md` 更新当前版本
- [ ] 根 `README.md` / `apps/desktop/README.md` 版本说明

## 代码签名（可选）

| 平台 | 说明 |
|------|------|
| Windows | 证书配置见 Tauri bundle 文档；未签名时 SmartScreen 可能提示 |
| macOS | Developer ID + notarization（1.0 非必须） |
| Linux | 按发行渠道 |

## 自动更新

关于页会在软件内下载 Windows 安装包并启动安装程序。每次发布时，更新 `apps/desktop/public/version.json`：

```json
{
  "version": "1.0.7",
  "notes": "更新说明",
  "downloadUrl": "https://github.com/zhiyang66/Aether/releases/download/v1.0.7/Aether_1.0.7_x64-setup.exe",
  "downloadName": "Aether_1.0.7_x64-setup.exe"
}
```

`downloadUrl` 必须是 GitHub Releases 的 HTTPS 直链，且安装包为 `.exe` 或 `.msi`。未提供该字段时，客户端只显示版本可用，不会跳转外部下载页。

## 不包含

- 自动上传应用商店、云许可证  
