import conversationModeSystemTemplateMarkdown from "@/prompts/conversation-mode-system.md?raw";
import liveSessionSystemTemplateMarkdown from "@/prompts/live-session-system.md?raw";
import toolDescriptionsMarkdown from "@/prompts/tool-descriptions.md?raw";
import toolModeSystemTemplateMarkdown from "@/prompts/tool-mode-system.md?raw";

interface ToolModePromptParams {
  conversation: string;
  context: string;
  latestUserRequest: string;
}

interface ConversationModePromptParams {
  conversation: string;
  context: string;
  latestUserRequest: string;
}

interface LiveSessionPromptParams {
  documentTitle: string;
  totalPages: number;
  currentPage: number;
  visiblePages: string;
  visiblePageText: string;
  currentPageAnnotations: string;
  userMessage: string;
}

function normalizeTemplate(template: string): string {
  return template.trim();
}

function renderTemplate(
  template: string,
  replacements: Record<string, string>,
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered.trim();
}

const TOOL_DESCRIPTIONS = normalizeTemplate(toolDescriptionsMarkdown);
const TOOL_MODE_SYSTEM_TEMPLATE = normalizeTemplate(
  toolModeSystemTemplateMarkdown,
).replace("{{TOOL_DESCRIPTIONS}}", TOOL_DESCRIPTIONS);
const CONVERSATION_MODE_SYSTEM_TEMPLATE = normalizeTemplate(
  conversationModeSystemTemplateMarkdown,
);
const LIVE_SESSION_SYSTEM_TEMPLATE = normalizeTemplate(
  liveSessionSystemTemplateMarkdown,
);

export function buildToolModePrompt(params: ToolModePromptParams): string {
  return renderTemplate(TOOL_MODE_SYSTEM_TEMPLATE, {
    CONVERSATION: params.conversation,
    CONTEXT: params.context,
    LATEST_USER_REQUEST: params.latestUserRequest,
  });
}

export function buildConversationModePrompt(
  params: ConversationModePromptParams,
): string {
  return renderTemplate(CONVERSATION_MODE_SYSTEM_TEMPLATE, {
    CONVERSATION: params.conversation,
    CONTEXT: params.context,
    LATEST_USER_REQUEST: params.latestUserRequest,
  });
}

export function buildLiveSessionPrompt(params: LiveSessionPromptParams): string {
  return renderTemplate(LIVE_SESSION_SYSTEM_TEMPLATE, {
    DOCUMENT_TITLE: params.documentTitle,
    TOTAL_PAGES: String(params.totalPages),
    CURRENT_PAGE: String(params.currentPage),
    VISIBLE_PAGES: params.visiblePages,
    VISIBLE_PAGE_TEXT: params.visiblePageText,
    CURRENT_PAGE_ANNOTATIONS: params.currentPageAnnotations,
    USER_MESSAGE: params.userMessage,
  });
}
