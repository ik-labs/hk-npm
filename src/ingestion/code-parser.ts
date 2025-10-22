import * as ts from "typescript";

export interface ParsedSymbol {
  kind: "function" | "class" | "interface" | "type" | "const" | "variable";
  name: string;
  signature: string;
  implementation: string;
  jsdoc?: string;
  startLine: number;
  endLine: number;
  filePath: string;
  isExported: boolean;
  parameters?: string[];
  returnType?: string;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  totalSymbols: number;
  filePath: string;
}

/**
 * Extract JSDoc comment if present
 */
function extractJSDoc(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  const fullText = sourceFile.getFullText();
  const nodeStart = node.getFullStart();
  const textBefore = fullText.substring(
    Math.max(0, nodeStart - 500),
    nodeStart,
  );

  // Match JSDoc comment
  const jsdocMatch = textBefore.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (jsdocMatch) {
    return jsdocMatch[0].trim();
  }

  return undefined;
}

/**
 * Check if node is exported
 */
function isExported(node: ts.Node): boolean {
  const modifiers = (node as ts.Node & { modifiers?: ts.Modifier[] }).modifiers;
  if (!modifiers) return false;

  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
}

/**
 * Extract function parameters
 */
function extractParameters(
  node: ts.FunctionDeclaration | ts.MethodDeclaration,
): string[] {
  return node.parameters.map((param) => {
    const name = param.name.getText();
    const type = param.type ? param.type.getText() : "any";
    return `${name}: ${type}`;
  });
}

/**
 * Extract return type
 */
function extractReturnType(
  node: ts.FunctionDeclaration | ts.MethodDeclaration,
): string {
  if (node.type) {
    return node.type.getText();
  }
  return "any";
}

/**
 * Get line numbers for a node
 */
function getLineNumbers(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { start: number; end: number } {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    start: start.line + 1,
    end: end.line + 1,
  };
}

/**
 * Parse function declaration
 */
function parseFunction(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): ParsedSymbol | null {
  if (!node.name) return null;

  const name = node.name.getText();
  const implementation = node.getText();
  const lines = getLineNumbers(node, sourceFile);
  const jsdoc = extractJSDoc(node, sourceFile);
  const parameters = extractParameters(node);
  const returnType = extractReturnType(node);

  // Create signature
  const params = node.parameters.map((p) => p.getText()).join(", ");
  const signature = `function ${name}(${params})${node.type ? `: ${node.type.getText()}` : ""}`;

  return {
    kind: "function",
    name,
    signature,
    implementation,
    jsdoc,
    startLine: lines.start,
    endLine: lines.end,
    filePath,
    isExported: isExported(node),
    parameters,
    returnType,
  };
}

/**
 * Parse class declaration
 */
function parseClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): ParsedSymbol | null {
  if (!node.name) return null;

  const name = node.name.getText();
  const implementation = node.getText();
  const lines = getLineNumbers(node, sourceFile);
  const jsdoc = extractJSDoc(node, sourceFile);

  // Extract class signature (without full implementation)
  const heritage = node.heritageClauses
    ?.map((clause) => clause.getText())
    .join(" ");
  const signature = `class ${name}${heritage ? ` ${heritage}` : ""}`;

  return {
    kind: "class",
    name,
    signature,
    implementation,
    jsdoc,
    startLine: lines.start,
    endLine: lines.end,
    filePath,
    isExported: isExported(node),
  };
}

/**
 * Parse interface declaration
 */
function parseInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): ParsedSymbol | null {
  const name = node.name.getText();
  const implementation = node.getText();
  const lines = getLineNumbers(node, sourceFile);
  const jsdoc = extractJSDoc(node, sourceFile);

  const signature = `interface ${name}`;

  return {
    kind: "interface",
    name,
    signature,
    implementation,
    jsdoc,
    startLine: lines.start,
    endLine: lines.end,
    filePath,
    isExported: isExported(node),
  };
}

/**
 * Parse type alias
 */
function parseTypeAlias(
  node: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): ParsedSymbol | null {
  const name = node.name.getText();
  const implementation = node.getText();
  const lines = getLineNumbers(node, sourceFile);
  const jsdoc = extractJSDoc(node, sourceFile);

  const signature = `type ${name}`;

  return {
    kind: "type",
    name,
    signature,
    implementation,
    jsdoc,
    startLine: lines.start,
    endLine: lines.end,
    filePath,
    isExported: isExported(node),
  };
}

/**
 * Parse variable/const declaration
 */
function parseVariable(
  node: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  filePath: string,
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  for (const declaration of node.declarationList.declarations) {
    const name = declaration.name.getText();
    const implementation = node.getText();
    const lines = getLineNumbers(node, sourceFile);
    const jsdoc = extractJSDoc(node, sourceFile);

    const kind =
      node.declarationList.flags & ts.NodeFlags.Const ? "const" : "variable";
    const signature = `${kind} ${name}${declaration.type ? `: ${declaration.type.getText()}` : ""}`;

    symbols.push({
      kind,
      name,
      signature,
      implementation,
      jsdoc,
      startLine: lines.start,
      endLine: lines.end,
      filePath,
      isExported: isExported(node),
    });
  }

  return symbols;
}

