export interface AdapterConfig {
  projectRoot: string;
  serverPackage: string;
  enableHooks: boolean;
}

export interface SetupResult {
  ide: string;
  filesCreated: string[];
  nextSteps: string[];
}

export interface BaseAdapter {
  readonly ideName: string;
  readonly detectionPaths: string[];
  detect(cwd: string): Promise<boolean>;
  setup(config: AdapterConfig): Promise<SetupResult>;
}
