import { cleanTitle, detectLanguage, renderTemplate } from 'src/shared/services/task-templates';
import { normalizeExtractedTasks } from 'src/shared/services/task-extraction.service';

jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('src/shared/services/ai/ai.service', () => ({ aiService: {}, AIUnavailableError: class {}, parseJsonLoose: jest.fn() }));

describe('task templates', () => {
  it('renders a bug in Vietnamese with labels in template order, skipping empty fields', () => {
    const text = renderTemplate(
      'bug',
      { expected: 'Đăng nhập thành công', problem: 'Không login được trên iOS', steps: [], notes: ['iOS 17'] },
      'vi',
    );
    expect(text).toBe(
      'Vấn đề: Không login được trên iOS\n\nKết quả mong đợi: Đăng nhập thành công\n\nGhi chú:\n• iOS 17',
    );
  });

  it('renders list fields as bullets and drops placeholder values', () => {
    const text = renderTemplate('task', { context: 'N/A', todo: ['Draft quote', ' Send to A '], doneWhen: 'Client has the quote' }, 'en');
    // "Done when" is a list field: always bullets, even with one item
    expect(text).toBe('To do:\n• Draft quote\n• Send to A\n\nDone when:\n• Client has the quote');
  });

  it('returns undefined when nothing was filled', () => {
    expect(renderTemplate('question', { question: '' }, 'en')).toBeUndefined();
  });

  it('falls back to the task template for unknown types', () => {
    expect(renderTemplate('weird', { context: 'x' }, 'en')).toBe('Context: x');
  });

  it.each([
    ['fix lỗi login trên iOS giúp em nhé', 'Fix lỗi login trên iOS'],
    ['@an gắn quảng cáo lên web nha!!', 'Gắn quảng cáo lên web'],
    ['Deploy the API please.', 'Deploy the API'],
    ['send quote to client A asap', 'Send quote to client A'],
  ])('cleans title "%s"', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  it('shortens long titles at a word boundary', () => {
    const title = cleanTitle('Research ' + 'very '.repeat(30) + 'long thing');
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('…')).toBe(true);
  });

  it('detects Vietnamese by diacritics', () => {
    expect(detectLanguage('làm trang báo giá')).toBe('vi');
    expect(detectLanguage('make the quote page')).toBe('en');
  });

  it('extraction renders details into the description and cleans the title', () => {
    const [task] = normalizeExtractedTasks(
      {
        tasks: [
          {
            title: 'làm trang báo giá cho khách A nhé',
            type: 'task',
            details: { context: 'Khách A cần báo giá', doneWhen: ['Gửi được báo giá cho khách A'] },
            sourceMessageIds: [1],
          },
        ],
      } as never,
      [1],
      'vi',
    );
    expect(task.title).toBe('Làm trang báo giá cho khách A');
    expect(task.description).toBe('Bối cảnh: Khách A cần báo giá\n\nHoàn thành khi:\n• Gửi được báo giá cho khách A');
  });
});
