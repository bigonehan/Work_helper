export const createContainsAnyValidator =
  (needles: readonly string[]) =>
  (answer: string): string | null => {
    const normalized = answer.toLowerCase();
    const matched = needles.some((needle) => normalized.includes(needle.toLowerCase()));
    if (matched) {
      return null;
    }

    return `Answer did not include any expected keyword: ${needles.join(", ")}`;
  };
