/**
 * @deprecated Prefer `codevertexConfig` for Help/Legal. Kept for backward-compatible imports.
 */
export {
  LOCAL_HELP_PATH as SUPPORT_HELP_PATH,
  getLegalFooterLinks as getLegalLinks,
  type LegalFooterLink as LegalLink,
  type LegalFooterPageKey as LegalLinkId,
} from './codevertexConfig';
