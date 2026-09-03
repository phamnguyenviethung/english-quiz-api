import { describe, expect, it } from 'bun:test';
import {
  descriptionLeaksAnswer,
  descriptionLeaksKnownTranslation,
  isValidDescriptionQuestion,
  isValidReadingQuestionDraft,
  isValidReadingQuestionSet,
  isVagueSubjectiveDescription,
  looksLikeDefinitionOrQuestion,
  normalizeTextForHeuristic,
  normalizeTextForLeakCheck,
  shuffleReadingQuestionOptions,
  spreadCorrectAnswers
} from '@/core/services/english/study.validators';
import type { DescriptionQuestion } from '@/core/services/english/prompt/description-prompt';
import type { ReadingQuestionDraft } from '@/core/services/english/prompt/reading-question';

/**
 * Các gate chất lượng chạy SAU khi model trả lời. Chúng là lý do câu hỏi lỗi không lọt vào
 * pool, nên phá chúng là hỏng chất lượng nội dung mà API vẫn xanh — đúng loại lỗi cần test.
 */

describe('chuẩn hoá text', () => {
  it('normalizeTextForLeakCheck: chỉ giữ chữ cái a-z, gộp khoảng trắng', () => {
    expect(normalizeTextForLeakCheck('The  Plumber, fixes-pipes!')).toBe('the plumber fixes pipes');
  });

  it('normalizeTextForHeuristic: bỏ dấu tiếng Việt và đ -> d', () => {
    expect(normalizeTextForHeuristic('Người này sửa Ống nước')).toBe('nguoi nay sua ong nuoc');
    expect(normalizeTextForHeuristic('Đường phố')).toBe('duong pho');
  });

  it('normalizeTextForHeuristic giữ chữ số, khác với leak-check', () => {
    expect(normalizeTextForHeuristic('phòng 101')).toBe('phong 101');
    expect(normalizeTextForLeakCheck('phong 101')).toBe('phong');
  });
});

describe('descriptionLeaksAnswer — mô tả không được chứa chính đáp án', () => {
  it('bắt đáp án xuất hiện nguyên văn', () => {
    expect(descriptionLeaksAnswer('This person is a plumber who works with pipes.', 'plumber')).toBe(true);
  });

  it('bắt biến thể +s / +es / +ed / +ing', () => {
    expect(descriptionLeaksAnswer('Many plumbers work here.', 'plumber')).toBe(true);
    expect(descriptionLeaksAnswer('He is teaching now.', 'teach')).toBe(true);
    expect(descriptionLeaksAnswer('She walked home.', 'walk')).toBe(true);
    expect(descriptionLeaksAnswer('He watches films.', 'watch')).toBe(true);
  });

  it('bắt biến thể y -> ies / ied', () => {
    expect(descriptionLeaksAnswer('He studies every night.', 'study')).toBe(true);
    expect(descriptionLeaksAnswer('She studied hard.', 'study')).toBe(true);
  });

  it('không báo nhầm khi đáp án chỉ là một phần của từ khác', () => {
    // "plumbering" không phải biến thể được liệt kê, và khớp phải trọn từ (có khoảng trắng 2 đầu).
    expect(descriptionLeaksAnswer('This person repairs water systems at home.', 'plumber')).toBe(false);
  });

  it('đáp án nhiều từ bị coi là lộ ngay (không kiểm nổi) — hàng rào an toàn', () => {
    expect(descriptionLeaksAnswer('bất kỳ mô tả nào', 'water pipe')).toBe(true);
  });

  it('đáp án rỗng -> coi như lộ', () => {
    expect(descriptionLeaksAnswer('mô tả', '')).toBe(true);
  });
});

describe('descriptionLeaksKnownTranslation — lộ qua bản dịch tiếng Việt', () => {
  it('bắt cụm dịch đã biết của đáp án', () => {
    expect(descriptionLeaksKnownTranslation('Nơi này là một sân vận động lớn.', 'stadium')).toBe(true);
  });

  it('đáp án không nằm trong từ điển rò rỉ -> không chặn', () => {
    expect(descriptionLeaksKnownTranslation('Nơi này rất rộng.', 'plumber')).toBe(false);
  });
});

describe('looksLikeDefinitionOrQuestion — mô tả không được là định nghĩa/câu hỏi', () => {
  it('chặn kiểu định nghĩa tiếng Việt', () => {
    expect(looksLikeDefinitionOrQuestion('Từ này có nghĩa là người sửa ống nước.')).toBe(true);
    expect(looksLikeDefinitionOrQuestion('Đây là người làm việc trong bệnh viện.')).toBe(true);
  });

  it('chặn kiểu định nghĩa tiếng Anh', () => {
    expect(looksLikeDefinitionOrQuestion('A person who fixes pipes.')).toBe(true);
    expect(looksLikeDefinitionOrQuestion('A device used for cutting paper.')).toBe(true);
  });

  it('chặn khi mô tả tự hỏi luôn', () => {
    expect(looksLikeDefinitionOrQuestion('Which word describes this job?')).toBe(true);
    expect(looksLikeDefinitionOrQuestion('Chọn từ đúng nhất.')).toBe(true);
  });

  it('mô tả tình huống bình thường thì cho qua', () => {
    expect(looksLikeDefinitionOrQuestion('Anh ấy đến nhà tôi và sửa vòi nước bị rò.')).toBe(false);
  });
});

