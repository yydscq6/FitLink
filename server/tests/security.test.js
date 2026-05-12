/**
 * 安全工具单元测试
 */
const { sanitize, checkSensitive, filterSensitive } = require('../utils/security');

describe('sanitize (XSS 过滤)', () => {
  test('普通文本不被修改', () => {
    expect(sanitize('hello world')).toBe('hello world');
  });

  test('HTML 标签被移除', () => {
    const result = sanitize('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });

  test('事件处理器被移除', () => {
    const result = sanitize('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<img');
  });

  test('非字符串原样返回', () => {
    expect(sanitize(123)).toBe(123);
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
  });
});

describe('checkSensitive (敏感词检测)', () => {
  test('正常文本通过', () => {
    expect(checkSensitive('周末一起打篮球').pass).toBe(true);
  });

  test('空文本通过', () => {
    expect(checkSensitive('').pass).toBe(true);
    expect(checkSensitive(null).pass).toBe(true);
  });

  test('包含敏感词被拦截', () => {
    const result = checkSensitive('这里包含色情内容');
    expect(result.pass).toBe(false);
    expect(result.word).toBe('色情');
  });

  test('大小写混合被检测', () => {
    const result = checkSensitive('这个赌场所见所闻');
    expect(result.pass).toBe(false);
    expect(result.word).toBe('赌场');
  });
});

describe('filterSensitive (敏感词替换)', () => {
  test('无敏感词时不变', () => {
    expect(filterSensitive('周末篮球局')).toBe('周末篮球局');
  });

  test('敏感词被替换为 *', () => {
    const result = filterSensitive('这是色情内容');
    expect(result).toContain('**');
    expect(result).not.toContain('色情');
  });

  test('非字符串原样返回', () => {
    expect(filterSensitive(null)).toBe(null);
    expect(filterSensitive(123)).toBe(123);
  });
});
