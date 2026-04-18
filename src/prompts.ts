import { readFile } from "node:fs/promises";

export const loadPromptTemplate = async (promptFilePath: string): Promise<string> => {
  return readFile(promptFilePath, "utf8");
};

export const composePrompt = (promptTemplate: string, msg: string): string => {
  const normalizedTemplate = promptTemplate.trim();
  const normalizedMsg = msg.trim();

  if (!normalizedTemplate) {
    return normalizedMsg;
  }

  if (!normalizedMsg) {
    return normalizedTemplate;
  }

  return `${normalizedTemplate}\n\n${normalizedMsg}`;
};

export const resolvePrompt = async (msg: string, promptFilePath?: string): Promise<string> => {
  if (!promptFilePath) {
    return msg;
  }

  const promptTemplate = await loadPromptTemplate(promptFilePath);
  return composePrompt(promptTemplate, msg);
};