describe('isVagueSubjectiveDescription — chặn mô tả cảm xúc chung chung', () => {
  it('chặn khi chỉ có thân câu chung chung, không có manh mối phân biệt', () => {
    expect(isVagueSubjectiveDescription('Bạn cảm thấy thế nào khi điều đó xảy ra?')).toBe(true);
  });

  it('có manh mối cụ thể thì cho qua', () => {
    expect(isVagueSubjectiveDescription('Bạn cảm thấy thế nào khi cả sân reo hò và bạn cười lớn?')).toBe(false);
  });

  it('mô tả không thuộc dạng chủ quan thì không bị đụng tới', () => {
    expect(isVagueSubjectiveDescription('Người này sửa ống nước trong nhà.')).toBe(false);
  });
});

describe('isValidDescriptionQuestion — gate tổng cho câu hỏi mô tả', () => {
  function q(overrides: Partial<DescriptionQuestion> = {}): DescriptionQuestion {
    return {
      description: 'Anh ấy đến nhà tôi và sửa vòi nước bị rò.',
      descriptionLanguage: 'vi',
      partOfSpeech: 'noun',
      correctAnswer: 'plumber',
      wrongAnswers: ['teacher', 'driver', 'farmer'],
      wrongAnswerExplanations: ['a', 'b', 'c'],
      explanation: 'giải thích',
      exampleSentence: 'example',
      exampleTranslation: 'ví dụ',
      ...overrides
    } as DescriptionQuestion;
  }

  it('câu hợp lệ ở A2 -> true', () => {
    expect(isValidDescriptionQuestion(q(), 3, 'A2')).toBe(true);
  });

  it('sai số lượng distractor -> false', () => {
    expect(isValidDescriptionQuestion(q({ wrongAnswers: ['a', 'b'] }), 3, 'A2')).toBe(false);
    expect(isValidDescriptionQuestion(q({ wrongAnswerExplanations: ['a'] }), 3, 'A2')).toBe(false);
  });

  it('B1/B2 bắt buộc mô tả bằng tiếng Anh', () => {
    expect(isValidDescriptionQuestion(q({ descriptionLanguage: 'vi' }), 3, 'B1')).toBe(false);
    expect(
      isValidDescriptionQuestion(
        q({ descriptionLanguage: 'en', description: 'He came to my house and fixed the leaking tap.' }),
        3,
        'B1'
      )
    ).toBe(true);
  });

  it('đáp án nhiều từ -> false (chỉ nhận 1 từ)', () => {
    expect(isValidDescriptionQuestion(q({ correctAnswer: 'water plumber' }), 3, 'A2')).toBe(false);
  });

  it('mô tả lộ đáp án -> false', () => {
    expect(isValidDescriptionQuestion(q({ description: 'Người này là plumber.' }), 3, 'A2')).toBe(false);
  });

  it('distractor trùng đáp án đúng -> false', () => {
    expect(isValidDescriptionQuestion(q({ wrongAnswers: ['plumber', 'driver', 'farmer'] }), 3, 'A2')).toBe(false);
  });

  it('distractor trùng nhau -> false', () => {
    expect(isValidDescriptionQuestion(q({ wrongAnswers: ['teacher', 'teacher', 'farmer'] }), 3, 'A2')).toBe(false);
  });
});

