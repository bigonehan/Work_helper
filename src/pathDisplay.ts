const maxProjectNameLength = 4;

export const formatCompactProjectPath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replaceAll("\\", "/").replace(/\/+$/u, "");
  const hasLeadingSlash = normalized.startsWith("/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return hasLeadingSlash ? "/" : "";
  }

  const compactSegments = segments.slice(-2);
  const lastIndex = compactSegments.length - 1;
  const projectName = compactSegments[lastIndex] ?? "";
  compactSegments[lastIndex] =
    projectName.length > maxProjectNameLength ? `${projectName.slice(0, maxProjectNameLength)}...` : projectName;

  return `${hasLeadingSlash ? "/" : ""}${compactSegments.join("/")}`;
};
