# GitHub Releases Automation Setup Guide

## Overview
This guide explains how to set up GitHub Actions to automatically build, release, and host your Format-Boy Desktop updates using GitHub Releases instead of Supabase Storage.

## What's Been Set Up

### 1. GitHub Actions Workflow (`.github/workflows/release.yml`)
When you push a version tag (e.g., `v1.0.0`), GitHub Actions will:
- Check out your code
- Install dependencies  
- Build the Windows .exe using `npm run electron:build`
- Calculate the SHA256 hash
- Create a GitHub Release
- Upload the .exe as a release asset

### 2. Updated `/api/version` Endpoint
The endpoint now supports GitHub Releases as the primary source:
- First tries to fetch from GitHub Releases API if configured
- Falls back to Supabase Storage or direct URL if GitHub is not configured
- Extracts version, download URL, SHA256, and release notes from GitHub

## Setup Steps

### Step 1: Push Your Workflow to GitHub
The `.github/workflows/release.yml` file is already created. Push it to your repo:
```bash
git add .github/workflows/release.yml
git commit -m "Add GitHub Actions release automation"
git push origin main
```

### Step 2: Configure Vercel Environment Variables
On your Vercel dashboard, add these environment variables to your project:

```
DESKTOP_GITHUB_OWNER=lucky  # Your GitHub username/organization
DESKTOP_GITHUB_REPO=Format-Boy  # Your repository name
DESKTOP_GITHUB_EXE_PATTERN=Format-Boy.*\.exe$  # Regex pattern for the .exe filename
```

**Optional:** If you still want to keep Supabase as a fallback, leave those variables as-is. GitHub will be checked first.

### Step 3: (Optional) Create Secrets for Local Testing
If you want to test the workflow locally or need to use secrets:
```bash
# These are already available as GitHub default secrets:
# - GITHUB_TOKEN (automatically provided)
```

## How to Release a New Version

### Simple Release Flow:
1. **Update your version in `app/package.json`:**
   ```json
   {
     "version": "1.0.1"
   }
   ```

2. **Commit and push the version bump:**
   ```bash
   git add app/package.json
   git commit -m "Bump version to 1.0.1"
   git push origin main
   ```

3. **Create and push a version tag:**
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

4. **GitHub Actions automatically:**
   - Builds the .exe
   - Creates a Release: `https://github.com/lucky/Format-Boy/releases/tag/v1.0.1`
   - Uploads the .exe as a release asset
   - Includes SHA256 hash in the release notes

5. **Your app immediately detects the update:**
   - Desktop app calls `/api/version`
   - Vercel fetches the latest GitHub Release
   - Returns download URL pointing to the GitHub Release asset
   - User sees "Update Available" notification

## Updating Release Notes

The workflow automatically includes SHA256 in the release description. To add custom release notes:

1. After the automated release is created, edit it on GitHub
2. Update the release description with your changelog
3. The `/api/version` endpoint will serve this to your users

### Release Note Format (auto-detected):
The endpoint looks for SHA256 in this format:
```
SHA256: `abc123def456...`
or
SHA256: abc123def456...
```

## Environment Variables Reference

### GitHub Mode (NEW - Primary)
```
DESKTOP_GITHUB_OWNER        # GitHub username/org
DESKTOP_GITHUB_REPO         # Repository name  
DESKTOP_GITHUB_EXE_PATTERN  # Regex for .exe filename (default: Format-Boy.*\.exe$)
```

### Supabase Mode (OLD - Fallback)
```
DESKTOP_SUPABASE_BUCKET     # Bucket name
DESKTOP_SUPABASE_PATH       # Path template (e.g., updates/v{version}/app.exe)
DESKTOP_SUPABASE_ACCESS     # 'public' or 'signed' (default: signed)
```

### Direct URL Mode (Fallback)
```
DESKTOP_LATEST_VERSION      # Version number
DESKTOP_DOWNLOAD_URL        # Direct download link
DESKTOP_ARTIFACT_TYPE       # 'portable' or 'installer'
DESKTOP_DOWNLOAD_SHA256     # SHA256 hash
DESKTOP_RELEASE_NOTES       # Release notes/changelog
```

## Testing the Setup

### Test 1: Verify Workflow Syntax
```bash
# GitHub Actions workflow is valid (no action needed, will fail at push if invalid)
```

### Test 2: Create a Test Release
```bash
# Create and push a test tag
git tag v1.0.0-test
git push origin v1.0.0-test

# Watch the workflow on GitHub Actions tab
# Delete the tag after testing: git push origin :v1.0.0-test
```

### Test 3: Verify `/api/version` Endpoint
```bash
curl https://format-boy-cam.vercel.app/api/version
```

Should return something like:
```json
{
  "version": "1.0.1",
  "download_url": "https://github.com/lucky/Format-Boy/releases/download/v1.0.1/Format-Boy-Desktop-Setup-1.0.1.exe",
  "artifact_type": "portable",
  "sha256": "abc123...",
  "notes": "Release notes here...",
  "file_name": "Format-Boy-Desktop-Setup-1.0.1.exe",
  "source": "github-release"
}
```

## Troubleshooting

### Workflow doesn't trigger
- Verify the tag format matches: `v*.*.*` (e.g., `v1.0.0`)
- Check Actions tab on GitHub for workflow runs
- Verify `.github/workflows/release.yml` is on main branch

### Build fails in workflow
- Check the Actions logs for specific errors
- Verify all environment secrets are set (on Actions settings)
- Test `npm run electron:build` locally first

### `/api/version` returns wrong data
- Verify `DESKTOP_GITHUB_OWNER` and `DESKTOP_GITHUB_REPO` are set correctly
- Check that the .exe was successfully uploaded to the Release
- Look at Vercel Function logs for errors

### SHA256 not detected
- Ensure the release notes contain the SHA256 in one of these formats:
  - `SHA256: abc123...`
  - `SHA256: \`abc123...\``
- Manually add it to the release notes if needed

## Future Enhancements

Consider adding:
- Auto-bump version during workflow (e.g., with semver)
- Multiple artifact types (installer + portable)
- Changelog generation from commits
- Draft releases for testing
- Automatic rollout rate limiting

## Questions?

Refer to:
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Electron Builder Documentation](https://www.electron.build/)
