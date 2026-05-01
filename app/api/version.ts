// @ts-nocheck
import path from 'path';
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';

const FALLBACK_VERSION = '2.0.1';
const FALLBACK_DOWNLOAD_URL = '';
const FALLBACK_ARTIFACT_TYPE = 'installer';
const DEFAULT_SIGNED_URL_EXPIRES = 60 * 60 * 2;
const DEFAULT_GITHUB_OWNER = 'samuellucky2424-afk';
const DEFAULT_GITHUB_REPO = 'Format-Boy.Cam';
const DEFAULT_GITHUB_EXE_PATTERN = '^Format-Boy CAM Desktop Setup .*\\.exe$';

function trimSlashes(value = '') {
  return String(value).replace(/^\/+|\/+$/g, '').trim();
}

function buildPublicStorageUrl(baseUrl, bucket, objectPath) {
  const normalizedBaseUrl = String(baseUrl).trim().replace(/\/+$/g, '');
  const encodedPath = trimSlashes(objectPath)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');

  return `${normalizedBaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function resolveStoragePath(template, version) {
  return trimSlashes(String(template || '').replace(/\{version\}/g, version));
}

async function fetchGitHubRelease(owner, repo, exePattern) {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (!response.ok) return null;

    const release = await response.json();
    const exeAsset = release.assets.find((asset) => exePattern.test(asset.name));
    
    if (!exeAsset) return null;

    const version = release.tag_name.replace(/^v/, '');
    const downloadUrl = exeAsset.browser_download_url;
    const sha256 = release.body.match(/SHA256[:\s]+`?([a-f0-9]{64})`?/i)?.[1] || '';
    const notes = release.body || release.name || '';

    return {
      version,
      downloadUrl,
      sha256,
      notes,
      fileName: exeAsset.name,
      source: 'github-release',
    };
  } catch (error) {
    console.error('Failed to fetch GitHub release:', error);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Try GitHub releases first if configured
  const githubOwner = String(process.env.DESKTOP_GITHUB_OWNER || DEFAULT_GITHUB_OWNER).trim();
  const githubRepo = String(process.env.DESKTOP_GITHUB_REPO || DEFAULT_GITHUB_REPO).trim();
  const githubExePattern = String(process.env.DESKTOP_GITHUB_EXE_PATTERN || DEFAULT_GITHUB_EXE_PATTERN).trim();
  
  if (githubOwner && githubRepo) {
    const gitHubRelease = await fetchGitHubRelease(githubOwner, githubRepo, new RegExp(githubExePattern, 'i'));
    if (gitHubRelease) {
      return res.status(200).json({
        version: gitHubRelease.version,
        download_url: gitHubRelease.downloadUrl,
        artifact_type: 'installer',
        sha256: gitHubRelease.sha256 || undefined,
        notes: gitHubRelease.notes || undefined,
        file_name: gitHubRelease.fileName,
        source: gitHubRelease.source,
      });
    }
  }

  // Fall back to environment-configured or Supabase approach
  const version = String(process.env.DESKTOP_LATEST_VERSION || FALLBACK_VERSION).trim();
  const fallbackDownloadUrl = String(process.env.DESKTOP_DOWNLOAD_URL || FALLBACK_DOWNLOAD_URL).trim();
  const artifactType = String(process.env.DESKTOP_ARTIFACT_TYPE || FALLBACK_ARTIFACT_TYPE).trim().toLowerCase();
  const sha256 = String(process.env.DESKTOP_DOWNLOAD_SHA256 || '').trim();
  const notes = String(process.env.DESKTOP_RELEASE_NOTES || '').trim();

  const storageBucket = trimSlashes(process.env.DESKTOP_SUPABASE_BUCKET || '');
  const storagePathTemplate = String(process.env.DESKTOP_SUPABASE_PATH || '').trim();
  const storageAccess = String(process.env.DESKTOP_SUPABASE_ACCESS || 'signed').trim().toLowerCase();
  const signedUrlExpires = Math.max(
    60,
    Number.parseInt(process.env.DESKTOP_SIGNED_URL_EXPIRES || `${DEFAULT_SIGNED_URL_EXPIRES}`, 10) || DEFAULT_SIGNED_URL_EXPIRES,
  );

  let downloadUrl = fallbackDownloadUrl;
  let source = 'direct-url';

  if (storageBucket && storagePathTemplate) {
    const objectPath = resolveStoragePath(storagePathTemplate, version);

    if (!objectPath) {
      return res.status(500).json({
        error: 'DESKTOP_SUPABASE_PATH resolved to an empty path',
      });
    }

    if (storageAccess === 'public') {
      const supabaseBaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

      if (!supabaseBaseUrl) {
        return res.status(500).json({
          error: 'Missing SUPABASE_URL for public Supabase Storage updater URLs',
        });
      }

      downloadUrl = buildPublicStorageUrl(supabaseBaseUrl, storageBucket, objectPath);
      source = 'supabase-public';
    } else {
      if (!supabaseAdmin) {
        return res.status(503).json({
          error: supabaseAdminConfigError || 'Supabase admin client is not configured',
        });
      }

      const { data, error } = await supabaseAdmin.storage
        .from(storageBucket)
        .createSignedUrl(objectPath, signedUrlExpires);

      if (error || !data?.signedUrl) {
        return res.status(500).json({
          error: error?.message || 'Failed to create signed Supabase Storage URL',
        });
      }

      downloadUrl = data.signedUrl;
      source = 'supabase-signed';
    }
  }

  if (!downloadUrl) {
    return res.status(503).json({
      error: 'No desktop release download is configured',
      version,
      source,
    });
  }

  return res.status(200).json({
    version,
    download_url: downloadUrl,
    artifact_type: artifactType === 'portable' ? 'portable' : 'installer',
    sha256: sha256 || undefined,
    notes: notes || undefined,
    file_name: path.basename(downloadUrl.split('?')[0] || ''),
    source,
  });
}
