export interface CloneRequest {
  url: string;
  destPath: string;
  options?: {
    linkModules?: boolean;
    autoOpen?: boolean;
  };
}

export type CloneLogLevel = "info" | "success" | "warn" | "error" | "step";

export interface CloneLogEntry {
  level: CloneLogLevel;
  message: string;
  timestamp: number;
}

export interface CloneProgressEvent {
  stage: "init" | "scaffold" | "extract" | "assets" | "codegen" | "verify" | "done" | "error";
  percent: number;
  log?: CloneLogEntry;
  result?: {
    destPath: string;
    siteTitle: string;
    assetsCount: number;
    componentsCount: number;
  };
  error?: string;
}
