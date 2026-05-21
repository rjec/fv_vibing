export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface CrawledFileData {
  id: string;
  name: string;
  mimeType: string;
  content: string; // Transformed text summary or plain content
}

export interface GeneratedAsset {
  name: string;
  content: string;
  language: string;
}

export interface ProjectConfig {
  title: string;
  contentType: 'dashboard' | 'slides' | 'report' | 'website';
  prompt: string;
  themeColor: string;
  accentColor: string;
  fontPreset: 'inter' | 'space-grotesk' | 'playfair' | 'mono';
}
