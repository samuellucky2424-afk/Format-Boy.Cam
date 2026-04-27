export const CURRENT_VERSION = '2.0.0';

export type DesktopArtifactType = 'portable' | 'installer';

export interface DesktopVersionManifest {
  version: string;
  download_url: string;
  artifact_type?: DesktopArtifactType;
  sha256?: string;
  notes?: string;
}
