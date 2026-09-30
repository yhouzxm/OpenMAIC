import { resolve, relative, sep, isAbsolute, dirname } from 'node:path';
import ts from 'typescript';

export type ModuleSources = ReadonlyMap<string, string>;

const privilegedNames = [
  'rehydrateUserForPersistence',
  'rehydrateTenantForPersistence',
  'rehydrateMembershipForPersistence',
  'rehydrateRoleGrantForPersistence',
  'rehydrateSystemAdminGrantForPersistence',
] as const;
const domainDirectory = 'lib/zhiban/domain/identity';
const privilegedFiles = [
  'user.ts',
  'tenant.ts',
  'membership.ts',
  'role-grant.ts',
  'system-admin-grant.ts',
  'persistence-rehydration.ts',
].map((name) => resolve(domainDirectory, name));
const validationFile = resolve(domainDirectory, 'persistence-validation.ts');
const aggregatorFile = resolve(domainDirectory, 'persistence-rehydration.ts');
const allowedTests = new Set([
  'tests/zhiban/identity/domain/rehydration.test.ts',
  'tests/zhiban/identity/domain/runtime-hardening.test.ts',
]);

function canonical(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function configuration(): ts.ParsedCommandLine {
  const configPath = resolve('tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('.'), undefined, configPath);
  if (parsed.errors.length > 0)
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  return parsed;
}

/** Source membership follows the same includes/excludes as the root project. */
export function projectSourceFileIdentities(): ReadonlySet<string> {
  return new Set(configuration().fileNames.map(canonical));
}

function environment(sources: ModuleSources) {
  const options: ts.CompilerOptions = { ...configuration().options, noLib: true, types: [], incremental: false };
  const overlays = new Map([...sources].map(([file, source]) => [canonical(file), source]));
  const host = ts.createCompilerHost(options);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => overlays.get(canonical(file)) ?? originalReadFile(file);
  host.fileExists = (file) => overlays.has(canonical(file)) || originalFileExists(file);
  host.getSourceFile = (file, languageVersion, onError, _shouldCreateNewSourceFile) => {
    const source = overlays.get(canonical(file));
    return source === undefined
      ? originalGetSourceFile(file, languageVersion, onError, _shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, languageVersion, true);
  };
  const resolutionCache = ts.createModuleResolutionCache(resolve('.'), canonical, options);
  const resolved = (file: string, specifier: string): string | undefined => {
    const result = ts.resolveModuleName(specifier, resolve(file), options, host, resolutionCache).resolvedModule;
    return result ? canonical(result.resolvedFileName) : undefined;
  };
  // Locality classifies incomplete analysis only. Capability identity still comes
  // exclusively from the TypeScript resolver and checker.
  const pathsBase = typeof options.pathsBasePath === 'string'
    ? options.pathsBasePath
    : options.baseUrl ?? resolve('.');
  const localAliases = Object.entries(options.paths ?? {}).filter(([, targets]) =>
    targets.some((target) => {
      const path = relative(resolve('.'), resolve(pathsBase, target));
      return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    }),
  ).map(([pattern]) => pattern);
  function projectLocal(specifier: string): boolean {
    const normalized = specifier.replaceAll('\\', '/');
    if (normalized.startsWith('./') || normalized.startsWith('../')) return true;
    return localAliases.some((pattern) => {
      const star = pattern.indexOf('*');
      return star < 0 ? specifier === pattern :
        specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
    });
  }
  // Next permits side-effect stylesheet imports, which are resources rather than
  // TS callable modules. Verify the actual resource instead of silently accepting
  // an unresolved import. This exception never applies to value-bearing imports.
  function existingStylesheet(file: string, statement: ts.ImportDeclaration): boolean {
    if (statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.endsWith('.css')) return false;
    if (specifier.startsWith('./') || specifier.startsWith('../'))
      return host.fileExists(resolve(dirname(resolve(file)), specifier));
    return Object.entries(options.paths ?? {}).some(([pattern, targets]) => {
      const star = pattern.indexOf('*');
      if (star < 0) return specifier === pattern && targets.some((target) => host.fileExists(resolve(pathsBase, target)));
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return false;
      const matched = specifier.slice(prefix.length, specifier.length - suffix.length);
      return targets.some((target) => host.fileExists(resolve(pathsBase, target.replace('*', matched))));
    });
  }
  const resolutionFailures: string[] = [];
  for (const [file, source] of sources) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && projectLocal(specifier.text) &&
          !resolved(file, specifier.text) &&
          !(ts.isImportDeclaration(statement) && existingStylesheet(file, statement)))
        resolutionFailures.push(`${file}: UNRESOLVED_PROJECT_LOCAL_MODULE ${specifier.text}`);
    }
  }
  // A leaked export is itself a violation. For the repository-wide scan it is therefore
  // sufficient to type-check every direct consumer of a privileged root; fixture graphs
  // remain whole so their multi-hop behavior is exercised independently.
  const checkedSources =
    sources.size <= 100
      ? sources
      : new Map(
          [...sources].filter(([file, source]) => {
            const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            return ast.statements.some((statement) => {
              if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
                return false;
              const specifier = statement.moduleSpecifier;
              if (!specifier || !ts.isStringLiteral(specifier)) return false;
              const target = resolved(file, specifier.text);
              return (
                privilegedFiles.some((root) => canonical(root) === target) ||
                target === canonical(validationFile)
              );
            });
          }),
        );
  const roots = [...new Set([...checkedSources.keys(), ...privilegedFiles].map((file) => resolve(file)))];
  const program = ts.createProgram(roots, options, host);
  const checker = program.getTypeChecker();
  return { program, checker, resolved, checkedSources, resolutionFailures };
}

