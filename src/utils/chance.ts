export interface ChanceOption<T> {
  percentage: number;
  value: T;
}

function random<T>(options: ChanceOption<T>[]): T {
  if (options.length === 0) throw new Error('Options array must not be empty');

  const sorted = options.sort((a, b) => a.percentage - b.percentage);
  let roll = Math.floor(Math.random() * 100);

  for (const option of sorted) {
    if (roll <= option.percentage) {
      return option.value;
    }
    roll -= option.percentage;
  }

  return sorted.at(-1)!.value;
}

export default random;
