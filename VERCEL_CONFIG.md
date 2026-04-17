# Vercel Environment Variables Configuration

## Add these to Vercel Dashboard > Settings > Environment Variables

### For GitHub Releases (NEW - Primary)
These tell your `/api/version` endpoint where to find your releases:

```
Name: DESKTOP_GITHUB_OWNER
Value: lucky
Environment: Production

Name: DESKTOP_GITHUB_REPO
Value: Format-Boy
Environment: Production

Name: DESKTOP_GITHUB_EXE_PATTERN
Value: Format-Boy.*\.exe$
Environment: Production
```

### Keep Existing Variables
These are still needed for the app to build/run:

```
Name: VITE_API_BASE_URL
Value: https://format-boy-cam.vercel.app/api
Environment: Production

Name: VITE_PAYSTACK_PUBLIC_KEY
Value: [from your .env]
Environment: Production

Name: VITE_SUPABASE_URL
Value: [from your .env]
Environment: Production

Name: VITE_SUPABASE_ANON_KEY
Value: [from your .env]
Environment: Production
```

## Fallback Variables (Optional - Keep if using Supabase as backup)
If you want to keep Supabase as a fallback when GitHub is not configured:

```
Name: DESKTOP_SUPABASE_BUCKET
Value: [bucket-name]
Environment: Production

Name: DESKTOP_SUPABASE_PATH
Value: updates/v{version}/app.exe
Environment: Production

Name: DESKTOP_SUPABASE_ACCESS
Value: signed
Environment: Production
```

## Steps to Configure in Vercel
1. Go to https://vercel.com/dashboard
2. Select your Format-Boy project
3. Go to Settings → Environment Variables
4. Add each variable above (copy-paste the Name and Value)
5. Select "Production" environment
6. Click "Save"
7. Redeploy to apply changes: Deploy → Redeploy

### How to Copy from Local .env
Your current `.env` file contains sensitive keys. When copying to Vercel:
- Use the values from your `.env` file
- Never commit secrets to GitHub
- Vercel secrets are encrypted and safe

## Testing
After setting environment variables, test your endpoint:
```bash
curl https://format-boy-cam.vercel.app/api/version
```

Should return: `{"version": "...", "download_url": "...", ...}`

If it returns error, check Vercel Function logs.
