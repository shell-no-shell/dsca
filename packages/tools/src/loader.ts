import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { ITool, ToolRegistry, SkillManifest, ToolContext, ToolResult } from './registry.js';

export interface LoadResult {
  loaded: string[];
  errors: Array<{ source: string; error: string }>;
}

export interface InstalledSkill {
  name: string;
  version: string;
  source: 'local' | 'npm';
  path: string;
  toolCount: number;
  installedAt: string;
}

/**
 * ToolLoader handles discovering, loading, installing, and uninstalling
 * tools from local directories and npm packages.
 *
 * Directory layout:
 *   ~/.dsca/
 *     tools/              ← local custom tools (JS files or skill dirs)
 *       my-tool.js        ← single-file tool
 *       docker/            ← skill directory
 *         dsca-tool.json   ← skill manifest
 *         tools/
 *           build.js
 *     skills/             ← npm-installed skills
 *       @dsca/tool-docker/
 *         dsca-tool.json
 *         ...
 *     skills.json         ← installed skills registry
 */
export class ToolLoader {
  private dscaHome: string;
  private localToolsDir: string;
  private skillsDir: string;
  private skillsRegistryPath: string;

  constructor() {
    this.dscaHome = path.join(os.homedir(), '.dsca');
    this.localToolsDir = path.join(this.dscaHome, 'tools');
    this.skillsDir = path.join(this.dscaHome, 'skills');
    this.skillsRegistryPath = path.join(this.dscaHome, 'skills.json');

    // Ensure directories exist
    for (const dir of [this.localToolsDir, this.skillsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Load all tools (local + npm-installed) into a registry.
   */
  async loadAll(registry: ToolRegistry): Promise<LoadResult> {
    const result: LoadResult = { loaded: [], errors: [] };

    // 1. Load local tools from ~/.dsca/tools/
    const localResult = await this.loadLocalTools(registry);
    result.loaded.push(...localResult.loaded);
    result.errors.push(...localResult.errors);

    // 2. Load npm-installed skills from ~/.dsca/skills/
    const npmResult = await this.loadInstalledSkills(registry);
    result.loaded.push(...npmResult.loaded);
    result.errors.push(...npmResult.errors);

    return result;
  }

  /**
   * Load tools from ~/.dsca/tools/ directory.
   * Supports:
   *   - Single .js files that export an ITool or ITool[]
   *   - Directories with dsca-tool.json manifest
   */
  private async loadLocalTools(registry: ToolRegistry): Promise<LoadResult> {
    const result: LoadResult = { loaded: [], errors: [] };

    if (!fs.existsSync(this.localToolsDir)) return result;

    const entries = fs.readdirSync(this.localToolsDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(this.localToolsDir, entry.name);
      try {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          // Single-file tool
          const tools = await this.loadToolFile(fullPath);
          const namespace = path.basename(entry.name, '.js');
          for (const tool of tools) {
            tool.source = 'local';
            registry.registerNamespaced(namespace, tool);
            result.loaded.push(`${namespace}.${tool.name}`);
          }
        } else if (entry.isDirectory()) {
          // Skill directory with manifest
          const manifestPath = path.join(fullPath, 'dsca-tool.json');
          if (fs.existsSync(manifestPath)) {
            const loaded = await this.loadSkillFromManifest(manifestPath, registry, 'local');
            result.loaded.push(...loaded);
          }
        }
      } catch (e: any) {
        result.errors.push({ source: fullPath, error: e.message });
      }
    }

    return result;
  }

  /**
   * Load npm-installed skills from ~/.dsca/skills/.
   */
  private async loadInstalledSkills(registry: ToolRegistry): Promise<LoadResult> {
    const result: LoadResult = { loaded: [], errors: [] };

    if (!fs.existsSync(this.skillsDir)) return result;

    // Walk through skills directory looking for dsca-tool.json
    const walkSkills = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const manifestPath = path.join(fullPath, 'dsca-tool.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const loaded = this.loadSkillFromManifestSync(manifestPath, registry, 'npm');
              result.loaded.push(...loaded);
            } catch (e: any) {
              result.errors.push({ source: fullPath, error: e.message });
            }
          } else if (entry.name.startsWith('@')) {
            // Scoped package: @dsca/tool-xxx → look one level deeper
            walkSkills(fullPath);
          }
        }
      }
    };

    walkSkills(this.skillsDir);
    return result;
  }

  /**
   * Load a single .js file that exports ITool or ITool[].
   *
   * Supported export formats:
   *   module.exports = { name, description, parameters, dangerLevel, execute }
   *   module.exports = [tool1, tool2]
   *   module.exports = { tools: [tool1, tool2] }
   *   module.exports.default = tool
   */
  private async loadToolFile(filePath: string): Promise<ITool[]> {
    const absPath = path.resolve(filePath);
    // Use dynamic import with file:// URL for ESM compatibility
    const fileUrl = `file://${absPath}`;
    let mod: any;
    try {
      mod = await import(fileUrl);
    } catch {
      // Fallback: try require for CJS
      mod = require(absPath);
    }

    // Unwrap default export
    const exported = mod.default || mod;

    if (Array.isArray(exported)) {
      return exported.filter(this.isValidTool);
    }

    if (exported.tools && Array.isArray(exported.tools)) {
      return exported.tools.filter(this.isValidTool);
    }

    if (this.isValidTool(exported)) {
      return [exported];
    }

    throw new Error(`File does not export a valid ITool: ${filePath}`);
  }

  /**
   * Load tools from a dsca-tool.json manifest file.
   */
  private async loadSkillFromManifest(manifestPath: string, registry: ToolRegistry, source: 'local' | 'npm'): Promise<string[]> {
    return this.loadSkillFromManifestSync(manifestPath, registry, source);
  }

  private loadSkillFromManifestSync(manifestPath: string, registry: ToolRegistry, source: 'local' | 'npm'): string[] {
    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifestDir = path.dirname(manifestPath);
    const loaded: string[] = [];
    const namespace = manifest.name;

    for (const toolDef of manifest.tools) {
      const handlerPath = path.resolve(manifestDir, toolDef.handler);
      if (!fs.existsSync(handlerPath)) {
        throw new Error(`Handler not found: ${handlerPath} (defined in ${manifestPath})`);
      }

      // Load the handler module synchronously
      let handlerModule: any;
      try {
        handlerModule = require(handlerPath);
      } catch (e: any) {
        throw new Error(`Failed to load handler ${handlerPath}: ${e.message}`);
      }

      const exportName = toolDef.handlerExport || 'execute';
      const handlerFn = handlerModule[exportName] || handlerModule.default?.[exportName] || handlerModule.default;

      if (typeof handlerFn !== 'function') {
        throw new Error(`Handler ${handlerPath} does not export function '${exportName}'`);
      }

      const tool: ITool = {
        name: toolDef.name,
        description: toolDef.description,
        parameters: toolDef.parameters,
        dangerLevel: toolDef.dangerLevel,
        source,
        namespace,
        execute: async (args: any, ctx: ToolContext): Promise<ToolResult> => {
          return handlerFn(args, ctx);
        }
      };

      registry.registerNamespaced(namespace, tool);
      loaded.push(`${namespace}.${tool.name}`);
    }

    return loaded;
  }

  // ─── npm skill install/uninstall ───

  /**
   * Install a skill from npm.
   *
   * Usage:
   *   install('@dsca/tool-docker')          → installs from npm
   *   install('@dsca/tool-docker', '1.2.0') → specific version
   *   install('/path/to/local/skill')       → installs from local path
   */
  async install(packageName: string, version?: string): Promise<InstalledSkill> {
    const isLocalPath = packageName.startsWith('/') || packageName.startsWith('./') || packageName.startsWith('../');

    if (isLocalPath) {
      return this.installFromLocal(packageName);
    }

    const spec = version ? `${packageName}@${version}` : packageName;

    // Install into ~/.dsca/skills/ using npm
    execSync(`npm install ${spec} --prefix "${this.skillsDir}" --save`, {
      stdio: 'pipe',
      timeout: 120000,
    });

    // Find the installed manifest
    const pkgDir = this.resolveInstalledPackage(packageName);
    const manifestPath = path.join(pkgDir, 'dsca-tool.json');

    if (!fs.existsSync(manifestPath)) {
      // Cleanup: uninstall if no manifest found
      try { execSync(`npm uninstall ${packageName} --prefix "${this.skillsDir}"`, { stdio: 'pipe' }); } catch {}
      throw new Error(`Package '${packageName}' does not contain a dsca-tool.json manifest`);
    }

    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const skill: InstalledSkill = {
      name: manifest.name,
      version: manifest.version,
      source: 'npm',
      path: pkgDir,
      toolCount: manifest.tools.length,
      installedAt: new Date().toISOString(),
    };

    this.updateSkillsRegistry(skill);
    return skill;
  }

  /**
   * Install a skill from a local directory by copying.
   */
  private async installFromLocal(sourcePath: string): Promise<InstalledSkill> {
    const absPath = path.resolve(sourcePath);
    const manifestPath = path.join(absPath, 'dsca-tool.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No dsca-tool.json found at ${absPath}`);
    }

    const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const destDir = path.join(this.localToolsDir, manifest.name);

    // Copy directory
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    this.copyDirSync(absPath, destDir);

    const skill: InstalledSkill = {
      name: manifest.name,
      version: manifest.version,
      source: 'local',
      path: destDir,
      toolCount: manifest.tools.length,
      installedAt: new Date().toISOString(),
    };

    this.updateSkillsRegistry(skill);
    return skill;
  }

  /**
   * Uninstall a skill by name.
   */
  async uninstall(skillName: string, registry?: ToolRegistry): Promise<boolean> {
    const skills = this.readSkillsRegistry();
    const skill = skills.find(s => s.name === skillName);

    if (!skill) {
      // Try to find by package name in npm
      try {
        execSync(`npm uninstall ${skillName} --prefix "${this.skillsDir}"`, { stdio: 'pipe' });
      } catch {}
      return false;
    }

    if (skill.source === 'npm') {
      try {
        execSync(`npm uninstall ${skillName} --prefix "${this.skillsDir}"`, { stdio: 'pipe' });
      } catch { /* may already be removed */ }
    } else if (skill.source === 'local') {
      if (fs.existsSync(skill.path)) {
        fs.rmSync(skill.path, { recursive: true });
      }
    }

    // Remove from skills registry
    const updated = skills.filter(s => s.name !== skillName);
    fs.writeFileSync(this.skillsRegistryPath, JSON.stringify(updated, null, 2), 'utf-8');

    // Unregister from runtime registry if provided
    if (registry) {
      registry.unregisterNamespace(skillName);
    }

    return true;
  }

  /**
   * List all installed skills.
   */
  listInstalled(): InstalledSkill[] {
    return this.readSkillsRegistry();
  }

  /**
   * Scaffold a new skill project.
   */
  scaffoldSkill(name: string, targetDir: string): string {
    const dir = path.join(targetDir, name);
    if (fs.existsSync(dir)) {
      throw new Error(`Directory already exists: ${dir}`);
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'tools'));

    // Write manifest
    const manifest: SkillManifest = {
      name,
      version: '1.0.0',
      description: `DSCA skill: ${name}`,
      tools: [
        {
          name: 'example',
          description: `Example tool from ${name} skill`,
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input parameter' }
            },
            required: ['input']
          },
          dangerLevel: 'low',
          handler: './tools/example.js'
        }
      ]
    };
    fs.writeFileSync(path.join(dir, 'dsca-tool.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    // Write example handler
    const handler = `// Tool handler for ${name}
// Export an 'execute' function that receives (args, ctx) and returns a ToolResult

/**
 * @param {{ input: string }} args - Tool arguments
 * @param {{ workspacePath: string }} ctx - Execution context
 * @returns {Promise<{ success: boolean, output: string }>}
 */
async function execute(args, ctx) {
  return {
    success: true,
    output: \`Hello from ${name}! Input: \${args.input}, Workspace: \${ctx.workspacePath}\`
  };
}

module.exports = { execute };
`;
    fs.writeFileSync(path.join(dir, 'tools', 'example.js'), handler, 'utf-8');

    // Write README
    const readme = `# ${name}

A custom skill for DSCA (DeepSeek Code Agent).

## Install

\`\`\`bash
# From local directory
dsca tool install ./${name}

# Or copy to ~/.dsca/tools/
cp -r ./${name} ~/.dsca/tools/
\`\`\`

## Tools

| Tool | Description |
|------|-------------|
| ${name}.example | Example tool |

## Development

1. Edit \`dsca-tool.json\` to define tools
2. Implement handlers in \`tools/\` directory
3. Test with \`dsca tool install ./${name}\`
`;
    fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf-8');

    return dir;
  }

  // ─── Private helpers ───

  private isValidTool(obj: any): obj is ITool {
    return obj
      && typeof obj.name === 'string'
      && typeof obj.description === 'string'
      && typeof obj.execute === 'function'
      && obj.parameters?.type === 'object';
  }

  private resolveInstalledPackage(packageName: string): string {
    // npm installs into skills/node_modules/packageName
    const modulesDir = path.join(this.skillsDir, 'node_modules');
    const pkgDir = path.join(modulesDir, packageName);
    if (fs.existsSync(pkgDir)) return pkgDir;

    // Scoped package: @scope/name
    if (packageName.startsWith('@')) {
      const parts = packageName.split('/');
      const scopeDir = path.join(modulesDir, parts[0], parts[1]);
      if (fs.existsSync(scopeDir)) return scopeDir;
    }

    throw new Error(`Could not find installed package: ${packageName}`);
  }

  private readSkillsRegistry(): InstalledSkill[] {
    if (!fs.existsSync(this.skillsRegistryPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.skillsRegistryPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private updateSkillsRegistry(skill: InstalledSkill): void {
    const skills = this.readSkillsRegistry();
    const idx = skills.findIndex(s => s.name === skill.name);
    if (idx >= 0) {
      skills[idx] = skill;
    } else {
      skills.push(skill);
    }
    fs.writeFileSync(this.skillsRegistryPath, JSON.stringify(skills, null, 2), 'utf-8');
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
