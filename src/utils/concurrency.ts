/**
 * Chạy tasks với số lượng đồng thời tối đa `limit`, không dừng khi có task lỗi —
 * kết quả trả về theo đúng thứ tự tasks đầu vào để caller map ngược lại được item nào hỏng.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    const taskIndex = index++;
    if (taskIndex >= tasks.length) return;
    const task = tasks[taskIndex]!;
    try {
      const value = await task();
      results[taskIndex] = { status: 'fulfilled', value };
    } catch (reason) {
      results[taskIndex] = { status: 'rejected', reason };
    }
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runNext));
  return results;
}
