// 审计事件的显示名(frontend-spec 12.10):审计页、账户与 HFT 页的历史共用,随界面语言翻译。
export const auditActionLabels: Record<string, string> = {
  'auth.create': 'Account created',
  'auth.update_tags': 'Account tags changed',
  'auth.update_whitelist': 'IP whitelist changed',
  'auth.update_owner': 'Account owner changed',
  'auth.rotate_key': 'API key rotated',
  'auth.terminate': 'Account terminated',
  'hft_config.create': 'HFT channel created',
  'hft_config.update': 'HFT config saved',
  'hft_restart.request': 'HFT restart requested',
  'member.invite': 'Member invited',
  'member.role': 'Role changed',
  'member.disable': 'Member disabled',
  'member.enable': 'Member enabled',
  'member.reset_totp': 'Authenticator reset',
  'session.revoke': 'Signed out everywhere',
  'agent_token.create': 'API token created',
  'agent_token.revoke': 'API token revoked',
  'login.locked': 'Sign-in locked',
};
export const auditCategoryLabels: Record<string, string> = {
  '': 'All',
  accounts: 'Accounts',
  hft: 'HFT',
  members: 'Members',
  tokens: 'Tokens',
  login: 'Login',
};
