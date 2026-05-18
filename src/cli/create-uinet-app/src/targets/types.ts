export interface AppMeta {
  projectName: string;
  displayVersion: string;
}

export interface BuildTarget {
  name: string;
  framework: string;
  extraPublishArgs?: string;
  findBundle(publishDir: string, projectName: string): string | null;
  package(appPath: string, outputDir: string, meta: AppMeta): Promise<string>;
}
