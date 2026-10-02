import ts from 'typescript';
import { resolve } from 'node:path';

/** Narrow syntax contract, not a proof of a scalar validator's numerical algorithm.
 * Global terminals remain named, top-level, straight-line DB-row -> Loaded functions. Every
 * state field must be explicitly projected from its schema column, with no spread,
 * arbitrary state argument, callback, cast, mutable binding or higher-order output.
 * Domain rehydration still validates the projected state at runtime. Scalar helper
 * precision and row/accessor validation belong to the real mapper's unit review.
 * Unsupported shapes fail closed rather than obtaining a directory-wide waiver.
 */
export function terminalMapperContract(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  roots: ReadonlyMap<ts.Symbol, Readonly<Record<string, string>>>,
  privilegedRoots: ReadonlySet<ts.Symbol>,
): {
  calls: Set<ts.CallExpression>;
  symbols: Set<ts.Symbol>;
  internalSymbols: Set<ts.Symbol>;
  internalUses: Set<ts.Node>;
} {
  const calls = new Set<ts.CallExpression>();
  const symbols = new Set<ts.Symbol>();
  const symbol = (node: ts.Node): ts.Symbol | undefined => {
    const found = checker.getSymbolAtLocation(node);
    return found && (found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found);
  };
  const parserFiles = new Map([
    [
      'ids.ts',
      new Set(['userId', 'tenantId', 'membershipId', 'roleGrantId', 'systemAdminGrantId']),
    ],
    ['time.ts', new Set(['instant'])],
    ['repository-types.ts', new Set(['repositoryRevision'])],
  ]);
  const identity = (path: string): string => {
    const absolute = resolve(path).replaceAll('\\', '/');
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  function parser(node: ts.Node, revision = false): boolean {
    const target = symbol(node);
    if (!target) return false;
    return (
      target.declarations?.some((declaration) => {
        const path = declaration.getSourceFile().fileName.replaceAll('\\', '/');
        const directory = revision
          ? 'lib/zhiban/application/identity/ports'
          : 'lib/zhiban/domain/identity';
        const name = path.slice(path.lastIndexOf('/') + 1);
        return (
          identity(path) === identity(resolve(directory, name)) &&
          (revision
            ? target.name === 'repositoryRevision' && name === 'repository-types.ts'
            : name !== 'repository-types.ts' && parserFiles.get(name)?.has(target.name))
        );
      }) ?? false
    );
  }
  function localFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
    return symbol(node)?.declarations?.find(
      (declaration): declaration is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(declaration) &&
        declaration.getSourceFile() === file &&
        declaration.parent === file &&
        !!declaration.body &&
        !ts
          .getModifiers(declaration)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
  }
  function scalarHelper(node: ts.Node): boolean {
    const helper = localFunction(node);
    if (!helper?.body || helper.parameters.length !== 1) return false;
    let safe = true;
    let returns = 0;
    const visit = (child: ts.Node): void => {
      if (
        ts.isAsExpression(child) ||
        ts.isTypeAssertionExpression(child) ||
        ts.isFunctionExpression(child) ||
        ts.isArrowFunction(child) ||
        ts.isClassExpression(child)
      )
        safe = false;
      const found = symbol(child);
      if (found && roots.has(found)) safe = false;
      if (ts.isReturnStatement(child)) {
        returns++;
        if (
          !child.expression ||
          !ts.isCallExpression(child.expression) ||
          !parser(child.expression.expression)
        )
          safe = false;
      }
      ts.forEachChild(child, visit);
    };
    visit(helper.body);
    return safe && returns > 0;
  }
  type Bindings = Map<ts.Symbol, ts.Expression>;
  function dereference(
    expression: ts.Expression,
    bindings: Bindings,
    seen = new Set<ts.Symbol>(),
  ): ts.Expression {
    if (!ts.isIdentifier(expression)) return expression;
    const found = symbol(expression);
    const value = found && bindings.get(found);
    if (!found || !value || seen.has(found)) return expression;
    seen.add(found);
    return dereference(value, bindings, seen);
  }
  function column(
    expression: ts.Expression,
    row: ts.Symbol,
    expected: string,
    bindings: Bindings,
  ): boolean {
    const value = dereference(expression, bindings);
    if (ts.isPropertyAccessExpression(value))
      return (
        symbol(dereference(value.expression, bindings)) === row && value.name.text === expected
      );
    if (
      ts.isCallExpression(value) &&
      value.arguments.length === 1 &&
      (parser(value.expression) || scalarHelper(value.expression))
    )
      return column(value.arguments[0], row, expected, bindings);
    if (
      ts.isConditionalExpression(value) &&
      ts.isBinaryExpression(value.condition) &&
      value.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      column(value.condition.left, row, expected, bindings) &&
      value.condition.right.kind === ts.SyntaxKind.NullKeyword
    )
      return (
        value.whenTrue.kind === ts.SyntaxKind.NullKeyword &&
        column(value.whenFalse, row, expected, bindings)
      );
    return false;
  }
  function projection(
    expression: ts.Expression,
    row: ts.Symbol,
    fields: Readonly<Record<string, string>>,
    bindings: Bindings,
  ): boolean {
    let value = dereference(expression, bindings);
    let projectedBindings = bindings;
    if (ts.isCallExpression(value) && value.arguments.length === 1) {
      const helper = localFunction(value.expression);
      if (
        !helper?.body ||
        helper.parameters.length !== 1 ||
        !ts.isIdentifier(helper.parameters[0].name) ||
        helper.body.statements.length !== 1 ||
        !ts.isReturnStatement(helper.body.statements[0]) ||
        !helper.body.statements[0].expression
      )
        return false;
      const parameter = symbol(helper.parameters[0].name);
      if (!parameter) return false;
      projectedBindings = new Map(bindings).set(parameter, value.arguments[0]);
      value = helper.body.statements[0].expression;
    }
    if (
      !ts.isObjectLiteralExpression(value) ||
      value.properties.length !== Object.keys(fields).length
    )
      return false;
    const seen = new Set<string>();
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false;
      const name = property.name.text;
      if (
        seen.has(name) ||
        !Object.hasOwn(fields, name) ||
        !column(property.initializer, row, fields[name], projectedBindings)
      )
        return false;
      seen.add(name);
    }
    return true;
  }
  for (const declaration of file.statements) {
    if (
      !ts.isFunctionDeclaration(declaration) ||
      !declaration.name ||
      !declaration.body ||
      declaration.parameters.length !== 1 ||
      !ts.isIdentifier(declaration.parameters[0].name) ||
      declaration.parameters[0].initializer ||
      !ts
        .getModifiers(declaration)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
      ts
        .getModifiers(declaration)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      continue;
    const row = symbol(declaration.parameters[0].name);
    const exported = symbol(declaration.name);
    if (!row || !exported) continue;
    const bindings: Bindings = new Map();
    const statements = [...declaration.body.statements];
    const returned = statements.pop();
    let valid = !!returned && ts.isReturnStatement(returned) && !!returned.expression;
    for (const statement of statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const)
      ) {
        valid = false;
        break;
      }
      for (const binding of statement.declarationList.declarations) {
        if (!ts.isIdentifier(binding.name) || !binding.initializer) {
          valid = false;
          break;
        }
        const found = symbol(binding.name);
        if (found) bindings.set(found, binding.initializer);
      }
    }
    if (!valid || !returned || !ts.isReturnStatement(returned) || !returned.expression) continue;
    const result = dereference(returned.expression, bindings);
    if (!ts.isObjectLiteralExpression(result) || result.properties.length !== 2) continue;
    const values = new Map<string, ts.Expression>();
    for (const property of result.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))
        values.set(property.name.text, property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) {
        const found = checker.getShorthandAssignmentValueSymbol(property);
        const value = found && bindings.get(found);
        if (value) values.set(property.name.text, value);
      }
    }
    const value = values.get('value');
    const revision = values.get('revision');
    if (!value || !revision) continue;
    const call = dereference(value, bindings);
    const token = dereference(revision, bindings);
    if (
      !ts.isCallExpression(call) ||
      call.arguments.length !== 1 ||
      !ts.isIdentifier(call.expression)
    )
      continue;
    const target = symbol(call.expression);
    const fields = target && roots.get(target);
    if (
      !fields ||
      !projection(call.arguments[0], row, fields, bindings) ||
      !ts.isCallExpression(token) ||
      token.arguments.length !== 1 ||
      !parser(token.expression, true) ||
      !column(token.arguments[0], row, 'repository_revision', bindings)
    )
      continue;
    // The ONE root use must be this direct terminal call, never an alias, capture,
    // secondary side effect, method invocation or capability argument elsewhere.
    let uses = 0;
    let escaped = false;
    const visit = (node: ts.Node): void => {
      const found = symbol(node);
      if (found && roots.has(found) && ts.isIdentifier(node)) {
        uses++;
        if (node !== call.expression) escaped = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.body);
    if (uses !== 1 || escaped) continue;
    calls.add(call);
    symbols.add(exported);
  }
  const membership = membershipTerminalContract(file, checker, privilegedRoots);
  for (const call of membership.calls) calls.add(call);
  for (const item of membership.symbols) symbols.add(item);
  return {
    calls,
    symbols,
    internalSymbols: membership.internalSymbols,
    internalUses: membership.internalUses,
  };
}

