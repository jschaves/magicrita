export type ProtocolErrorCode =
  | "secret_length"
  | "rpub_prefix"
  | "rpub_invalid"
  | "rsec_empty"
  | "rsec_invalid"
  | "rsec_format"
  | "password_short"
  | "vault_mismatch"
  | "wrong_password"
  | "no_vault"
  | "not_unlocked"
  | "invalid_envelope"
  | "media_type"
  | "media_too_large"
  | "media_too_many"
  | "empty_post"
  | "invalid_bundle"
  | "bundle_password"
  | "bundle_wrong_password"
  | "media_hash"
  | "backup_conflict"
  | "cannot_follow_self"
  | "cannot_block_self"
  | "empty_comment"
  | "already_reported"
  | "session_exists"
  | "edit_too_late"
  | "cannot_edit_other"
  | "cannot_delete_other"
  | "comment_too_late"
  | "account_exists"
  | "create_rate_limited"
  | "too_many_links"
  | "invite_self"
  | "invite_required"
  | "invite_bad"
  | "invite_rate"
  | "chat_self"
  | "chat_blocked"
  | "chat_closed"
  | "empty_chat"
  | "sync_empty"
  | "sync_format"
  | "sync_too_large"
  | "recovery_guardians"
  | "recovery_too_many"
  | "recovery_threshold"
  | "recovery_password"
  | "recovery_share_format"
  | "recovery_need_shares"
  | "recovery_mismatch"
  | "recovery_wrong_password";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode) {
    super(code);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}
