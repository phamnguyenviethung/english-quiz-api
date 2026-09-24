import { describe, expect, it } from 'bun:test';
import {
  fromProviderPreferences,
  isEmptyProviderPreferences,
  normalizeProviderPreferencesJson,
  toProviderPreferences,
  type ProviderPrefColumns,
  type ProviderPrefValueInput
} from '@/core/services/ai/providerPref.mapper';
import { BusinessLogicException } from '@/core/exceptions';
import type { AiModelProviderPref, AiModelProviderPrefValue } from '@/core/db/schema/main';

/**
 * Cầu nối 2 chiều giữa 2 bảng normalize và object `provider` mà OpenRouter nhận.
 * Sai ở đây nghĩa là routing provider bị bỏ qua âm thầm — request vẫn chạy, chỉ là chạy
 * sai nhà cung cấp/giá. Nên round-trip là tính chất đáng test nhất.
 */

function prefRow(overrides: Partial<AiModelProviderPref> = {}): AiModelProviderPref {
  return {
    id: 1,
    modelRefId: 1,
    context: 'reading',
    allowFallbacks: null,
    requireParameters: null,
    dataCollection: null,
    sort: null,
    zdr: null,
    maxPricePrompt: null,
    maxPriceCompletion: null,
    maxPriceRequest: null,
    maxPriceImage: null,
    maxPriceAudio: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  } as AiModelProviderPref;
}

function valueRow(kind: string, value: string, position: number, id = position + 1): AiModelProviderPrefValue {
  return { id, prefRefId: 1, kind, value, position } as AiModelProviderPrefValue;
}

describe('toProviderPreferences (rows -> object)', () => {
  it('không có pref row -> undefined (khớp chỗ caller dùng `?? undefined`)', () => {
    expect(toProviderPreferences(null)).toBeUndefined();
    expect(toProviderPreferences(undefined)).toBeUndefined();
  });

  it('pref row toàn null và không có value -> undefined, không trả object rỗng', () => {
    expect(toProviderPreferences(prefRow(), [])).toBeUndefined();
  });

  it('map các cột boolean/enum sang object', () => {
    const result = toProviderPreferences(
      prefRow({ allowFallbacks: false, requireParameters: true, dataCollection: 'deny', sort: 'price', zdr: true })
    );

    expect(result).toEqual({
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: 'deny',
      sort: 'price',
      zdr: true
    });
  });

  it('dataCollection giá trị lạ bị bỏ qua thay vì truyền xuống OpenRouter', () => {
    expect(toProviderPreferences(prefRow({ dataCollection: 'khong-hop-le' }))).toBeUndefined();
  });

  it('order giữ đúng thứ tự theo position', () => {
    const values = [valueRow('order', 'c', 2), valueRow('order', 'a', 0), valueRow('order', 'b', 1)];
    expect(toProviderPreferences(prefRow(), values)?.order).toEqual(['a', 'b', 'c']);
  });

  it('maxPrice đổi number -> string (định dạng OpenRouter yêu cầu)', () => {
    const result = toProviderPreferences(prefRow({ maxPricePrompt: 0.000002, maxPriceCompletion: 0 }));
    expect(result?.maxPrice).toEqual({ prompt: '0.000002', completion: '0' });
  });

  it('quantization không hợp lệ bị lọc bỏ', () => {
    const values = [valueRow('quantization', 'khong-ton-tai', 0)];
    expect(toProviderPreferences(prefRow(), values)).toBeUndefined();
  });
});

describe('fromProviderPreferences (object -> rows)', () => {
  it('object rỗng -> columns toàn null, values rỗng', () => {
    const { columns, values } = fromProviderPreferences({});
    expect(values).toEqual([]);
    expect(Object.values(columns).every((v) => v === null)).toBe(true);
  });

  it('đánh position tăng dần theo thứ tự mảng đầu vào', () => {
    const { values } = fromProviderPreferences({ order: ['x', 'y', 'z'] });
    expect(values).toEqual([
      { kind: 'order', value: 'x', position: 0 },
      { kind: 'order', value: 'y', position: 1 },
      { kind: 'order', value: 'z', position: 2 }
    ]);
  });

  it('trim phần tử và bỏ phần tử rỗng', () => {
    const { values } = fromProviderPreferences({ order: ['  x  ', '', '   '] });
    expect(values).toEqual([{ kind: 'order', value: 'x', position: 0 }]);
  });

  it('phần tử trùng trong cùng danh sách -> BusinessLogicException (400)', () => {
    expect(() => fromProviderPreferences({ order: ['x', 'x'] })).toThrow(BusinessLogicException);
  });

  it('dataCollection ngoài enum -> BusinessLogicException', () => {
    expect(() => fromProviderPreferences({ dataCollection: 'maybe' } as never)).toThrow(BusinessLogicException);
  });

  it('quantization ngoài enum -> BusinessLogicException (chặn sớm thay vì để OpenRouter từ chối)', () => {
    expect(() => fromProviderPreferences({ quantizations: ['khong-ton-tai'] } as never)).toThrow(
      BusinessLogicException
    );
  });

  it('maxPrice âm hoặc không phải số -> BusinessLogicException', () => {
    expect(() => fromProviderPreferences({ maxPrice: { prompt: '-1' } })).toThrow(BusinessLogicException);
    expect(() => fromProviderPreferences({ maxPrice: { prompt: 'rẻ' } })).toThrow(BusinessLogicException);
  });
});