/** Membership-only certificate: explicit DB columns, a closed child-history path,
 * and ONE Loaded<Membership> terminal. This is provenance/non-escape analysis,
 * not a proof of UUID/range/ordinal validator algorithms. Those remain runtime
 * mapper responsibilities. RoleGrant helpers NEVER become public terminals.
 */
function membershipTerminalContract(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  roots: ReadonlySet<ts.Symbol>,
) {
  const calls = new Set<ts.CallExpression>();
  const symbols = new Set<ts.Symbol>();
  const internalSymbols = new Set<ts.Symbol>();
  const internalUses = new Set<ts.Node>();
  const symbol = (node: ts.Node): ts.Symbol | undefined => {
    const found = checker.getSymbolAtLocation(node);
    return found && (found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found);
  };
  // Names select a particular API only AFTER the guard resolved its root symbol.
  const membershipRoot = [...roots].find(
    (item) => item.name === 'rehydrateMembershipForPersistence',
  );
  const childRoot = [...roots].find((item) => item.name === 'rehydrateRoleGrantForPersistence');
  if (!membershipRoot || !childRoot) return { calls, symbols, internalSymbols, internalUses };
  const parentColumns = {
    id: 'membership_id',
    userId: 'user_id',
    tenantId: 'tenant_id',
    status: 'status',
    authorizationVersion: 'authorization_version',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    disabledAt: 'disabled_at',
    disabledReason: 'disabled_reason',
  };
  const childColumns = {
    id: 'grant_id',
    roleCode: 'role_code',
    createdAt: 'created_at',
    validFrom: 'valid_from',
    validUntil: 'valid_until',
    revokedAt: 'revoked_at',
  };
  const canonical = (path: string): string => {
    const absolute = resolve(path).replaceAll('\\', '/');
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  const scalarParsers = new Map([
    [
      canonical('lib/zhiban/domain/identity/ids.ts'),
      new Set(['userId', 'tenantId', 'membershipId', 'roleGrantId']),
    ],
    [canonical('lib/zhiban/domain/identity/time.ts'), new Set(['instant'])],
    [canonical('lib/zhiban/domain/identity/role.ts'), new Set(['roleCode'])],
  ]);
  const bindings = new Map<ts.Symbol, ts.Expression>();
  function collect(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      const found = symbol(node.name);
      if (found) bindings.set(found, node.initializer);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  function dereference(value: ts.Expression, seen = new Set<ts.Symbol>()): ts.Expression {
    const found = ts.isIdentifier(value) && symbol(value);
    if (!found || seen.has(found) || !bindings.has(found)) return value;
    seen.add(found);
    return dereference(bindings.get(found)!, seen);
  }
  function localFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
    return symbol(node)?.declarations?.find(
      (item): item is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(item) &&
        item.getSourceFile() === file &&
        !!item.body &&
        !ts.getModifiers(item)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
  }
  function returns(body: ts.Node): ts.Expression[] {
    const result: ts.Expression[] = [];
    function visit(node: ts.Node): void {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) result.push(node.expression);
      ts.forEachChild(node, visit);
    }
    visit(body);
    return result;
  }
  function pure(helper: ts.FunctionDeclaration): boolean {
    let valid = true;
    function visit(node: ts.Node): void {
      if (roots.has(symbol(node)!)) valid = false;
      // Caller-supplied callbacks are not a row validation/projection boundary.
      if (
        ts.isCallExpression(node) &&
        helper.parameters.some((parameter) => symbol(parameter.name) === symbol(node.expression))
      )
        valid = false;
      ts.forEachChild(node, visit);
    }
    visit(helper.body!);
    return valid;
  }
  function intrinsic(node: ts.Expression, receiver: string, method: string): boolean {
    if (
      !ts.isPropertyAccessExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== receiver ||
      node.name.text !== method
    )
      return false;
    // A shadowed local/import named Object or Array is not the intrinsic API.
    const found = symbol(node.expression);
    return (
      !found ||
      (found.declarations?.every((item) => item.getSourceFile().isDeclarationFile) ?? false)
    );
  }
  function rowCapture(helper: ts.FunctionDeclaration): boolean {
    const input = symbol(helper.parameters[0]?.name);
    if (!input || !pure(helper)) return false;
    const output = returns(helper.body!);
    if (output.length !== 1) return false;
    if (symbol(output[0]) === input) return true;
    // Checked own-data-property capture (the realistic closure-review shape).
    const returned = dereference(output[0]);
    if (
      !ts.isCallExpression(returned) ||
      !intrinsic(returned.expression, 'Object', 'freeze') ||
      returned.arguments.length !== 1 ||
      !ts.isIdentifier(returned.arguments[0])
    )
      return false;
    const result = symbol(returned.arguments[0]);
    const initial = result && bindings.get(result);
    if (!initial || !ts.isObjectLiteralExpression(initial) || initial.properties.length !== 0)
      return false;
    let copied = false;
    function visit(node: ts.Node): void {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isElementAccessExpression(node.left) &&
        symbol(node.left.expression) === result &&
        ts.isPropertyAccessExpression(node.right) &&
        node.right.name.text === 'value'
      ) {
        const descriptor = dereference(node.right.expression);
        copied =
          copied ||
          (ts.isCallExpression(descriptor) &&
            intrinsic(descriptor.expression, 'Object', 'getOwnPropertyDescriptor') &&
            descriptor.arguments.length === 2 &&
            symbol(descriptor.arguments[0]) === input &&
            symbol(descriptor.arguments[1]) === symbol(node.left.argumentExpression));
      }
      ts.forEachChild(node, visit);
    }
    visit(helper.body!);
    return copied;
  }
  type Origin =
    | { kind: 'row'; source: 'parent' | 'child' }
    | { kind: 'column'; source: 'parent' | 'child'; name: string }
    | { kind: 'array'; item: Origin }
    | { kind: 'object'; fields: Map<string, Origin> }
    | { kind: 'grant' };
  type Context = Map<ts.Symbol, Origin>;
  const namedExport = checker.getSymbolAtLocation(file);
  const exported = new Set(
    namedExport
      ? checker
          .getExportsOfModule(namedExport)
          .map((item) =>
            item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item,
          )
      : [],
  );
  for (const terminal of file.statements) {
    if (
      !ts.isFunctionDeclaration(terminal) ||
      !terminal.name ||
      !terminal.body ||
      terminal.parameters.length !== 2 ||
      terminal.parameters.some(
        (parameter) =>
          !ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken,
      ) ||
      !ts
        .getModifiers(terminal)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
      ts.getModifiers(terminal)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      continue;
    const terminalBody = terminal.body;
    const context: Context = new Map();
    context.set(symbol(terminal.parameters[0].name)!, { kind: 'row', source: 'parent' });
    context.set(symbol(terminal.parameters[1].name)!, {
      kind: 'array',
      item: { kind: 'row', source: 'child' },
    });
    const candidateCalls = new Set<ts.CallExpression>();
    const candidateHelpers = new Set<ts.Symbol>();
    const candidateUses = new Set<ts.Node>();
    function object(value: ts.Expression): Map<string, ts.Expression> | undefined {
      const literal = dereference(value);
      if (!ts.isObjectLiteralExpression(literal)) return;
      const properties = new Map<string, ts.Expression>();
      for (const property of literal.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          !properties.has(property.name.text)
        )
          properties.set(property.name.text, property.initializer);
        else if (
          ts.isShorthandPropertyAssignment(property) &&
          !properties.has(property.name.text)
        ) {
          const found = checker.getShorthandAssignmentValueSymbol(property);
          const value = found && bindings.get(found);
          if (!value) return;
          properties.set(property.name.text, value);
        } else return;
      }
      return properties;
    }
    function column(
      value: ts.Expression,
      source: 'parent' | 'child',
      name: string,
      env: Context,
    ): boolean {
      const found = origin(value, env);
      return found?.kind === 'column' && found.source === source && found.name === name;
    }
    function fields(
      value: ts.Expression,
      source: 'parent' | 'child',
      expected: Record<string, string>,
      env: Context,
      extra: string,
    ): Map<string, ts.Expression> | undefined {
      const properties = object(value);
      if (
        !properties ||
        properties.size !== Object.keys(expected).length + 1 ||
        !properties.has(extra) ||
        !Object.entries(expected).every(
          ([name, db]) => properties.has(name) && column(properties.get(name)!, source, db, env),
        )
      )
        return;
      return properties;
    }
    function scoped(
      helper: ts.FunctionLikeDeclaration,
      args: readonly (Origin | undefined)[],
      env: Context,
    ): Context | undefined {
      if (
        helper.parameters.length > args.length ||
        helper.parameters.some(
          (parameter) =>
            !ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken,
        )
      )
        return;
      const result = new Map(env);
      helper.parameters.forEach((parameter, index) => {
        const found = symbol(parameter.name);
        if (found && args[index]) result.set(found, args[index]!);
      });
      return result;
    }
    const evaluating = new Set<ts.Node>();
    function childHelper(
      helper: ts.FunctionDeclaration,
      item: Origin,
      env: Context,
    ): Origin | undefined {
      if (
        !helper.name ||
        helper.parameters.length !== 1 ||
        !helper.body ||
        exported.has(symbol(helper.name)!) ||
        item.kind !== 'row' ||
        item.source !== 'child'
      )
        return;
      const childContext = scoped(helper, [item], env);
      const output = returns(helper.body);
      if (!childContext || output.length !== 1) return;
      const reconstructed = dereference(output[0]);
      if (
        !ts.isCallExpression(reconstructed) ||
        !ts.isIdentifier(reconstructed.expression) ||
        symbol(reconstructed.expression) !== childRoot ||
        reconstructed.arguments.length !== 1
      )
        return;
      const projected = fields(
        reconstructed.arguments[0],
        'child',
        childColumns,
        childContext,
        'scope',
      );
      if (!projected) return;
      const scope = dereference(projected.get('scope')!);
      const scopeSymbol = ts.isCallExpression(scope) && symbol(scope.expression);
      const scopeFile = resolve('lib/zhiban/domain/identity/scope.ts');
      if (
        !ts.isCallExpression(scope) ||
        scope.arguments.length !== 2 ||
        !scopeSymbol ||
        scopeSymbol.name !== 'parseScope' ||
        !scopeSymbol.declarations?.some(
          (item) => canonical(item.getSourceFile().fileName) === canonical(scopeFile),
        ) ||
        !column(scope.arguments[0], 'child', 'scope_kind', childContext) ||
        !column(scope.arguments[1], 'child', 'scope_id', childContext) ||
        !nonEscaping(helper.body, new Set([reconstructed]))
      )
        return;
      candidateCalls.add(reconstructed);
      candidateHelpers.add(symbol(helper.name)!);
      return { kind: 'grant' };
    }
    function childCall(call: ts.CallExpression, env: Context): Origin | undefined {
      const helper = localFunction(call.expression);
      const item = call.arguments.length === 1 && origin(call.arguments[0], env);
      if (!helper || !item) return;
      const result = childHelper(helper, item, env);
      if (result) {
        candidateCalls.add(call);
        candidateUses.add(call.expression);
      }
      return result;
    }
    function callback(value: ts.Expression, item: Origin, env: Context): Origin | undefined {
      if (ts.isIdentifier(value)) {
        const helper = localFunction(value);
        if (!helper?.name || helper.parameters.length !== 1 || exported.has(symbol(helper.name)!))
          return;
        const result = childHelper(helper, item, env);
        if (result) {
          candidateUses.add(value);
          return result;
        }
        const helperContext = scoped(helper, [item], env);
        const output = returns(helper.body!);
        return pure(helper) && helperContext && output.length === 1
          ? origin(output[0], helperContext)
          : undefined;
      }
      if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return;
      const childContext = scoped(value, [item], env);
      if (!childContext) return;
      const output = ts.isBlock(value.body) ? returns(value.body) : [value.body];
      return output.length === 1 ? origin(output[0], childContext) : undefined;
    }
    function pushedHistory(array: ts.ArrayLiteralExpression, env: Context): Origin | undefined {
      if (array.elements.length !== 0 || !ts.isVariableDeclaration(array.parent)) return;
      const collection = symbol(array.parent.name);
      let writes = 0;
      let valid = true;
      function visit(node: ts.Node, scope: Context): void {
        if (
          ts.isForOfStatement(node) &&
          ts.isVariableDeclarationList(node.initializer) &&
          node.initializer.declarations.length === 1
        ) {
          const rows = origin(node.expression, scope);
          const name = node.initializer.declarations[0].name;
          const found = ts.isIdentifier(name) && symbol(name);
          if (rows?.kind === 'array' && found) {
            visit(node.statement, new Map(scope).set(found, rows.item));
            return;
          }
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          symbol(node.expression.expression) === collection
        ) {
          if (
            node.expression.name.text !== 'push' ||
            node.arguments.length !== 1 ||
            origin(node.arguments[0], scope)?.kind !== 'grant'
          )
            valid = false;
          writes++;
        }
        ts.forEachChild(node, (child) => visit(child, scope));
      }
      visit(terminalBody, env);
      return valid && writes > 0 ? { kind: 'array', item: { kind: 'grant' } } : undefined;
    }
    function origin(expression: ts.Expression, env: Context): Origin | undefined {
      if (evaluating.has(expression)) return;
      evaluating.add(expression);
      try {
        if (ts.isParenthesizedExpression(expression)) return origin(expression.expression, env);
        const found = symbol(expression);
        if (ts.isIdentifier(expression) && found) {
          if (env.has(found)) return env.get(found);
          const value = bindings.get(found);
          if (value) return origin(value, env);
        }
        if (ts.isPropertyAccessExpression(expression)) {
          const base = origin(expression.expression, env);
          if (base?.kind === 'row')
            return { kind: 'column', source: base.source, name: expression.name.text };
          if (base?.kind === 'object') return base.fields.get(expression.name.text);
        }
        if (ts.isObjectLiteralExpression(expression)) {
          const properties = object(expression);
          if (!properties) return;
          const projected = new Map<string, Origin>();
          for (const [name, value] of properties) {
            const field = origin(value, env);
            if (field) projected.set(name, field);
          }
          return { kind: 'object', fields: projected };
        }
        if (ts.isArrayLiteralExpression(expression)) return pushedHistory(expression, env);
        if (ts.isCallExpression(expression)) {
          const child = childCall(expression, env);
          if (child) return child;
          const first = expression.arguments[0] && origin(expression.arguments[0], env);
          if (
            intrinsic(expression.expression, 'Array', 'from') ||
            intrinsic(expression.expression, 'Object', 'freeze')
          )
            return first;
          if (ts.isPropertyAccessExpression(expression.expression)) {
            const base = origin(expression.expression.expression, env);
            if (base?.kind === 'array') {
              if (['sort', 'toSorted', 'slice'].includes(expression.expression.name.text))
                return base;
              if (expression.expression.name.text === 'map' && expression.arguments.length === 1) {
                const mapped = callback(expression.arguments[0], base.item, env);
                if (mapped) return { kind: 'array', item: mapped };
              }
            }
          }
          const helper = localFunction(expression.expression);
          if (helper && pure(helper)) {
            if (first?.kind === 'row' && rowCapture(helper)) return first;
            if (first?.kind === 'column') return first;
            const helperContext = scoped(
              helper,
              expression.arguments.map((arg) => origin(arg, env)),
              env,
            );
            const output = returns(helper.body!);
            if (helperContext && output.length === 1) return origin(output[0], helperContext);
          }
          // Runtime scalar parsers are identified through their actual Domain file.
          const target = symbol(expression.expression);
          if (
            first?.kind === 'column' &&
            target?.declarations?.some((item) => {
              return scalarParsers.get(canonical(item.getSourceFile().fileName))?.has(target.name);
            })
          )
            return first;
        }
        if (
          ts.isConditionalExpression(expression) &&
          expression.whenTrue.kind === ts.SyntaxKind.NullKeyword
        )
          return origin(expression.whenFalse, env);
        return;
      } finally {
        evaluating.delete(expression);
      }
    }
    function nonEscaping(body: ts.Node, permitted: ReadonlySet<ts.CallExpression>): boolean {
      let valid = true;
      function visit(node: ts.Node): void {
        if (
          roots.has(symbol(node)!) &&
          ts.isIdentifier(node) &&
          !(
            ts.isCallExpression(node.parent) &&
            node.parent.expression === node &&
            permitted.has(node.parent)
          )
        )
          valid = false;
        ts.forEachChild(node, visit);
      }
      visit(body);
      return valid;
    }
    const output = returns(terminal.body);
    if (output.length !== 1) continue;
    const loaded = object(output[0]);
    if (!loaded || loaded.size !== 2 || !loaded.has('value') || !loaded.has('revision')) continue;
    const reconstructed = dereference(loaded.get('value')!);
    const revision = dereference(loaded.get('revision')!);
    if (
      !ts.isCallExpression(reconstructed) ||
      !ts.isIdentifier(reconstructed.expression) ||
      symbol(reconstructed.expression) !== membershipRoot ||
      reconstructed.arguments.length !== 1
    )
      continue;
    const projected = fields(
      reconstructed.arguments[0],
      'parent',
      parentColumns,
      context,
      'roleGrants',
    );
    if (!projected) continue;
    const history = origin(projected.get('roleGrants')!, context);
    if (history?.kind !== 'array' || history.item.kind !== 'grant') continue;
    const revisionSymbol = ts.isCallExpression(revision) && symbol(revision.expression);
    if (
      !ts.isCallExpression(revision) ||
      revision.arguments.length !== 1 ||
      !revisionSymbol ||
      revisionSymbol.name !== 'repositoryRevision' ||
      !revisionSymbol.declarations?.some(
        (item) =>
          canonical(item.getSourceFile().fileName) ===
          canonical('lib/zhiban/application/identity/ports/repository-types.ts'),
      ) ||
      !column(revision.arguments[0], 'parent', 'repository_revision', context)
    )
      continue;
    candidateCalls.add(reconstructed);
    if (!nonEscaping(terminal.body, candidateCalls)) continue;
    for (const call of candidateCalls) calls.add(call);
    for (const helper of candidateHelpers) internalSymbols.add(helper);
    for (const use of candidateUses) internalUses.add(use);
    symbols.add(symbol(terminal.name)!);
  }
  return { calls, symbols, internalSymbols, internalUses };
}