/**
 * Visit AST nodes and extract symbols
 */
function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  symbols: ParsedSymbol[],
): void {
  // Index ALL symbols (exported and internal) for complete coverage
  // We'll track export status and filter by quality, not by export status

  if (ts.isFunctionDeclaration(node)) {
    const symbol = parseFunction(node, sourceFile, filePath);
    if (symbol) symbols.push(symbol);
  } else if (ts.isClassDeclaration(node)) {
    const symbol = parseClass(node, sourceFile, filePath);
    if (symbol) symbols.push(symbol);
  } else if (ts.isInterfaceDeclaration(node)) {
    const symbol = parseInterface(node, sourceFile, filePath);
    if (symbol) symbols.push(symbol);
  } else if (ts.isTypeAliasDeclaration(node)) {
    const symbol = parseTypeAlias(node, sourceFile, filePath);
    if (symbol) symbols.push(symbol);
  } else if (ts.isVariableStatement(node)) {
    const variableSymbols = parseVariable(node, sourceFile, filePath);
    symbols.push(...variableSymbols);
  }

  // Continue traversing
  ts.forEachChild(node, (child) => visit(child, sourceFile, filePath, symbols));
}

/**
 * Parse a TypeScript or JavaScript file
 */
export function parseSourceFile(
  filePath: string,
  content: string,
): ParseResult {
  // Create source file
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
  );

  const symbols: ParsedSymbol[] = [];

  // Visit all nodes
  visit(sourceFile, sourceFile, filePath, symbols);

  return {
    symbols,
    totalSymbols: symbols.length,
    filePath,
  };
}

/**
 * Parse multiple source files
 */
export function parseSourceFiles(
  files: Array<{ path: string; content: string }>,
): ParsedSymbol[] {
  const allSymbols: ParsedSymbol[] = [];

  for (const file of files) {
    try {
      const result = parseSourceFile(file.path, file.content);
      allSymbols.push(...result.symbols);
    } catch (error: any) {
      console.log(`     ⚠️  Failed to parse ${file.path}: ${error.message}`);
    }
  }

  return allSymbols;
}

/**
 * Filter symbols by quality (not by export status)
 * Index ALL functions/classes but filter out noise
 */
export function filterRelevantSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
  return symbols.filter((symbol) => {
    // Skip trivial implementations (getters, setters, simple constants)
    if (symbol.implementation.length < 50) return false;

    // Skip extremely large implementations (might be generated code or test data)
    if (symbol.implementation.length > 10000) return false;

    // Skip test files (should already be filtered at fetch level, but double-check)
    if (
      symbol.filePath.includes(".test.") ||
      symbol.filePath.includes(".spec.") ||
      symbol.filePath.includes("__tests__")
    ) {
      return false;
    }

    // Skip mock/fixture files
    if (
      symbol.filePath.includes("mock") ||
      symbol.filePath.includes("fixture") ||
      symbol.filePath.includes("__mocks__")
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Calculate relevance score for a symbol
 * Higher score = more important for search results
 */
export function calculateRelevanceScore(symbol: ParsedSymbol): number {
  let score = 0;

  // Exported symbols are most relevant
  if (symbol.isExported) score += 10;

  // Has JSDoc documentation
  if (symbol.jsdoc && symbol.jsdoc.length > 20) score += 5;

  // Public name (not prefixed with _ or __)
  if (!symbol.name.startsWith("_")) score += 3;

  // Reasonable size (not too small, not too large)
  if (
    symbol.implementation.length > 100 &&
    symbol.implementation.length < 2000
  ) {
    score += 2;
  }

  // Contains important async patterns
  if (
    symbol.implementation.includes("async") ||
    symbol.implementation.includes("await")
  ) {
    score += 2;
  }

  // Contains error handling
  if (
    symbol.implementation.includes("try") ||
    symbol.implementation.includes("catch") ||
    symbol.implementation.includes("throw")
  ) {
    score += 1;
  }

  // Contains important operations
  const importantKeywords = [
    "fetch",
    "request",
    "http",
    "api",
    "execute",
    "call",
  ];
  if (
    importantKeywords.some((keyword) =>
      symbol.implementation.toLowerCase().includes(keyword),
    )
  ) {
    score += 2;
  }

  return score;
}

/**
 * Create searchable text from symbol (for embedding)
 */
export function createSymbolSearchText(symbol: ParsedSymbol): string {
  const parts: string[] = [];

  // Add JSDoc if available
  if (symbol.jsdoc) {
    parts.push(symbol.jsdoc);
  }

  // Add signature
  parts.push(symbol.signature);

  // Add implementation
  parts.push(symbol.implementation);

  // Add metadata
  parts.push(`File: ${symbol.filePath}`);
  parts.push(`Type: ${symbol.kind}`);

  if (symbol.parameters && symbol.parameters.length > 0) {
    parts.push(`Parameters: ${symbol.parameters.join(", ")}`);
  }

  if (symbol.returnType) {
    parts.push(`Returns: ${symbol.returnType}`);
  }

  return parts.join("\n\n");
}
