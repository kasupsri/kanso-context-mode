export interface ParsedSymbolMatch {
  kind: string;
  name: string;
  line: number;
  signature: string;
}

interface NodeLike {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  childCount: number;
  child(index: number): NodeLike | null;
  childForFieldName?(name: string): NodeLike | null;
}

interface TreeLike {
  rootNode: NodeLike;
}

interface ParserLike {
  setLanguage(language: unknown): void;
  parse(input: string): TreeLike;
}

let parserCtorPromise: Promise<(new () => ParserLike) | null> | undefined;
const languagePromises = new Map<string, Promise<unknown | null>>();

function normalizeSignature(text: string): string {
  return text.split('\n', 1)[0]?.trim().replace(/\s+/g, ' ').slice(0, 160) ?? '';
}

function fileExtension(path: string): string {
  const normalized = path.toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  return lastDot >= 0 ? normalized.slice(lastDot) : '';
}

async function loadParserCtor(): Promise<(new () => ParserLike) | null> {
  if (!parserCtorPromise) {
    parserCtorPromise = import('tree-sitter')
      .then(mod => (mod.default ?? mod) as new () => ParserLike)
      .catch(() => null);
  }
  return parserCtorPromise;
}

async function loadLanguage(path: string): Promise<unknown | null> {
  const ext = fileExtension(path);
  if (languagePromises.has(ext)) {
    return languagePromises.get(ext)!;
  }

  const promise = (async () => {
    switch (ext) {
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs': {
        const mod = await import('tree-sitter-javascript').catch(() => null);
        return (mod?.default ?? mod) as unknown;
      }
      case '.ts':
      case '.cts':
      case '.mts': {
        const mod = await import('tree-sitter-typescript').catch(() => null);
        return ((mod as { typescript?: unknown } | null)?.typescript ??
          mod?.default ??
          mod) as unknown;
      }
      case '.tsx': {
        const mod = await import('tree-sitter-typescript').catch(() => null);
        return ((mod as { tsx?: unknown } | null)?.tsx ?? mod?.default ?? mod) as unknown;
      }
      case '.py': {
        const mod = await import('tree-sitter-python').catch(() => null);
        return (mod?.default ?? mod) as unknown;
      }
      case '.go': {
        const mod = await import('tree-sitter-go').catch(() => null);
        return (mod?.default ?? mod) as unknown;
      }
      case '.rs': {
        const mod = await import('tree-sitter-rust').catch(() => null);
        return (mod?.default ?? mod) as unknown;
      }
      default:
        return null;
    }
  })();

  languagePromises.set(ext, promise);
  return promise;
}

function variableKind(valueType: string | undefined): ParsedSymbolMatch['kind'] | null {
  if (!valueType) return null;
  if (
    valueType === 'arrow_function' ||
    valueType === 'function' ||
    valueType === 'function_expression'
  ) {
    return 'const';
  }
  return null;
}

function pushSymbol(
  target: ParsedSymbolMatch[],
  node: NodeLike,
  kind: ParsedSymbolMatch['kind'],
  nameNode: NodeLike | null | undefined
): void {
  const name = nameNode?.text?.trim();
  if (!name) return;
  target.push({
    kind,
    name,
    line: node.startPosition.row + 1,
    signature: normalizeSignature(node.text),
  });
}

function walkNode(node: NodeLike, target: ParsedSymbolMatch[]): void {
  const nameNode = node.childForFieldName?.('name') ?? null;

  switch (node.type) {
    case 'function_declaration':
    case 'function_definition':
    case 'function_item':
      pushSymbol(target, node, 'function', nameNode);
      break;
    case 'method_definition':
    case 'method_signature':
    case 'method_declaration':
      pushSymbol(target, node, 'method', nameNode);
      break;
    case 'class_declaration':
    case 'class_definition':
      pushSymbol(target, node, 'class', nameNode);
      break;
    case 'interface_declaration':
      pushSymbol(target, node, 'interface', nameNode);
      break;
    case 'type_alias_declaration':
    case 'type_item':
      pushSymbol(target, node, 'type', nameNode);
      break;
    case 'enum_declaration':
    case 'enum_item':
      pushSymbol(target, node, 'enum', nameNode);
      break;
    case 'struct_item':
      pushSymbol(target, node, 'struct', nameNode);
      break;
    case 'trait_item':
      pushSymbol(target, node, 'trait', nameNode);
      break;
    case 'type_spec': {
      const typeNode =
        node.childForFieldName?.('type') ??
        Array.from({ length: node.childCount }, (_, index) => node.child(index)).find(Boolean) ??
        null;
      const kind =
        typeNode?.type === 'struct_type'
          ? 'struct'
          : typeNode?.type === 'interface_type'
            ? 'interface'
            : 'type';
      pushSymbol(target, node, kind, nameNode);
      break;
    }
    case 'variable_declarator': {
      const valueNode = node.childForFieldName?.('value') ?? null;
      const kind = variableKind(valueNode?.type);
      if (kind) {
        pushSymbol(target, node, kind, nameNode);
      }
      break;
    }
  }

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) walkNode(child, target);
  }
}

function dedupeSymbols(symbols: ParsedSymbolMatch[]): ParsedSymbolMatch[] {
  const seen = new Set<string>();
  const out: ParsedSymbolMatch[] = [];
  for (const symbol of symbols) {
    const key = `${symbol.kind}:${symbol.name}:${symbol.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(symbol);
  }
  return out;
}

export async function extractSymbolsWithTreeSitter(
  path: string,
  content: string
): Promise<ParsedSymbolMatch[] | null> {
  const ParserCtor = await loadParserCtor();
  if (!ParserCtor) return null;
  const language = await loadLanguage(path);
  if (!language) return null;

  try {
    const parser = new ParserCtor();
    parser.setLanguage(language);
    const tree = parser.parse(content);
    const symbols: ParsedSymbolMatch[] = [];
    walkNode(tree.rootNode, symbols);
    return dedupeSymbols(symbols);
  } catch {
    return null;
  }
}
