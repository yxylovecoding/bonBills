type TagPredicate = (tags: ReadonlySet<string>) => boolean;

type LogicToken =
  | { kind: 'tag'; value: string }
  | { kind: 'and' | 'or' | 'not' | 'leftParen' | 'rightParen' };

export interface CompiledTagLogic {
  test: TagPredicate | null;
  error: string | null;
  referencedTags: string[];
}

const TAG_ALIASES: Record<string, readonly string[]> = {
  生活: ['周期生活', '波动生活'],
};

function expandTagReference(tag: string): string[] {
  const aliases = TAG_ALIASES[tag];
  return aliases ? [tag, ...aliases] : [tag];
}

function tokenize(source: string): LogicToken[] {
  const tokens: LogicToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '[') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '\\') {
          index += 1;
          if (index >= source.length) throw new Error('标签末尾不能是转义符 \\');
          value += source[index];
          index += 1;
          continue;
        }
        if (current === ']') {
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new Error('标签缺少右方括号 ]');
      const tag = value.trim();
      if (!tag) throw new Error('标签名不能为空');
      tokens.push({ kind: 'tag', value: tag });
      continue;
    }
    if (char === '(' || char === '（') {
      tokens.push({ kind: 'leftParen' });
      index += 1;
      continue;
    }
    if (char === ')' || char === '）') {
      tokens.push({ kind: 'rightParen' });
      index += 1;
      continue;
    }
    if (char === '且' || char === '与') {
      tokens.push({ kind: 'and' });
      index += 1;
      continue;
    }
    if (char === '或') {
      tokens.push({ kind: 'or' });
      index += 1;
      continue;
    }
    if (char === '非') {
      tokens.push({ kind: 'not' });
      index += 1;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      const matched = source.slice(index).match(/^[A-Za-z]+/);
      const word = matched?.[0] ?? '';
      index += word.length;
      const operator = word.toUpperCase();
      if (operator === 'AND' || operator === 'OR' || operator === 'NOT') {
        tokens.push({ kind: operator.toLowerCase() as 'and' | 'or' | 'not' });
        continue;
      }
      throw new Error(`不支持的运算符「${word}」`);
    }
    throw new Error(`无法识别「${source.slice(index).trim()}」`);
  }

  return tokens;
}

export function formatTagReference(tag: string): string {
  return `[${tag.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
}

export function compileTagLogic(source: string): CompiledTagLogic {
  if (!source.trim()) return { test: null, error: null, referencedTags: [] };

  try {
    const tokens = tokenize(source);
    const referencedTags = [...new Set(tokens.flatMap((token) => token.kind === 'tag' ? expandTagReference(token.value) : []))];
    let cursor = 0;

    const current = () => tokens[cursor];

    function parsePrimary(): TagPredicate {
      const token = current();
      if (!token) throw new Error('逻辑还没写完整');
      if (token.kind === 'tag') {
        cursor += 1;
        const aliases = TAG_ALIASES[token.value];
        return aliases
          ? (tags) => aliases.some((tag) => tags.has(tag))
          : (tags) => tags.has(token.value);
      }
      if (token.kind === 'leftParen') {
        cursor += 1;
        const inner = parseOr();
        if (current()?.kind !== 'rightParen') throw new Error('缺少右括号 )');
        cursor += 1;
        return inner;
      }
      if (token.kind === 'rightParen') throw new Error('多余的右括号 )');
      throw new Error('运算符后需要标签或左括号 (');
    }

    function parseNot(): TagPredicate {
      if (current()?.kind !== 'not') return parsePrimary();
      cursor += 1;
      const inner = parseNot();
      return (tags) => !inner(tags);
    }

    function parseAnd(): TagPredicate {
      let left = parseNot();
      while (current()?.kind === 'and') {
        cursor += 1;
        const right = parseNot();
        const previous = left;
        left = (tags) => previous(tags) && right(tags);
      }
      return left;
    }

    function parseOr(): TagPredicate {
      let left = parseAnd();
      while (current()?.kind === 'or') {
        cursor += 1;
        const right = parseAnd();
        const previous = left;
        left = (tags) => previous(tags) || right(tags);
      }
      return left;
    }

    const test = parseOr();
    const remaining = current();
    if (remaining) {
      if (remaining.kind === 'rightParen') throw new Error('多余的右括号 )');
      if (remaining.kind === 'tag' || remaining.kind === 'leftParen' || remaining.kind === 'not') {
        throw new Error('标签之间需要 AND 或 OR');
      }
      throw new Error('逻辑还没写完整');
    }
    return { test, error: null, referencedTags };
  } catch (error) {
    return {
      test: null,
      error: error instanceof Error ? error.message : String(error),
      referencedTags: [],
    };
  }
}
