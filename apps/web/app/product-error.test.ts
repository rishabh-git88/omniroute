import { describe, expect, it } from 'vitest';

import { fileStatusMessage, productErrorMessage } from './product-error';

describe('product error presentation', () => {
  it('explains the registry-gated Compare 3 condition without raw backend text', () => {
    expect(
      productErrorMessage('COMPARE_REQUIRES_THREE_ELIGIBLE_MODELS'),
    ).toContain('fewer than three reviewed models');
  });

  it('explains file and embedding configuration failures safely', () => {
    expect(productErrorMessage('FILE_PDF_ENCRYPTED')).toBe(
      'Password-protected PDFs are not supported.',
    );
    expect(
      fileStatusMessage('FAILED', 'EMBEDDING_PROVIDER_NOT_CONFIGURED'),
    ).toContain('retrieval is not configured');
  });

  it('does not reflect unknown server text into the product UI', () => {
    expect(productErrorMessage('upstream stack trace with token=secret')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
