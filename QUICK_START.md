# Quick Start Checklist

## What's Ready Now ✅
- [x] GitHub Actions workflow created (`.github/workflows/release.yml`)
- [x] `/api/version` endpoint updated to support GitHub Releases
- [x] Setup documentation provided
- [x] Environment variable guides provided

## Your Action Items (In Order)

### 1. Push the Workflow to GitHub
```bash
git add .github/workflows/release.yml GITHUB_RELEASES_SETUP.md VERCEL_CONFIG.md
git commit -m "Add GitHub Actions release automation"
git push origin main
```

### 2. Set GitHub Secrets for Build
On GitHub (Repository Settings > Secrets and variables > Actions):

Add these secrets (so the Windows build can find your API keys):
- `VITE_API_BASE_URL`
- `VITE_PAYSTACK_PUBLIC_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Or leave them blank to use defaults from your package build.

### 3. Configure Vercel Environment Variables
On Vercel Dashboard > Project Settings > Environment Variables:

**Required:**
- `DESKTOP_GITHUB_OWNER` = `samuellucky2424-afk`
- `DESKTOP_GITHUB_REPO` = `Format-Boy.Cam`
- `DESKTOP_GITHUB_EXE_PATTERN` = `^Format-Boy CAM Desktop Setup .*\.exe$`

(See `VERCEL_CONFIG.md` for complete guide)

### 4. Test the Release Flow
```bash
# Bump version
# edit app/package.json: "version": "1.0.1"

git add app/package.json
git commit -m "Bump version to 1.0.1"
git tag v1.0.1
git push origin main v1.0.1
```

Then:
- Watch GitHub Actions tab for the build
- Check GitHub Releases page for the new release
- Test the endpoint: `curl https://format-boy-cam.vercel.app/api/version`

### 5. Verify Desktop App Updates
Within 15 seconds on your desktop app:
- Check for updates dialog appears
- Shows new version available
- Download and install button works

## Key Files Modified/Created

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | Automated build & release |
| `app/api/version.ts` | Now supports GitHub Releases |
| `GITHUB_RELEASES_SETUP.md` | Complete setup & usage guide |
| `VERCEL_CONFIG.md` | Environment variable reference |

## How the Flow Works (End-to-End)

```
1. You push a version tag (v1.0.1)
         ↓
2. GitHub Actions triggers automatically
         ↓
3. Builds Windows installer
         ↓
4. Creates GitHub Release
         ↓
5. Uploads installer to release
         ↓
6. Desktop app periodically calls /api/version
         ↓
7. Vercel calls GitHub API to get latest release
         ↓
8. Returns download URL pointing to GitHub Release asset
         ↓
9. Desktop app shows "Update Available"
         ↓
10. User clicks "Download & Install"
         ↓
11. Update downloads from GitHub and installs
```

## Timing

- **GitHub Actions build:** ~5-10 minutes
- **GitHub Release creation:** Instant (as part of build)
- **Desktop app update check:** Every 15 seconds (configurable)
- **User sees update:** ~15 seconds after release created

## Next Steps After Setup

### Regular Release Process
```bash
# 1. Make your changes
# 2. Update version in app/package.json
# 3. Commit and tag
git add .
git commit -m "Add new features"
npm version patch  # or minor/major
git push origin main
git push origin --tags
```

### That's it! 🎉
- Build happens automatically
- Release is created automatically  
- Your users get updates automatically

## Support Resources

- GitHub Actions Docs: https://docs.github.com/en/actions
- Release Automation Guide: See `GITHUB_RELEASES_SETUP.md`
- Environment Setup: See `VERCEL_CONFIG.md`

## Questions?

Check the appropriate guide:
- **How do I release?** → `GITHUB_RELEASES_SETUP.md` → "How to Release a New Version"
- **What env vars?** → `VERCEL_CONFIG.md`
- **Something's broken?** → `GITHUB_RELEASES_SETUP.md` → "Troubleshooting"
