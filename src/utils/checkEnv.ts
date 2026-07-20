export default function checkEnv(keys: string | string[]): boolean {
  if (Array.isArray(keys)) {
    for (const key of keys) {
      if (!process.env[key]) {
        throw new Error(`Environment variable ${key} is not set`);
      }
    }
  } else {
    if (!process.env[keys]) {
      throw new Error(`Environment variable ${keys} is not set`);
    }
  }
  return true;
}