describe('round-trip object -> rows -> object', () => {
  it('giữ nguyên nội dung sau một vòng chuyển đổi', () => {
    const input = {
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: 'deny' as const,
      sort: 'throughput',
      zdr: true,
      order: ['together', 'fireworks'],
      ignore: ['azure'],
      maxPrice: { prompt: '0.000005' }
    };

    const { columns, values } = fromProviderPreferences(input);
    const back = toProviderPreferences(
      prefRow(columns as Partial<AiModelProviderPref>),
      values.map((v, i) => valueRow(v.kind, v.value, v.position, i + 1))
    );

    expect(back).toEqual(input);
  });
});

describe('isEmptyProviderPreferences', () => {
  const emptyColumns: ProviderPrefColumns = {
    allowFallbacks: null,
    requireParameters: null,
    dataCollection: null,
    sort: null,
    zdr: null,
    maxPricePrompt: null,
    maxPriceCompletion: null,
    maxPriceRequest: null,
    maxPriceImage: null,
    maxPriceAudio: null
  };

  it('không cột nào có giá trị và không value -> rỗng', () => {
    expect(isEmptyProviderPreferences(emptyColumns, [])).toBe(true);
  });

  it('có bất kỳ cột nào khác null -> không rỗng', () => {
    expect(isEmptyProviderPreferences({ ...emptyColumns, allowFallbacks: false }, [])).toBe(false);
  });

  it('có value -> không rỗng', () => {
    const values: ProviderPrefValueInput[] = [{ kind: 'order', value: 'x', position: 0 }];
    expect(isEmptyProviderPreferences(emptyColumns, values)).toBe(false);
  });
});

/**
 * Context schedule/manual lưu provider dạng jsonb. Trước đây giá trị admin gửi được lưu nguyên,
 * sai thì chỉ lộ ra khi OpenRouter từ chối ở mọi lần sinh câu. Giờ đi qua cùng rule với reading.
 */
describe('normalizeProviderPreferencesJson (jsonb schedule/manual)', () => {
  it('chặn maxPrice âm hoặc không phải số', () => {
    expect(() => normalizeProviderPreferencesJson({ maxPrice: { prompt: '-1' } })).toThrow(BusinessLogicException);
    expect(() => normalizeProviderPreferencesJson({ maxPrice: { completion: 'abc' } })).toThrow(BusinessLogicException);
  });

  it('chặn provider trùng lặp và quantization lạ', () => {
    expect(() => normalizeProviderPreferencesJson({ only: ['openai', ' openai'] })).toThrow(BusinessLogicException);
    expect(() => normalizeProviderPreferencesJson({ quantizations: ['int3' as never] })).toThrow(
      BusinessLogicException
    );
  });

  it('trả về dạng chuẩn: list đã trim, bỏ phần tử rỗng, maxPrice dạng số chuẩn', () => {
    expect(
      normalizeProviderPreferencesJson({
        order: [' google-vertex ', ''],
        sort: ' price ',
        maxPrice: { prompt: '1.50' }
      })
    ).toEqual({ order: ['google-vertex'], sort: 'price', maxPrice: { prompt: '1.5' } });
  });

  it('không cấu hình gì -> null', () => {
    expect(normalizeProviderPreferencesJson(null)).toBeNull();
    expect(normalizeProviderPreferencesJson(undefined)).toBeNull();
    expect(normalizeProviderPreferencesJson({})).toBeNull();
    expect(normalizeProviderPreferencesJson({ order: [' '] })).toBeNull();
  });
});
