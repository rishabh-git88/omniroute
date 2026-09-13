/**
 * Product-safe messages for normalized API failure codes. The API is the
 * authority for the code; the browser deliberately never renders upstream
 * provider, parser, or storage error detail.
 */
const MESSAGES: Record<string, string> = {
  COMPARE_REQUIRES_THREE_ELIGIBLE_MODELS:
    'Compare 3 is temporarily unavailable because fewer than three reviewed models are currently available. Single AI is still available.',
  EMBEDDING_PROVIDER_NOT_CONFIGURED:
    'Workspace retrieval is not configured yet, so this file cannot be made available to AI.',
  FILE_CHUNK_LIMIT:
    'This file is too large to prepare within the workspace limits.',
  FILE_CONTENT_INVALID: 'The selected file could not be read safely.',
  FILE_EMPTY: 'Choose a file with text content.',
  FILE_EXTRACTED_TEXT_LIMIT:
    'This file contains more extractable text than the workspace limit allows.',
  FILE_MIME_EXTENSION_MISMATCH:
    'The file type does not match its filename extension.',
  FILE_NAME_INVALID: 'Choose a file with a safe filename.',
  FILE_NO_TEXT:
    'No readable text was found. Image-only PDFs are not supported.',
  FILE_PDF_ENCRYPTED: 'Password-protected PDFs are not supported.',
  FILE_PDF_MALFORMED: 'This PDF could not be read.',
  FILE_PDF_PAGE_LIMIT: 'This PDF has too many pages for this workspace.',
  FILE_PROCESSING_IN_PROGRESS: 'This file is already being processed.',
  FILE_SOURCE_SIZE_MISMATCH: 'The uploaded file could not be verified.',
  FILE_TEXT_ENCODING_INVALID: 'Text files must use valid UTF-8 encoding.',
  FILE_TOO_LARGE: 'This file exceeds the workspace upload limit.',
  FILE_TYPE_UNSUPPORTED: 'Upload a TXT, Markdown, or text-based PDF file.',
  INSUFFICIENT_CREDITS:
    'You do not have enough credits for this request. No AI run was started.',
  PROVIDER_AUTH_FAILED: 'The selected AI provider is unavailable.',
  PROVIDER_DISABLED: 'The selected AI model is not currently available.',
  PROVIDER_TIMEOUT:
    'The AI provider took too long to respond. Please try again.',
  RATE_LIMITED: 'The AI provider is busy. Please try again shortly.',
};

export function productErrorMessage(value: unknown): string {
  const source = typeof value === 'string' ? value : '';
  const code = source.match(/[A-Z][A-Z0-9_]{2,}/)?.[0];
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (
    /^Unable to (load|start|send|upload|retry|delete|select|regenerate)/i.test(
      source,
    )
  )
    return source;
  return 'Something went wrong. Please try again.';
}

export function fileStatusMessage(
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED',
  errorCode: string | null,
): string {
  if (status === 'READY') return 'Ready for workspace retrieval';
  if (status === 'PENDING' || status === 'PROCESSING') return 'Processing';
  if (status === 'DELETED') return 'Removed';
  return errorCode ? productErrorMessage(errorCode) : 'File processing failed.';
}