/** Actual TypeScript resolution, including project aliases and normalized path segments. */
export function resolvedModuleIdentity(file: string, specifier: string): string | undefined {
  return environment(new Map()).resolved(file, specifier);
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression)
      ? node.expression.text
    : undefined;
}

/** Detect statically forwarded reconstruction callables without tainting normal Infrastructure exports. */
export function privilegedCapabilityViolations(sources: ModuleSources): string[] {
  const { program, checker, resolved, checkedSources, resolutionFailures } = environment(sources);
  const rootFiles = new Set(privilegedFiles.map(canonical));
  const rootSymbols = new Set<ts.Symbol>();
  const tainted = new Set<ts.Symbol>();
  const objectProperties = new Map<ts.Symbol, Set<string>>();
  const sourceFiles = [...checkedSources.keys()]
    .map((file) => program.getSourceFile(resolve(file)))
    .filter((file): file is ts.SourceFile => file !== undefined);

  function alias(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }
  function symbol(node: ts.Node): ts.Symbol | undefined {
    const found = checker.getSymbolAtLocation(node);
    return found && alias(found);
  }
  for (const file of privilegedFiles) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const item of checker.getExportsOfModule(moduleSymbol)) {
      if (privilegedNames.includes(item.name as (typeof privilegedNames)[number])) {
        rootSymbols.add(alias(item));
      }
    }
  }
  function has(node: ts.Node): boolean {
    const found = symbol(node);
    return found !== undefined && (rootSymbols.has(found) || tainted.has(found));
  }
  function shorthandTainted(node: ts.ShorthandPropertyAssignment): boolean {
    const value = checker.getShorthandAssignmentValueSymbol(node);
    return !!value && (rootSymbols.has(alias(value)) || tainted.has(alias(value)));
  }
  function propertiesOf(expression: ts.Expression): Set<string> {
    if (ts.isParenthesizedExpression(expression)) return propertiesOf(expression.expression);
    if (ts.isIdentifier(expression)) {
      const result = new Set(objectProperties.get(symbol(expression)!) ?? []);
      for (const property of checker.getTypeAtLocation(expression).getProperties()) {
        const target = alias(property);
        if (target.declarations?.some((declaration) =>
          (ts.isPropertyDeclaration(declaration) || ts.isMethodDeclaration(declaration) ||
           ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) &&
          !publicMember(declaration))) continue;
        if (rootSymbols.has(target) || tainted.has(target)) result.add(property.name);
      }
      return result;
    }
    const result = new Set<string>();
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property.name);
          if (name && expressionTainted(property.initializer)) result.add(name);
        } else if (ts.isShorthandPropertyAssignment(property) && shorthandTainted(property)) {
          result.add(property.name.text);
        } else if ((ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) &&
                   property.body && bodyTainted(property.body)) {
          const name = propertyName(property.name);
          if (name) result.add(name);
        } else if (ts.isSpreadAssignment(property)) {
          for (const name of propertiesOf(property.expression)) result.add(name);
        }
      }
    }
    return result;
  }
  function expressionTainted(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) return has(expression) || propertiesOf(expression).size > 0;
    if (ts.isPropertyAccessExpression(expression)) {
      return has(expression.name) || propertiesOf(expression.expression).has(expression.name.text);
    }
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
      return propertiesOf(expression.expression).has(expression.argumentExpression.text);
    }
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
      return expressionTainted(expression.expression);
    if (ts.isAwaitExpression(expression)) return expressionTainted(expression.expression);
    if (ts.isNewExpression(expression)) return expressionTainted(expression.expression);
    if (ts.isCallExpression(expression)) {
      if (expressionTainted(expression.expression)) return true;
      if (
        ts.isPropertyAccessExpression(expression.expression) &&
        ['bind', 'call', 'apply'].includes(expression.expression.name.text) &&
        expressionTainted(expression.expression.expression)
      )
        return true;
      return expression.arguments.some((argument) => expressionTainted(argument));
    }
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return bodyTainted(expression.body);
    if (ts.isClassExpression(expression)) return classSurfaceTainted(expression);
    if (ts.isObjectLiteralExpression(expression)) return propertiesOf(expression).size > 0;
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.some((item) => ts.isExpression(item) && expressionTainted(item));
    return false;
  }
  function publicMember(member: ts.ClassElement): boolean {
    if (member.name && ts.isPrivateIdentifier(member.name)) return false;
    const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
    return !modifiers?.some((modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
  }
  function classSurfaceTainted(declaration: ts.ClassLikeDeclaration): boolean {
    if (declaration.heritageClauses?.some((clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword &&
      clause.types.some((base) => expressionTainted(base.expression)))) return true;
    return declaration.members.some((member) => {
      if (!publicMember(member)) return false;
      if (ts.isPropertyDeclaration(member))
        return has(member.name) || (!!member.initializer && expressionTainted(member.initializer));
      if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.body)
        return bodyTainted(member.body);
      if (ts.isConstructorDeclaration(member))
        return member.parameters.some((parameter) =>
          ts.isParameterPropertyDeclaration(parameter, member) &&
          !ts.getModifiers(parameter)?.some((modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword) &&
          !!parameter.initializer && expressionTainted(parameter.initializer));
      return false;
    });
  }
  function bodyTainted(body: ts.ConciseBody): boolean {
    if (!ts.isBlock(body)) return expressionTainted(body);
    let leaked = false;
    const visit = (node: ts.Node): void => {
      if (leaked || (node !== body && ts.isFunctionLike(node))) return;
      if (ts.isCallExpression(node) && expressionTainted(node.expression)) leaked = true;
      if (ts.isReturnStatement(node) && node.expression && expressionTainted(node.expression)) leaked = true;
      ts.forEachChild(node, visit);
    };
    visit(body);
    return leaked;
  }
  function mark(node: ts.Node): boolean {
    const found = symbol(node);
    if (!found || rootSymbols.has(found) || tainted.has(found)) return false;
    tainted.add(found);
    return true;
  }
  function recordProperties(node: ts.Node, names: Set<string>): boolean {
    const found = symbol(node);
    if (!found) return false;
    const existing = objectProperties.get(found) ?? new Set<string>();
    const before = existing.size;
    for (const name of names) existing.add(name);
    objectProperties.set(found, existing);
    return existing.size !== before;
  }
  function processBinding(name: ts.BindingName, value: ts.Expression): boolean {
    let changed = false;
    if (ts.isIdentifier(name)) {
      if (expressionTainted(value)) changed = mark(name) || changed;
      changed = recordProperties(name, propertiesOf(value)) || changed;
    } else if (ts.isObjectBindingPattern(name)) {
      const names = propertiesOf(value);
      for (const element of name.elements) {
        const key = element.propertyName ? propertyName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : undefined;
        if (key && names.has(key) && ts.isIdentifier(element.name)) changed = mark(element.name) || changed;
      }
    } else if (ts.isArrayBindingPattern(name) && expressionTainted(value)) {
      for (const element of name.elements)
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) changed = mark(element.name) || changed;
    }
    return changed;
  }

  // Symbol identities make aliases and lexical shadowing distinct. Repeat for local and module hops.
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of sourceFiles) {
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer)
          changed = processBinding(node.name, node.initializer) || changed;
        if (ts.isParameter(node) && node.initializer)
          changed = processBinding(node.name, node.initializer) || changed;
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && expressionTainted(node.right)) {
          if (ts.isIdentifier(node.left)) changed = mark(node.left) || changed;
          if (ts.isPropertyAccessExpression(node.left)) changed = mark(node.left.name) || changed;
        }
        if (ts.isFunctionDeclaration(node) && node.name && node.body && bodyTainted(node.body))
          changed = mark(node.name) || changed;
        if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name && node.body && bodyTainted(node.body))
          changed = mark(node.name) || changed;
        if (ts.isClassDeclaration(node) && node.name && classSurfaceTainted(node))
          changed = mark(node.name) || changed;
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }

  const violations = new Set<string>(resolutionFailures);
  function exportedSymbolTainted(item: ts.Symbol, visited = new Set<ts.Symbol>()): boolean {
    const target = alias(item);
    if (rootSymbols.has(target) || tainted.has(target)) return true;
    if (visited.has(target)) return false;
    visited.add(target);
    if (target.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule))
      return checker.getExportsOfModule(target).some((member) => exportedSymbolTainted(member, visited));
    // Anonymous default declarations have no local identifier to mark. Inspect
    // their declaration surface using the same expression/body/member analysis.
    return target.declarations?.some((declaration) => {
      if (ts.isClassDeclaration(declaration)) return classSurfaceTainted(declaration);
      if (ts.isFunctionDeclaration(declaration) && declaration.body) return bodyTainted(declaration.body);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        return expressionTainted(declaration.initializer);
      if (ts.isExportAssignment(declaration)) return expressionTainted(declaration.expression);
      return false;
    }) ?? false;
  }
  function exportsCapability(file: ts.SourceFile): boolean {
    const moduleSymbol = checker.getSymbolAtLocation(file);
    return !!moduleSymbol && checker.getExportsOfModule(moduleSymbol).some((item) => exportedSymbolTainted(item));
  }
  for (const file of sourceFiles) {
    const name = relative(resolve('.'), file.fileName).replaceAll(sep, '/');
    const identity = canonical(file.fileName);
    const allowImport =
      name.startsWith('lib/zhiban/infrastructure/identity/') ||
      allowedTests.has(name) ||
      identity === canonical(aggregatorFile);
    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolved(file.fileName, statement.moduleSpecifier.text);
        if (target === canonical(validationFile) && !rootFiles.has(identity))
          violations.add(`${name}: forbidden internal persistence helper export`);
      }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const target = resolved(file.fileName, statement.moduleSpecifier.text);
        if (allowImport) continue;
        if (target === canonical(validationFile) && !rootFiles.has(identity)) {
          violations.add(`${name}: forbidden internal persistence helper import`);
          continue;
        }
        const bindings = clause.namedBindings;
        const named = bindings && ts.isNamedImports(bindings) && bindings.elements.some((item) => !item.isTypeOnly && has(item.name));
        const defaulted = clause.name && has(clause.name);
        const namespace = bindings && ts.isNamespaceImport(bindings) && target && rootFiles.has(target);
        const targetSourceFile = target && program.getSourceFile(target);
        const forwardedNamespace = bindings && ts.isNamespaceImport(bindings) && targetSourceFile && exportsCapability(targetSourceFile);
        if (named || defaulted || namespace || forwardedNamespace || (target === canonical(aggregatorFile) && !bindings))
          violations.add(`${name}: forbidden privileged capability import`);
      }
      if (ts.isExportAssignment(statement) && expressionTainted(statement.expression))
        violations.add(`${name}: forbidden privileged capability export`);
    }
    if (!rootFiles.has(identity) && exportsCapability(file))
      violations.add(`${name}: forbidden privileged capability export`);
  }
  return [...violations];
}