describe('isValidReadingQuestionDraft', () => {
  function draft(overrides: Partial<ReadingQuestionDraft> = {}): ReadingQuestionDraft {
    return {
      quizType: 'detail',
      question: 'What does Anna do every morning?',
      options: ['She runs', 'She swims', 'She reads', 'She cooks'],
      correctAnswer: 0,
      explanation: 'Đoạn [1] nói Anna chạy bộ mỗi sáng.',
      ...overrides
    } as ReadingQuestionDraft;
  }

  it('draft hợp lệ -> true', () => {
    expect(isValidReadingQuestionDraft(draft(), 'detail', [])).toBe(true);
  });

  it('thiếu question hoặc explanation -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ question: '' }), 'detail', [])).toBe(false);
    expect(isValidReadingQuestionDraft(draft({ explanation: '' }), 'detail', [])).toBe(false);
  });

  it('option rỗng -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ options: ['a', '', 'c', 'd'] }), 'detail', [])).toBe(false);
  });

  it('option trùng nhau (bỏ qua hoa thường) -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ options: ['She runs', 'she runs', 'c', 'd'] }), 'detail', [])).toBe(
      false
    );
  });

  it('lộ số thứ tự đoạn trong QUESTION -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ question: 'In paragraph 2, what happens?' }), 'detail', [])).toBe(false);
    expect(isValidReadingQuestionDraft(draft({ question: 'What does the first paragraph say?' }), 'detail', [])).toBe(
      false
    );
  });

  it('lộ số thứ tự đoạn trong OPTIONS -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ options: ['See paragraph 3', 'b', 'c', 'd'] }), 'detail', [])).toBe(
      false
    );
  });

  it('explanation ĐƯỢC PHÉP nhắc tới đoạn (field dành cho admin review)', () => {
    expect(
      isValidReadingQuestionDraft(draft({ explanation: 'Xem paragraph 2 để thấy chi tiết này.' }), 'detail', [])
    ).toBe(true);
  });

  it('model trả sai loại so với loại được giao -> false', () => {
    expect(isValidReadingQuestionDraft(draft({ quizType: 'inference' }), 'detail', [])).toBe(false);
  });

  it('hỏi trùng câu đã có trong bộ -> false', () => {
    expect(isValidReadingQuestionDraft(draft(), 'detail', ['  what does anna do every morning?  '])).toBe(false);
  });
});

describe('isValidReadingQuestionSet — kiểm ở tầng BỘ', () => {
  function draft(correctText: string): ReadingQuestionDraft {
    return {
      quizType: 'detail',
      question: `Q ${correctText}?`,
      options: [correctText, 'x', 'y', 'z'],
      correctAnswer: 0,
      explanation: 'e'
    } as ReadingQuestionDraft;
  }

  it('các câu có đáp án đúng khác nhau -> hợp lệ', () => {
    expect(isValidReadingQuestionSet([draft('a'), draft('b'), draft('c')])).toBe(true);
  });

  it('hai câu cùng đáp án đúng -> loại cả bộ (nghi hỏi trùng thông tin)', () => {
    expect(isValidReadingQuestionSet([draft('a'), draft('a'), draft('c')])).toBe(false);
  });

  it('so sánh bỏ qua hoa thường và khoảng trắng thừa', () => {
    expect(isValidReadingQuestionSet([draft('Anna'), draft('  anna  ')])).toBe(false);
  });

  it('bộ rỗng hoặc 1 câu luôn hợp lệ', () => {
    expect(isValidReadingQuestionSet([])).toBe(true);
    expect(isValidReadingQuestionSet([draft('a')])).toBe(true);
  });
});

describe('xáo vị trí đáp án', () => {
  function draft(id: number): ReadingQuestionDraft {
    return {
      quizType: 'detail',
      question: `Q${id}`,
      options: [`correct-${id}`, `w1-${id}`, `w2-${id}`, `w3-${id}`],
      correctAnswer: 0,
      explanation: 'e'
    } as ReadingQuestionDraft;
  }

  it('shuffle giữ nguyên cặp (option đúng <-> correctAnswer)', () => {
    for (let i = 0; i < 100; i += 1) {
      const shuffled = shuffleReadingQuestionOptions(draft(1));
      expect(shuffled.options[shuffled.correctAnswer]).toBe('correct-1');
      expect(shuffled.options).toHaveLength(4);
      expect([...shuffled.options].sort()).toEqual([...draft(1).options].sort());
    }
  });

  it('spreadCorrectAnswers không đổi nội dung câu, chỉ đổi vị trí', () => {
    const input = [draft(1), draft(2), draft(3)];
    const output = spreadCorrectAnswers(input);

    expect(output).toHaveLength(3);
    for (const [i, question] of output.entries()) {
      expect(question.options[question.correctAnswer]).toBe(`correct-${i + 1}`);
      expect(question.question).toBe(`Q${i + 1}`);
    }
  });

  it('spreadCorrectAnswers không để cả bộ 3 câu cùng rơi vào một vị trí', () => {
    // Chạy nhiều lần: xác suất 8 vòng retry đều thất bại là cực nhỏ, nhưng vẫn có.
    let allSamePositionRuns = 0;
    const runs = 200;
    for (let i = 0; i < runs; i += 1) {
      const output = spreadCorrectAnswers([draft(1), draft(2), draft(3)]);
      if (new Set(output.map((q) => q.correctAnswer)).size === 1) allSamePositionRuns += 1;
    }
    expect(allSamePositionRuns / runs).toBeLessThan(0.02);
  });

  it('bộ 1 câu vẫn chạy được (không có gì để rải)', () => {
    const output = spreadCorrectAnswers([draft(1)]);
    expect(output).toHaveLength(1);
    expect(output[0]!.options[output[0]!.correctAnswer]).toBe('correct-1');
  });
});
